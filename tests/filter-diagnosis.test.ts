import { expect, test, vi } from "vitest";
import { runFilterDiagnosis } from "../src/renderer/filter-diagnosis";
import { querySchema } from "../src/shared/contracts";
const input = querySchema.parse({
  connectionId: "qa",
  database: "qa",
  collection: "docs",
  filter: "a:1,b:2",
});
test("diagnosis uses bounded existence probes and closes every cursor", async () => {
  const reads: any[] = [],
    cancelled: string[] = [];
  const result = await runFilterDiagnosis(
    input,
    {
      read: async (query) => {
        reads.push(query);
        return {
          rows: [{ ejson: "{}", editable: false }],
          cursorId: query.cursorId!,
          hasMore: false,
          elapsedMS: 0,
        };
      },
      cancel: async (id) => {
        cancelled.push(id);
      },
    },
    new AbortController().signal,
  );
  expect(result.completion).toBe("complete");
  expect(reads).toHaveLength(5);
  expect(new Set(reads.map((query) => query.cursorId)).size).toBe(5);
  expect(
    reads.every(
      (query) =>
        query.batchSize === 1 &&
        query.projection === '{"_id":1}' &&
        query.maxTimeMS <= 2000,
    ),
  ).toBe(true);
  expect(cancelled).toHaveLength(5);
});
test("closing a diagnosis cancels a pending read and ignores its late result", async () => {
  const controller = new AbortController(),
    cancelled: string[] = [];
  let finish!: (value: any) => void;
  const pending = runFilterDiagnosis(
    input,
    {
      read: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      cancel: async (id) => {
        cancelled.push(id);
      },
    },
    controller.signal,
  );
  controller.abort();
  const result = await pending;
  expect(result.completion).toBe("cancelled");
  expect(result.results).toHaveLength(0);
  expect(cancelled.length).toBeGreaterThan(0);
  finish({ rows: [], hasMore: false, cursorId: "late" });
  await Promise.resolve();
  expect(result.results).toHaveLength(0);
});
test("a stalled diagnosis times out and never starts another probe", async () => {
  vi.useFakeTimers();
  try {
    let reads = 0;
    const pending = runFilterDiagnosis(
      input,
      {
        read: () => {
          reads++;
          return new Promise(() => {});
        },
        cancel: async () => {},
      },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(2500);
    const result = await pending;
    expect(result.completion).toBe("timedOut");
    expect(reads).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
test("an empty collection stops diagnosis without blaming a condition", async () => {
  let reads = 0;
  const result = await runFilterDiagnosis(
    input,
    {
      read: async (query) => {
        reads++;
        return {
          rows: [],
          cursorId: query.cursorId!,
          hasMore: false,
          elapsedMS: 0,
        };
      },
      cancel: async () => {},
    },
    new AbortController().signal,
  );
  expect(reads).toBe(1);
  expect(result.results[0].matches).toBe(false);
});
test("total diagnosis deadline bounds a series of individually successful slow probes", async () => {
  vi.useFakeTimers();
  try {
    let reads = 0;
    const pending = runFilterDiagnosis(
      { ...input, filter: "a:1,b:2,c:3,d:4" },
      {
        read: (query) => {
          reads++;
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  rows: [{ ejson: "{}", editable: false }],
                  cursorId: query.cursorId!,
                  hasMore: false,
                  elapsedMS: 0,
                }),
              1800,
            ),
          );
        },
        cancel: async () => {},
      },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(12000);
    expect((await pending).completion).toBe("timedOut");
    expect(reads).toBeLessThan(9);
  } finally {
    vi.useRealTimers();
  }
});
