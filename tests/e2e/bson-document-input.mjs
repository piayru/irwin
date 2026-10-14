// Exercise the real editor/formatter and inspect its canonical IPC payloads.
// Storage fidelity is verified against real MongoDB in integration.test.ts.
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
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.writes = [];
    let document;
    const target = {
      connectionId: "qa",
      database: "qa_db",
      collection: "documents",
    };
    const row = () => ({
      ejson: JSON.stringify(document),
      editable: true,
      source: { ...target, identity: JSON.stringify(document._id) },
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
          case "metadata.collections":
            return [{ name: "documents", type: "collection" }];
          case "queries.run":
            return {
              cursorId: payload.cursorId,
              rows: document ? [row()] : [],
              hasMore: false,
            };
          case "documents.insert":
          case "documents.replace":
            document = JSON.parse(payload.document);
            window.writes.push({ command, document });
            return command === "documents.insert"
              ? JSON.stringify({ acknowledged: true, insertedId: document._id })
              : row();
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
  });
  await page.goto(server.resolvedUrls.local[0], {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.locator(".connection-row .tree-main").click();
  await page.locator(".db-row .tree-main").click();
  await page.locator(".collection-row .tree-main").click();
  const active = () => page.locator(".workspace-panel.visible");
  const enter = async (dialog, source) => {
    await dialog.locator(".monaco-editor").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(source);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Backspace"); // Monaco's automatically closed root brace.
  };
  const source = `{
    _id:new ObjectId("507f1f77bcf86cd799439011"),
    title:"測試文件",displayOrder:NumberInt(-1),
    gridLayout:{w:NumberInt(8),h:NumberInt(20)},
    total:NumberLong(9007199254740993),ratio:new Double(1.25),
    price:NumberDecimal(1.234567890123456789012345678901234),
    groups:[{ranges:[["001","009"]]}],
    providerConfig:{createdAt:new Date(),updatedAt:new Date()},
    createdAt:new Date(),updatedAt:new Date()
  }`;
  await active()
    .getByRole("button", { name: "Add document", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Add document", exact: true });
  await enter(dialog, source);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let writes = await page.evaluate(() => window.writes);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].document.displayOrder, { $numberInt: "-1" });
  const open = async () => {
    await active()
      .locator(".grid-cell.type-oid")
      .first()
      .click({ button: "right" });
    await active()
      .getByRole("button", { name: "Edit document", exact: true })
      .click();
    return page.getByRole("dialog", { name: "Edit document", exact: true });
  };
  dialog = await open();
  await enter(dialog, source.replace("NumberInt(-1)", "new Int32(5)"));
  await dialog
    .getByRole("button", { name: "Format document", exact: true })
    .click();
  await expect(dialog.locator(".notice.error")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  writes = await page.evaluate(() => window.writes);
  assert.equal(writes.length, 2);
  const saved = writes[1].document;
  assert.deepEqual(saved.displayOrder, { $numberInt: "5" });
  assert.deepEqual(saved.gridLayout, {
    w: { $numberInt: "8" },
    h: { $numberInt: "20" },
  });
  assert.deepEqual(saved.total, { $numberLong: "9007199254740993" });
  assert.deepEqual(saved.ratio, { $numberDouble: "1.25" });
  assert.deepEqual(saved.price, {
    $numberDecimal: "1.234567890123456789012345678901234",
  });
  assert.deepEqual(saved.groups, [{ ranges: [["001", "009"]] }]);
  for (const date of [
    saved.createdAt,
    saved.updatedAt,
    saved.providerConfig.createdAt,
    saved.providerConfig.updatedAt,
  ])
    assert.match(date.$date.$numberLong, /^\d+$/);
  dialog = await open();
  await enter(dialog, source.replace("NumberInt(-1)", "NumberInt(2147483648)"));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.locator(".notice.error")).toContainText(
    /int32 out of range/,
  );
  assert.equal(await page.evaluate(() => window.writes.length), 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS BSON document input: add, edit, format, precise IPC values and blocked overflow",
  );
} finally {
  await browser.close();
  await server.close();
}
