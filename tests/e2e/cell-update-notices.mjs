// Real App/CollectionTab/Results with an isolated database IPC boundary.
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
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.failWrite = false;
    window.failQuery = false;
    window.writes = [];
    const target = {
      connectionId: "qa",
      database: "qa_db",
      collection: "documents",
    };
    let value = "before";
    const row = () => ({
      ejson: JSON.stringify({ _id: "qa-1", name: value }),
      editable: true,
      source: { ...target, identity: '"qa-1"' },
    });
    window.workbench = {
      subscribe() {
        return () => {};
      },
      async request(command, payload) {
        const { settingsSchema, profileSchema } =
          await import("/src/shared/contracts.ts");
        switch (command) {
          case "settings.get":
            return settingsSchema.parse({
              language: "en",
              autoRunOnOpen: true,
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
          case "metadata.databases":
            return { names: ["qa_db"] };
          case "metadata.collections":
            return [{ name: "documents", type: "collection" }];
          case "queries.run":
            if (window.failQuery)
              throw new Error("Query rejected by QA server");
            return {
              rows: [row()],
              hasMore: false,
              cursorId: payload.cursorId,
            };
          case "documents.update":
            window.writes.push(payload);
            if (window.failWrite)
              throw new Error("Write rejected by QA server");
            value = JSON.parse(payload.value);
            return {
              row: row(),
              update: JSON.stringify({ $set: { name: value } }),
            };
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
  });
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page
    .locator(".connection-row")
    .filter({ hasText: "QA connection" })
    .locator(".tree-main")
    .click();
  await page.getByText("qa_db", { exact: true }).first().click();
  await page.getByText("documents", { exact: true }).first().click();
  const cell = page.locator(".grid-cell").filter({ hasText: /^before$/ });
  await cell.dblclick();
  await page
    .getByRole("textbox", { name: "Edit cell", exact: true })
    .fill("after");
  await page
    .getByRole("textbox", { name: "Edit cell", exact: true })
    .press("Enter");
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^after$/ }),
  ).toBeVisible();
  assert.equal(
    await page.locator(".output").count(),
    0,
    "Cell saves must not open the output panel",
  );
  await expect(page.locator(".toast.success")).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 6500 });
  await page.evaluate(() => (window.failQuery = true));
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".toast.error")).toContainText(
    "Query rejected by QA server",
  );
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 6500 });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".toast.error")).toBeVisible();
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.evaluate(() => (window.failQuery = false));
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".toast.success")).toContainText("Query completed");
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 6500 });
  await page
    .locator(".output")
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await page.evaluate(() => (window.failWrite = true));
  await page
    .locator(".grid-cell")
    .filter({ hasText: /^after$/ })
    .dblclick();
  await page
    .getByRole("textbox", { name: "Edit cell", exact: true })
    .fill("rejected");
  await page
    .getByRole("textbox", { name: "Edit cell", exact: true })
    .press("Enter");
  await expect(page.locator(".toast.error")).toContainText(
    "Write rejected by QA server",
  );
  await expect(
    page.getByRole("textbox", { name: "Edit cell", exact: true }),
  ).toHaveValue("rejected");
  assert.equal(await page.locator(".output").count(), 0);
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 6500 });
  assert.deepEqual(errors, []);
  console.log(
    "PASS inline save and failure: no output panel, five-second notices, failed draft retained",
  );
} finally {
  await browser.close();
  await server.close();
}
