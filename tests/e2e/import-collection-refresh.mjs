// Real App and transfer dialog, with an isolated file/database IPC fixture.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let listener;
    window.collectionReads = [];
    window.failMetadata = false;
    window.deferMetadata = false;
    window.metadataPending = [];
    window.emitJob = (data) => listener({ type: "job", data });
    window.emitImport = (
      status = "completed",
      jobId = "import-1",
      connectionId = "qa",
    ) => {
      listener({
        type: "job",
        data: {
          jobId,
          status,
          processed: 1,
          failed: 0,
          bytes: 128,
          message: "Finished",
          importTarget: { connectionId, database: "qa_db" },
        },
      });
    };
    let names = ["source"];
    window.addCollection = (name) => names.push(name);
    window.workbench = {
      subscribe(callback) {
        listener = callback;
        return () => {};
      },
      async request(command, payload) {
        const { settingsSchema, profileSchema } =
          await import("/src/shared/contracts.ts");
        switch (command) {
          case "settings.get":
            return settingsSchema.parse({
              language: "en",
              autoRunOnOpen: false,
              jobNotifications: "off",
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
              version: "0.1.2",
              platform: "win32",
              secureStorage: true,
              connections: ["qa"],
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
          case "metadata.collections":
            window.collectionReads.push(payload);
            if (window.failMetadata) throw new Error("QA metadata unavailable");
            const result = names.map((name) => ({ name, type: "collection" }));
            if (window.deferMetadata)
              return new Promise((resolve) =>
                window.metadataPending.push({ resolve, result }),
              );
            return result;
          case "files.choose":
            return "/qa/new.jsonl";
          case "transferJobs.start":
            assertImport(payload);
            names.push(payload.collection);
            // Completion may arrive before the start response.
            window.emitImport();
            return { jobId: "import-1" };
          case "connections.close":
            listener({
              type: "connection",
              data: { id: payload.id, connected: false },
            });
            return {};
          case "transferPresets.list":
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
    function assertImport(p) {
      if (
        p.direction !== "import" ||
        p.collection !== "new_collection" ||
        p.database !== "qa_db"
      )
        throw new Error("Unexpected import target");
    }
  });
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.locator(".connection-row .tree-main").click();
  const database = page
    .locator(".db-row")
    .filter({ has: page.getByRole("button", { name: "qa_db", exact: true }) });
  await database.locator(".tree-main").click();
  await page
    .locator(".collection-row .tree-main")
    .filter({ hasText: /^source$/ })
    .click({ button: "right" });
  await page
    .getByRole("button", { name: "Import collection", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Import & export" });
  await dialog.locator('[name="transfer-collection"]').fill("new_collection");
  await dialog
    .getByRole("button", { name: "Choose file", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Start transfer", exact: true })
    .click();
  const imported = page
    .locator(".collection-row .tree-main")
    .filter({ hasText: /^new_collection$/ });
  await expect(imported).toBeVisible();
  assert.equal(await page.evaluate(() => window.collectionReads.length), 2);
  // Final events are idempotent, and a closed database stays closed.
  await page.evaluate(() => window.emitImport());
  await database.locator(".tree-main").click();
  await page.evaluate(() => {
    window.addCollection("second_collection");
    window.emitImport("running", "import-2");
  });
  await page.evaluate(() => window.emitImport("completed", "import-2"));
  await expect
    .poll(() => page.evaluate(() => window.collectionReads.length))
    .toBe(3);
  await expect(database.locator(".tree-main")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await database.locator(".tree-main").click();
  await expect(
    page
      .locator(".collection-row .tree-main")
      .filter({ hasText: /^second_collection$/ }),
  ).toBeVisible();
  // An unrelated connection's import must not invalidate this metadata.
  const reads = await page.evaluate(() => window.collectionReads.length);
  await page.evaluate(() =>
    window.emitImport("completed", "foreign-import", "another-connection"),
  );
  await expect(
    page.locator(".collection-row .tree-main").filter({ hasText: /^source$/ }),
  ).toBeVisible();
  assert.equal(await page.evaluate(() => window.collectionReads.length), reads);
  // Export completions carry no import target and must not trigger refresh.
  await page.evaluate(() =>
    window.emitJob({
      jobId: "export-1",
      status: "completed",
      processed: 1,
      failed: 0,
      bytes: 128,
      message: "Export finished",
    }),
  );
  await page.getByText("Export finished", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.collectionReads.length), reads);
  // Two imports can finish close together. A late, older response must not
  // replace the newer collection list.
  await page.evaluate(() => {
    window.deferMetadata = true;
    window.emitImport("completed", "import-old");
  });
  await expect
    .poll(() => page.evaluate(() => window.metadataPending.length))
    .toBe(1);
  await page.evaluate(() => {
    window.addCollection("newest_collection");
    window.emitImport("completed", "import-new");
  });
  await expect
    .poll(() => page.evaluate(() => window.metadataPending.length))
    .toBe(2);
  await page.evaluate(() => {
    const pending = window.metadataPending[1];
    pending.resolve(pending.result);
  });
  const newest = page
    .locator(".collection-row .tree-main")
    .filter({ hasText: /^newest_collection$/ });
  await expect(newest).toBeVisible();
  await page.evaluate(async () => {
    const pending = window.metadataPending[0];
    pending.resolve(pending.result);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await expect(newest).toBeVisible();
  // Cancellation and failure can leave completed writes on the server.
  await page.evaluate(() => (window.deferMetadata = false));
  for (const status of ["cancelled", "failed"]) {
    const name = `partial_${status}`;
    await page.evaluate(
      ({ name, status }) => {
        window.addCollection(name);
        window.emitImport(status, `import-${status}`);
      },
      { name, status },
    );
    await expect(
      page
        .locator(".collection-row .tree-main")
        .filter({ hasText: new RegExp(`^${name}$`) }),
    ).toBeVisible();
  }
  // A metadata failure must keep the last valid list and report only a refresh
  // failure; it must not change the transfer's outcome.
  await page.evaluate(() => {
    window.failMetadata = true;
    window.emitImport("completed", "metadata-failure");
  });
  await expect(page.locator(".toast.error")).toContainText(
    "collection list could not refresh",
  );
  await expect(newest).toBeVisible();
  // Do not reconnect a connection merely because a later import event arrives.
  const beforeDisconnect = await page.evaluate(
    () => window.collectionReads.length,
  );
  await page.evaluate(async () => {
    await window.workbench.request("connections.close", { id: "qa" });
    window.emitImport("completed", "disconnected-import");
  });
  await expect(
    page.getByText("No active connections", { exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(() => window.collectionReads.length),
    beforeDisconnect,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS import collection refresh: right-click import, early completion, notifications off, deduplication, collapsed state, connection scope",
  );
} finally {
  await browser.close();
  await server.close();
}
