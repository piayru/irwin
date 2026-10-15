// Real App and editors, isolated IPC: never quits Irwin or touches a database.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
await mkdir(".runtime/update-restart-ui", { recursive: true });
const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { ignored: ["**/.runtime/**"] },
  },
});
await server.listen();
const browserServer = await chromium.launchServer({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
const browser = await chromium.connect(browserServer.wsEndpoint());
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.requests = [];
    window.failDraftSave = false;
    const listeners = new Set();
    const emit = (event) => {
      for (const listener of [...listeners]) listener(event);
    };
    let status = {
      state: "downloaded",
      currentVersion: "0.1.3",
      availableVersion: "0.1.4",
      delivery: "automatic",
      restartDeferred: true,
      progress: 100,
    };
    window.finishRestartFixture = () =>
      emit({
        type: "update",
        data: { ...status, state: "downloaded", restartDeferred: true },
      });
    window.emitJob = (running) =>
      emit({
        type: "job",
        data: {
          jobId: "qa-job",
          kind: "export",
          status: running ? "running" : "completed",
          processed: 0,
          errors: 0,
        },
      });
    window.workbench = {
      subscribe(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      async request(command, payload) {
        window.requests.push({ command, payload });
        const { settingsSchema, profileSchema } =
          await import("/src/shared/contracts.ts");
        switch (command) {
          case "settings.get":
            return settingsSchema.parse({
              language: "en",
              autoRunOnOpen: false,
            });
          case "workspace.get":
            return {
              version: 1,
              sidebarWidth: 270,
              jobsHeight: 180,
              historyHeight: 180,
            };
          case "app.status":
            return {
              version: "0.1.3",
              platform: "win32",
              secureStorage: true,
              connections: [],
              update: status,
            };
          case "connections.list":
            return [
              profileSchema.parse({
                id: "qa",
                name: "QA connection",
                uri: "mongodb://127.0.0.1:27017",
                database: "qa_db",
              }),
            ];
          case "connections.open":
            emit({
              type: "connection",
              data: { id: "qa", connected: true },
            });
            return {};
          case "metadata.databases":
            return { names: ["qa_db"] };
          case "metadata.collections":
            return [{ name: "documents", type: "collection" }];
          case "shellDrafts.save":
            if (window.failDraftSave) throw Error("QA draft save unavailable");
            return payload;
          case "updates.install":
            emit({ type: "updateRestart", data: { id: "qa-restart" } });
            return;
          case "updates.restartReady":
            status = {
              ...status,
              state: payload.ready ? "installing" : "downloaded",
            };
            emit({ type: "update", data: status });
            return;
          case "shellDrafts.list":
          case "savedQueries.list":
          case "history.list":
          case "operationReceipts.list":
            return [];
          default:
            return {};
        }
      },
    };
  });
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page
    .getByRole("button", { name: "Open saved connection", exact: true })
    .click();
  await page
    .locator(".connection-picker-item")
    .filter({ hasText: "QA connection" })
    .click();
  await page
    .locator(".sidebar .tree-main")
    .filter({ hasText: /^qa_db$/ })
    .click();
  await page.locator(".collection-row .tree-main").first().click();
  await page
    .getByLabel("FILTER", { exact: true })
    .fill('{ name: "keep this query" }');
  await page.locator(".connection-row .node-menu-trigger").click();
  await page
    .locator(".connection-node .node-menu")
    .getByRole("button", { name: "Shell", exact: true })
    .click();
  const editor = page.locator(".shell-editor .monaco-editor");
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("const preservedForUpdate = true;");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.requests.some(
          (r) =>
            r.command === "shellDrafts.save" &&
            r.payload.code.includes("preservedForUpdate"),
        ),
      ),
    )
    .toBe(true);
  await page.locator("button.version-update-available").click();
  await page.setViewportSize({ width: 1000, height: 650 });
  const update = page.locator("dialog.update-modal[open]");
  await update
    .getByRole("button", { name: "Restart and install", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Install update and restart?",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("1 active connection");
  await expect(confirm).toContainText("2 open tabs");
  await expect(confirm).toContainText("Unsaved query changes will be lost");
  const confirmationBounds = await confirm.boundingBox();
  assert.ok(
    confirmationBounds.x >= 0 &&
      confirmationBounds.y >= 0 &&
      confirmationBounds.x + confirmationBounds.width <= 1000 &&
      confirmationBounds.y + confirmationBounds.height <= 650,
  );
  await page.screenshot({
    path: ".runtime/update-restart-ui/confirmation.png",
  });
  assert.equal(
    await page.evaluate(
      () =>
        window.requests.filter((r) => r.command === "updates.install").length,
    ),
    0,
  );
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".workspace-tab")).toHaveCount(2);
  await expect(
    page
      .locator(".workspace-panel")
      .getByLabel("FILTER", { exact: true })
      .first(),
  ).toHaveValue('{ name: "keep this query" }');
  await expect(update).toBeVisible();
  await page.evaluate(() => window.emitJob(true));
  await update
    .getByRole("button", { name: "Restart and install", exact: true })
    .click();
  await expect(confirm).toBeVisible();
  const install = confirm.getByRole("button", {
    name: "Close tabs and install",
    exact: true,
  });
  await expect(install).toBeDisabled();
  await expect(confirm).toContainText("background work");
  await page.evaluate(() => window.emitJob(false));
  await expect(install).toBeEnabled();
  await page.evaluate(() => {
    window.failDraftSave = true;
  });
  await install.click();
  await expect(confirm).toContainText("QA draft save unavailable");
  await page.screenshot({ path: ".runtime/update-restart-ui/draft-error.png" });
  await expect(page.locator(".workspace-tab")).toHaveCount(2);
  assert.equal(
    await page.evaluate(
      () =>
        window.requests.filter((r) => r.command === "updates.install").length,
    ),
    0,
  );
  await page.evaluate(() => {
    window.failDraftSave = false;
  });
  await install.click();
  await expect(page.locator(".workspace-tab")).toHaveCount(0);
  await expect(confirm).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.requests
            .filter((r) => r.command === "updates.restartReady")
            .at(-1)?.payload.ready,
      ),
    )
    .toBe(true);
  const requests = await page.evaluate(() => window.requests);
  assert.equal(
    requests.filter((r) => r.command === "updates.install").length,
    1,
  );
  const installIndex = requests.findIndex(
    (r) => r.command === "updates.install",
  );
  const saved = requests
    .slice(0, installIndex)
    .findLast((r) => r.command === "shellDrafts.save");
  assert.equal(saved.payload.code, "const preservedForUpdate = true;");
  assert.equal(
    requests.some(
      (r) => r.command === "queries.run" || r.command === "shell.execute",
    ),
    false,
  );
  assert.deepEqual(errors, []);
  // The fixture never actually exits like Electron would. Release the simulated
  // restart input lock and close its page before shutting down Chromium.
  await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(true);
  await page.evaluate(() => window.finishRestartFixture());
  await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(false);
  console.log(
    "PASS update restart confirmation: cancel, busy work, draft failure, draft preservation, close tabs and ready handshake",
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  console.log("Closing restart fixture browser");
  await browserServer.kill();
  server.httpServer?.closeAllConnections();
  console.log("Closing restart fixture server");
  await server.close();
  console.log("Closed restart fixture");
}
