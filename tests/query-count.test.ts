import { expect, test } from "vitest";
import { QueryCountRequest } from "../src/renderer/query-count";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
test("a delayed count cannot overwrite a count for a newer filter", async () => {
  const request = new QueryCountRequest();
  const first = deferred<number>(),
    second = deferred<number>();
  const old = request.run(() => first.promise);
  const current = request.run(() => second.promise);
  first.resolve(999);
  expect(await old).toEqual({ stale: true });
  second.resolve(42);
  expect(await current).toEqual({ stale: false, count: 42 });
});
test("invalidate suppresses stale failures and results after an input change or unmount", async () => {
  const request = new QueryCountRequest();
  const first = deferred<number>();
  const old = request.run(() => first.promise);
  request.invalidate();
  first.reject(new Error("old timeout"));
  expect(await old).toEqual({ stale: true });
  expect(await request.run(async () => 0)).toEqual({ stale: false, count: 0 });
});
test("current failures are reported and a retry can succeed", async () => {
  const request = new QueryCountRequest();
  expect(
    await request.run(async () => {
      throw new Error("count timeout");
    }),
  ).toEqual({ stale: false, error: "count timeout" });
  expect(await request.run(async () => 7)).toEqual({ stale: false, count: 7 });
});
