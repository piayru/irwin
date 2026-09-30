import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => false },
}));
import { Storage } from "../src/main/storage";
import { profileSchema, withEnvironment } from "../src/shared/contracts";
import {
  receiptFromCommand,
  receiptFromJob,
  requiredTransferConfirmation,
} from "../src/shared/operation-safety";
import { filterReceipts } from "../src/renderer/receipt-view";

const base = {
  id: "local",
  name: "Local database",
  uri: "mongodb://127.0.0.1:27017/",
};
let directory: string;
let storage: Storage;
beforeEach(async () => {
  directory = await mkdtemp(join(resolve(".runtime"), "local-environment-"));
  storage = new Storage(join(directory, "test.sqlite"));
});
afterEach(async () => {
  storage.close();
  await rm(directory, { recursive: true, force: true });
});

test.each(["local", "development", "staging", "production"] as const)(
  "%s profiles retain their tag after saving and reopening storage",
  (environment) => {
    const profile = profileSchema.parse({ ...base, environment });
    storage.save(profile, {});
    storage.close();
    storage = new Storage(join(directory, "test.sqlite"));
    expect(storage.profile(profile.id)).toEqual(profile);
    expect(storage.list()).toEqual([profile]);
    expect(profile.readOnly).toBe(environment === "production");
  },
);

test("legacy profiles retain the Development default", () => {
  expect(profileSchema.parse(base)).toMatchObject({
    environment: "development",
    readOnly: false,
  });
});

test("editing the tag to Local preserves explicit read-only protection", () => {
  const production = profileSchema.parse({
    ...base,
    environment: "production",
  });
  storage.save(production, {});
  storage.save(withEnvironment(storage.profile(base.id), "local"), {});
  expect(storage.profile(base.id)).toMatchObject({
    environment: "local",
    readOnly: true,
  });
  const local = profileSchema.parse({ ...base, environment: "local" });
  expect(withEnvironment(local, "production").readOnly).toBe(true);
});

test("Local command and transfer receipts persist and can be filtered", () => {
  const context = {
    connectionName: base.name,
    environment: "local" as const,
    namespace: "app.items",
    action: "import",
    mode: "insert",
    scope: "collection" as const,
  };
  const command = receiptFromCommand(context, "command", "completed", 1);
  const job = receiptFromJob(context, {
    jobId: "job",
    status: "completed",
    processed: 2,
    failed: 0,
    bytes: 30,
    message: "",
  });
  storage.saveReceipt(command);
  storage.saveReceipt(job);
  storage.saveReceipt(
    receiptFromCommand(
      { ...context, environment: "development" },
      "dev",
      "completed",
    ),
  );
  storage.close();
  storage = new Storage(join(directory, "test.sqlite"));
  expect(
    filterReceipts(storage.receipts(), { environment: "local" })
      .map((r) => r.id)
      .sort(),
  ).toEqual(["command", "job"]);
});

test("Local retains destructive transfer confirmations", () => {
  const input = {
    direction: "import" as const,
    database: "app",
    collection: "items",
    mode: "insert" as const,
    drop: false,
  };
  expect(requiredTransferConfirmation(input, "local")).toBeUndefined();
  expect(
    requiredTransferConfirmation({ ...input, mode: "replace" }, "local"),
  ).toBe("app.items");
  expect(requiredTransferConfirmation({ ...input, drop: true }, "local")).toBe(
    "app.items",
  );
  expect(
    requiredTransferConfirmation({ ...input, collection: "" }, "local"),
  ).toBe("app");
});
