import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loadHelper() {
  return import(
    /* @vite-ignore */ new URL(
      "./e2e/helpers/close-electron.mjs",
      import.meta.url,
    ).href
  );
}

function fixture(
  options: {
    blocked?: boolean;
    exitCode?: number;
    signal?: string;
    staysRunning?: boolean;
    synchronousExit?: boolean;
    pendingReply?: boolean;
    requestError?: Error;
  } = {},
) {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null as number | null,
    signalCode: null as string | null,
  });
  const pageEvents = new EventEmitter();
  let closed = false;
  const order: string[] = [];
  const exit = () => {
    child.exitCode = options.signal ? null : (options.exitCode ?? 0);
    child.signalCode = options.signal ?? null;
    order.push("process.exit");
    child.emit("exit", child.exitCode, child.signalCode);
  };
  const window = {
    close() {
      order.push("window.close");
      if (options.blocked) return;
      closed = true;
      pageEvents.emit("close");
      if (!options.staysRunning) {
        if (options.synchronousExit) exit();
        else setTimeout(exit, 0);
      }
    },
  };
  const app = {
    process: () => child,
    windows: () => [
      {
        isClosed: () => closed,
        waitForEvent: (_event: string, { timeout }: { timeout: number }) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Window close timed out")),
              timeout,
            );
            pageEvents.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      },
    ],
    evaluate: async (callback: (args: unknown) => unknown) => {
      if (options.requestError) throw options.requestError;
      callback({ BrowserWindow: { getAllWindows: () => [window] } });
      if (options.pendingReply) await new Promise(() => {});
    },
    // Another quit RPC cannot complete while its inspector is detaching.
    close: vi.fn(async () => new Promise(() => {})),
  };
  return { app, child, order };
}

test("a normal process exit succeeds even when another quit RPC would never return", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app, child, order } = fixture();
  const check = expect(
    closeElectronWindowNormally(app),
  ).resolves.toBeUndefined();
  await Promise.all([check, vi.runAllTimersAsync()]);
  expect(order).toEqual(["window.close", "process.exit"]);
  expect(child.listenerCount("exit")).toBe(0);
});

test("a prevented window close is not bypassed by quitting through Playwright", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app, child } = fixture({ blocked: true });
  const check = expect(closeElectronWindowNormally(app)).rejects.toThrow(
    "windows did not close",
  );
  await Promise.all([check, vi.runAllTimersAsync()]);
  expect(app.close).not.toHaveBeenCalled();
  expect(child.listenerCount("exit")).toBe(0);
});

test.each([{ exitCode: 42 }, { signal: "SIGTERM" }])(
  "an abnormal Electron exit cannot pass normal shutdown validation: %j",
  async (options) => {
    vi.useFakeTimers();
    const { closeElectronWindowNormally } = await loadHelper();
    const { app } = fixture(options);
    const check = expect(closeElectronWindowNormally(app)).rejects.toThrow(
      "exited abnormally",
    );
    await Promise.all([check, vi.runAllTimersAsync()]);
  },
);

test("a process that stays alive after its window closes fails the exit deadline", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app, child } = fixture({ staysRunning: true });
  const check = expect(closeElectronWindowNormally(app)).rejects.toThrow(
    "did not exit after normal window close",
  );
  await Promise.all([check, vi.runAllTimersAsync()]);
  expect(child.listenerCount("exit")).toBe(0);
});

test("normal exit does not depend on a reply from a closing inspector", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app } = fixture({ pendingReply: true });
  const check = expect(
    closeElectronWindowNormally(app),
  ).resolves.toBeUndefined();
  await Promise.all([check, vi.runAllTimersAsync()]);
});

test("an exit emitted during the close request is not missed", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app } = fixture({ synchronousExit: true });
  const check = expect(
    closeElectronWindowNormally(app),
  ).resolves.toBeUndefined();
  await Promise.all([check, vi.runAllTimersAsync()]);
});

test("an unexpected close request failure is reported and removes the exit listener", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app, child } = fixture({
    requestError: new Error("Close request failed"),
  });
  const check = expect(closeElectronWindowNormally(app)).rejects.toThrow(
    "Close request failed",
  );
  await Promise.all([check, vi.runAllTimersAsync()]);
  expect(child.listenerCount("exit")).toBe(0);
});
