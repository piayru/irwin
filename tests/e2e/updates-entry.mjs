// Runs the real application renderer with an isolated IPC fixture. Native
// downloading/installation is covered separately by updates-native.mjs.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";

const output = ".runtime/updates-entry";
await mkdir(output, { recursive: true });
const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { ignored: ["**/.runtime/**"] },
  },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
try {
  for (const language of ["zh", "en"]) {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ language }) => {
        window.requests = [];
        window.updateStatus = {
          state: "available",
          currentVersion: "0.1.2",
          availableVersion: "0.2.0",
          delivery: "automatic",
          releaseName: "Irwin 0.2.0",
          releaseNotes: "Reviewed release notes: fixes and improvements.",
        };
        let listener;
        window.emitUpdate = (update) => {
          window.updateStatus = { ...window.updateStatus, ...update };
          listener({ type: "update", data: window.updateStatus });
        };
        window.workbench = {
          subscribe(callback) {
            listener = callback;
            return () => {};
          },
          async request(command, payload) {
            window.requests.push({ command, payload });
            switch (command) {
              case "settings.get": {
                const { settingsSchema } =
                  await import("/src/shared/contracts.ts");
                return settingsSchema.parse({ language, theme: "dark" });
              }
              case "workspace.get":
                return {
                  version: 1,
                  sidebarWidth: 270,
                  jobsHeight: 180,
                  historyHeight: 180,
                };
              case "app.status":
                return {
                  version: "0.1.2",
                  platform: "win32",
                  secureStorage: true,
                  connections: [],
                  update: window.updateStatus,
                };
              case "updates.check":
                return window.updateStatus;
              case "updates.install":
                window.emitUpdate({ state: "downloading", progress: 0 });
                return;
              case "connections.list":
              case "shellDrafts.list":
              case "history.list":
              case "savedQueries.list":
              case "operationReceipts.list":
                return [];
              default:
                return {};
            }
          },
        };
      },
      { language },
    );
    await page.goto(server.resolvedUrls.local[0], {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    const version = page.locator("button.version-update-available");
    await version.waitFor();
    await version.click();
    const dialog = page.locator("dialog.update-modal[open]");
    await dialog.waitFor();
    assert.ok(
      await dialog
        .getByText("Reviewed release notes: fixes and improvements.", {
          exact: true,
        })
        .isVisible(),
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.requests.filter(({ command }) => command.startsWith("updates.")),
      ),
      [],
      "Opening available release notes must not check again or initiate a download",
    );
    const confirmName =
      language === "zh" ? "確認下載並更新" : "Confirm download and update";
    await dialog
      .getByRole("button", { name: confirmName, exact: true })
      .waitFor();
    await page.screenshot({ path: `${output}/notes-${language}.png` });
    console.log(`Release notes opened (${language})`);
    const closeName = language === "zh" ? "關閉" : "Close";
    await dialog
      .getByRole("button", { name: closeName, exact: true })
      .last()
      .click();
    assert.equal(await page.locator("dialog.update-modal[open]").count(), 0);
    assert.equal(
      await page.evaluate(() =>
        window.requests.some(({ command }) => command === "updates.install"),
      ),
      false,
    );
    await version.click();
    console.log(`Release notes reopened (${language})`);
    // Keep confirmation reachable when real notes exceed the dialog height.
    await page.setViewportSize({ width: 1000, height: 650 });
    await page.evaluate(() =>
      window.emitUpdate({
        releaseNotes:
          "Reviewed release notes: fixes and improvements.\n" +
          "A detailed change that should wrap inside the release notes panel.\n".repeat(
            50,
          ),
      }),
    );
    const notes = dialog.locator(".release-notes-content");
    await page.waitForFunction(() => {
      const notes = document.querySelector(".update-modal .modal-body");
      return notes && notes.scrollHeight > notes.clientHeight;
    });
    console.log(`Long release notes ready (${language})`);
    const bounds = await dialog
      .getByRole("button", { name: confirmName, exact: true })
      .boundingBox();
    assert.ok(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 1000 &&
        bounds.y + bounds.height <= 650,
    );
    await page.screenshot({ path: `${output}/notes-long-${language}.png` });
    await dialog
      .getByRole("button", { name: confirmName, exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          window.requests.filter(({ command }) => command === "updates.install")
            .length,
      ),
      1,
    );
    await dialog.getByRole("progressbar").waitFor();
    assert.ok(await notes.isVisible());
    assert.ok(
      (await notes.textContent()).includes(
        "Reviewed release notes: fixes and improvements.",
      ),
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: confirmName, exact: true })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${language}: version entry, release notes, dismiss, explicit download, progress`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
