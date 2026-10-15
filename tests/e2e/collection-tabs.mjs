// Real application renderer; only the database IPC boundary is replaced.
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
    window.queries = [];
    let listener;
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
              connections: [],
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
            return { names: ["qa_db", "other_db"] };
          case "connections.open":
            listener({
              type: "connection",
              data: { id: payload.id, connected: true },
            });
            return { connected: true };
          case "metadata.collections":
            return [{ name: "documents", type: "collection" }];
          case "queries.run":
            window.queries.push(payload);
            return { rows: [], hasMore: false, cursorId: payload.cursorId };
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
  const collection = page.locator(".collection-row .tree-main").first();
  const tabs = page.locator(".workspace-tab");
  const active = () => page.locator(".workspace-panel.visible");
  const filter = () => active().getByLabel("FILTER", { exact: true });
  const selectTab = (index) =>
    tabs.nth(index).locator("button[aria-pressed]").click();

  // The first double-click is one gesture, and must not open two tabs.
  await collection.dblclick();
  await expect(tabs).toHaveCount(1);
  await filter().fill('{ name: "first" }');
  await collection.dblclick();
  await expect(tabs).toHaveCount(2);
  await expect(filter()).toHaveValue("{}");
  await filter().fill('{ name: "second" }');
  await collection.dblclick();
  await expect(tabs).toHaveCount(3);
  await expect(filter()).toHaveValue("{}");
  await selectTab(0);
  await expect(filter()).toHaveValue('{ name: "first" }');
  await active().getByRole("button", { name: "Run", exact: true }).click();
  await expect(active().locator(".results-wrapper")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await selectTab(1);
  await expect(filter()).toHaveValue('{ name: "second" }');
  await active().getByRole("button", { name: "Run", exact: true }).click();
  await expect(active().locator(".results-wrapper")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const queries = await page.evaluate(() => window.queries);
  assert.deepEqual(
    queries.map((q) => q.filter),
    ['{ name: "first" }', '{ name: "second" }'],
  );
  assert.notEqual(queries[0].cursorId, queries[1].cursorId);

  // Single-click/keyboard focus an existing tab; modifiers still create one.
  await collection.click();
  await expect(tabs).toHaveCount(3);
  await expect(filter()).toHaveValue('{ name: "second" }');
  await collection.click({ modifiers: ["Control"] });
  await expect(tabs).toHaveCount(4);
  await collection.click({ modifiers: ["Meta"] });
  await expect(tabs).toHaveCount(5);
  await collection.focus();
  await page.keyboard.press("Enter");
  await expect(tabs).toHaveCount(5);
  await page.keyboard.press("Space");
  await expect(tabs).toHaveCount(5);

  // The same collection name in another database is a different target.
  await page
    .locator(".sidebar .tree-main")
    .filter({ hasText: /^other_db$/ })
    .click();
  const otherDatabase = page
    .locator(".db-row")
    .filter({
      has: page.getByRole("button", { name: "other_db", exact: true }),
    })
    .locator("..");
  await otherDatabase.locator(".collection-row .tree-main").dblclick();
  await expect(tabs).toHaveCount(6);
  await expect(tabs.last().locator("button[aria-pressed]")).toHaveAttribute(
    "aria-label",
    "documents · QA connection / other_db",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS collection tabs: first/repeated double-click, isolated filters/cursors, click/keyboard reuse, Ctrl/Cmd, database scope",
  );
} finally {
  await browser.close();
  await server.close();
}
