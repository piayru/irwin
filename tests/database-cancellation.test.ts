import { expect, test, vi } from "vitest";
import type { MongoClient } from "mongodb";
import { DatabaseService } from "../src/core/database";
import { profileSchema, querySchema } from "../src/shared/contracts";

function fixture() {
  const database = new DatabaseService();
  let finishVersion!: (version: string) => void;
  const versionTask = new Promise<string>((resolve) => {
    finishVersion = resolve;
  });
  const cursor = {
    hasNext: vi.fn(async () => false),
    close: vi.fn(async () => {}),
  };
  const collection = {
    find: vi.fn(() => cursor),
    aggregate: vi.fn(() => cursor),
  };
  const client = {
    db: () => ({ collection: () => collection }),
    close: vi.fn(async () => {}),
  };
  const entry = {
    client: client as unknown as MongoClient,
    profile: profileSchema.parse({
      id: "cancel-qa",
      name: "QA",
      uri: "mongodb://localhost",
      readOnly: false,
    }),
    version: "unknown",
    versionTask,
  };
  database.connections.set("cancel-qa", entry);
  const input = querySchema.parse({
    connectionId: "cancel-qa",
    database: "qa",
    collection: "documents",
    cursorId: "pending-cursor",
  });
  return {
    database,
    client,
    collection,
    input,
    finish() {
      entry.version = "8.0.18";
      finishVersion(entry.version);
    },
    start(mode: "find" | "aggregation" | "preview" = "find") {
      return mode === "find"
        ? database.run(input)
        : database.aggregate(
            {
              ...input,
              stages: [{ id: "match", enabled: true, text: "{$match:{}}" }],
            },
            mode === "preview" ? "preview" : "run",
          );
    },
  };
}

test.each(["find", "aggregation", "preview"] as const)(
  "cancelling %s during version detection prevents the query from starting",
  async (mode) => {
    const f = fixture();
    const result = f.start(mode).then(
      () => "completed",
      (error: Error) => error.message,
    );
    await f.database.cancel(f.input.cursorId!);
    f.finish();
    expect(await result).toMatch(/abort|cancel/i);
    expect(f.collection.find).not.toHaveBeenCalled();
    expect(f.collection.aggregate).not.toHaveBeenCalled();
    expect(f.database.cursors.size).toBe(0);
  },
);

test.each(["find", "aggregation"] as const)(
  "disconnecting during %s version detection cancels pending work",
  async (mode) => {
    const f = fixture();
    const result = f.start(mode).then(
      () => "completed",
      (error: Error) => error.message,
    );
    await f.database.close(f.input.connectionId);
    f.finish();
    expect(await result).toMatch(/abort|cancel/i);
    expect(f.collection.find).not.toHaveBeenCalled();
    expect(f.collection.aggregate).not.toHaveBeenCalled();
    expect(f.client.close).toHaveBeenCalledOnce();
  },
);

test("a pending cursor reserves its identity without creating a second database cursor", async () => {
  const f = fixture();
  const first = f.start();
  const duplicate = f.start().then(
    () => "completed",
    (error: Error) => error.message,
  );
  f.finish();
  expect(await duplicate).toMatch(/duplicate cursor/i);
  await expect(first).resolves.toMatchObject({ rows: [], hasMore: false });
  expect(f.collection.find).toHaveBeenCalledOnce();
});
