import { expect, test, vi } from "vitest";
import { previewRegex } from "../src/renderer/filter-regex-preview";
function fakeWorker() {
  return {
    onmessage: null as any,
    onerror: null as any,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
}
test("Regex preview terminates a stalled worker instead of blocking the UI", async () => {
  vi.useFakeTimers();
  try {
    const worker = fakeWorker();
    const pending = previewRegex(
      "(a+)+$",
      "",
      "aaa!",
      new AbortController().signal,
      () => worker,
    );
    worker.onmessage({ data: { ready: true } });
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toMatchObject({
      error: expect.stringMatching(/time|逾時/i),
    });
    expect(worker.terminate).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
test("Regex preview cancellation terminates the worker and ignores late messages", async () => {
  const worker = fakeWorker(),
    controller = new AbortController();
  const pending = previewRegex(
    "Ada",
    "i",
    "ADA",
    controller.signal,
    () => worker,
  );
  controller.abort();
  expect(await pending).toEqual({ cancelled: true });
  expect(worker.terminate).toHaveBeenCalled();
});
