export async function closeElectronWindowNormally(app) {
  const child = app.process();
  const assertNormalExit = () => {
    if (child.exitCode !== 0 || child.signalCode)
      throw new Error(
        `Electron exited abnormally (pid=${child.pid}, exitCode=${child.exitCode}, signal=${child.signalCode})`,
      );
  };
  if (child.exitCode !== null || child.signalCode) {
    assertNormalExit();
    return;
  }

  // Subscribe before requesting close: Electron can exit during that RPC.
  let onExit;
  const exited = new Promise((resolve) => {
    onExit = resolve;
    child.once("exit", onExit);
  });
  let timeout;
  try {
    const windowsClosed = Promise.all(
      app
        .windows()
        .filter((page) => !page.isClosed())
        .map((page) => page.waitForEvent("close", { timeout: 10000 })),
    ).catch((cause) => {
      throw new Error(
        `Electron windows did not close normally (pid=${child.pid})`,
        { cause },
      );
    });
    let failCloseRequest;
    const closeRequestFailed = new Promise((_, reject) => {
      failCloseRequest = reject;
    });
    void app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.close();
      })
      .catch((error) => {
        // A successful quit may close the evaluation transport before replying.
        if (
          !/Target page, context or browser has been closed|Target closed/.test(
            String(error),
          )
        )
          failCloseRequest(error);
      });

    await Promise.race([windowsClosed, closeRequestFailed]);
    // Window.close starts the app's own quit lifecycle. Playwright detaches its
    // inspector when Node requests it. A second app.close() would send another
    // quit RPC into that teardown and can hang even after the window is gone.
    await Promise.race([
      exited,
      closeRequestFailed,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Electron did not exit after normal window close (pid=${child.pid}, exitCode=${child.exitCode})`,
              ),
            ),
          30000,
        );
      }),
    ]);
    assertNormalExit();
  } finally {
    clearTimeout(timeout);
    child.removeListener("exit", onExit);
  }
}
