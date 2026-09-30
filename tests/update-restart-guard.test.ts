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
