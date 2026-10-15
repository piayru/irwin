import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => false },
}));
import { Storage } from "../src/main/storage";
let directory: string, storage: Storage;
beforeEach(async () => {
  directory = await mkdtemp(join(resolve(".runtime"), "workflow-test-"));
  storage = new Storage(join(directory, "test.sqlite"));
});
afterEach(async () => {
  storage.close();
  await rm(directory, { recursive: true, force: true });
});
const query = {
  mode: "find",
  filter: "{active:true}",
  sort: "{}",
  projection: "{}",
  batchSize: 50,
  code: "",
};
const bundle = {
  format: "irwin-query-bundle",
  version: 1,
  name: "Ops",
  exportedAt: new Date().toISOString(),
  queries: [{ id: "q1", name: "Active", query }],
  pipelines: [
    {
      id: "p1",
      name: "Count",
      stages: [{ id: "s1", enabled: true, text: '{$count:"n"}' }],
      updatedAt: new Date().toISOString(),
    },
  ],
};
test("bundle import creates fresh identities without overwriting and survives restart", () => {
  storage.saveQuery({ id: "q1", name: "Existing", query });
  const first = storage.importQueryBundle(bundle);
  const second = storage.importQueryBundle(bundle);
  expect(first.queries[0].id).not.toBe("q1");
  expect(second.queries[0].id).not.toBe(first.queries[0].id);
  expect(first.pipelines[0].stages[0].id).not.toBe("s1");
  storage.close();
  storage = new Storage(join(directory, "test.sqlite"));
  expect(storage.savedQueries()).toHaveLength(3);
  expect(storage.savedPipelines()).toHaveLength(2);
});
test("an invalid bundle never partially imports", () => {
  expect(() =>
    storage.importQueryBundle({
      ...bundle,
      pipelines: [
        {
          ...bundle.pipelines[0],
          stages: [{ id: "s", enabled: true, text: '{$out:"target"}' }],
        },
      ],
    }),
  ).toThrow();
  expect(storage.savedQueries()).toEqual([]);
  expect(storage.savedPipelines()).toEqual([]);
});
const record = {
  format: "irwin-explain-record",
  version: 1,
  id: "r1",
  name: "Baseline",
  capturedAt: new Date().toISOString(),
  appVersion: "0.1.2",
  source: {
    connectionName: "Dev",
    database: "app",
    collection: "orders",
    environment: "development",
    provider: "mongodb",
  },
  serverVersion: "8.0.18",
  durationMS: 12,
  warnings: [],
  indexes: '[{"name":"_id_","key":{"_id":1}}]',
  plan: '{"executionStats":{"nReturned":2,"totalDocsExamined":2}}',
  input: {
    kind: "find",
    filter: "{active:true}",
    sort: "{}",
    projection: "{}",
    skip: 0,
    maxTimeMS: 30000,
    hint: "",
    collation: "",
  },
};
test("diagnostic records preserve all inputs, metadata and plan across restarts", () => {
  storage.saveExplainRecord(record);
  storage.close();
  storage = new Storage(join(directory, "test.sqlite"));
  expect(storage.explainRecords()).toEqual([record]);
  storage.deleteExplainRecord("r1");
  expect(storage.explainRecords()).toEqual([]);
});
test("diagnostic record imports reject malformed plans and unsupported formats", () => {
  expect(() =>
    storage.saveExplainRecord({ ...record, plan: "broken" }),
  ).toThrow();
  expect(() => storage.saveExplainRecord({ ...record, version: 2 })).toThrow();
  expect(() =>
    storage.saveExplainRecord({ ...record, uri: "mongodb://secret" }),
  ).toThrow();
  expect(storage.explainRecords()).toEqual([]);
});
