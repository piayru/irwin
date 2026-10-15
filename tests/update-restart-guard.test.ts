import { afterEach, expect, it, vi } from "vitest";
import { UpdateRestartGuard } from "../src/main/update-restart-guard";
afterEach(() => vi.useRealTimers());
it("requires the matching renderer acknowledgement", async () => {
  const guard = new UpdateRestartGuard();
  const notify = vi.fn();
  const result = guard.request("current", notify);
  guard.acknowledge("stale", true);
  guard.acknowledge("current", false);
  await expect(result).resolves.toBe(false);
  expect(notify).toHaveBeenCalledOnce();
});
it("fails closed when the renderer does not respond", async () => {
  vi.useFakeTimers();
  const result = new UpdateRestartGuard().request("current", () => {});
  await vi.runAllTimersAsync();
  await expect(result).resolves.toBe(false);
});
it("accepts idle renderer readiness and rejects failed delivery", async () => {
  const guard = new UpdateRestartGuard();
  const ready = guard.request("current", () =>
    guard.acknowledge("current", true),
  );
  await expect(ready).resolves.toBe(true);
  await expect(
    guard.request("next", () => {
      throw new Error("destroyed");
    }),
  ).resolves.toBe(false);
});

it("waits for tab cleanup requests to drain after the renderer is ready", async () => {
  vi.useFakeTimers();
  const guard = new UpdateRestartGuard();
  let busy = true;
  let settled = false;
  const result = guard.request(
    "closing-tabs",
    () => guard.acknowledge("closing-tabs", true),
    5000,
    () => busy,
  );
  void result.then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(settled).toBe(false);
  busy = false;
  await vi.advanceTimersByTimeAsync(50);
  await expect(result).resolves.toBe(true);
});

it("never authorizes restart while acknowledged cleanup stays busy", async () => {
  vi.useFakeTimers();
  const guard = new UpdateRestartGuard();
  const result = guard.request(
    "busy",
    () => guard.acknowledge("busy", true),
    5000,
    () => true,
  );
  await vi.runAllTimersAsync();
  await expect(result).resolves.toBe(false);
});
