import { _electron as electron, expect } from "@playwright/test";
import { MongoClient, Int32 } from "mongodb";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { startTestMongo } from "./helpers/test-mongo.mjs";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";

const server = await startTestMongo();
const client = await new MongoClient(server.getUri()).connect();
const origin = client.db("shell_ui_initial").collection("docs");
const actual = client.db("shell_ui_actual").collection("originals");
const initial = {
  _id: "same",
  value: new Int32(1),
  hidden: "keep",
  nested: { count: new Int32(1) },
};
await origin.insertOne(initial);
await actual.insertOne(initial);
const checks = [],
  errors = [],
  upstreamDiagnostics = [];
let passed = false,
  failure;
const lifecycle = [];
let app, page;
const active = () => page.locator(".workspace-panel.visible");
const cell = () => active().locator('.grid-cell[aria-colindex="3"]').first();
const modal = () =>
  page.getByRole("dialog", { name: "Edit document", exact: true });
const paste = async (editor, text) => {
  await expect(editor).toBeVisible({ timeout: 60000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), text);
  await page.keyboard.press("ControlOrMeta+v");
};
const query = async (code) => {
  await paste(active().locator(".shell-editor .monaco-editor"), code);
  await active().getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    active().getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled({ timeout: 90000 });
  await expect(active().locator(".grid-row").first()).toBeVisible();
};
const findOne =
  'db.getSiblingDB("shell_ui_actual").getCollection("originals").findOne({_id:"same"})';
const openEdit = async () => {
  await cell().click({ button: "right" });
  await active()
    .getByRole("button", { name: "Edit document", exact: true })
    .click();
  await expect(modal()).toBeVisible();
  await expect(modal().locator(".document-context")).toContainText(
    "shell_ui_actual.originals",
  );
};
try {
  await mkdir(".runtime/screenshots", { recursive: true });
  const userDataPath = resolve(`.runtime/shell-editing-qa-${Date.now()}`);
  const env = {
    ...process.env,
    WORKBENCH_USER_DATA: userDataPath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WORKBENCH_DEV_URL;
  app = await electron.launch({
    executablePath: process.env.WORKBENCH_EXECUTABLE,
    args: [
      ...(process.env.WORKBENCH_EXECUTABLE ? [] : ["."]),
      "--disable-gpu",
      `--user-data-dir=${userDataPath}`,
    ],
    env,
    // Match the existing desktop acceptance allowance for a cold mongosh
    // utility-process launch; ordinary query/server timeouts are unchanged.
    timeout: 90000,
  });
  app.process().stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (/debugger|QA lifecycle|Error/i.test(text)) lifecycle.push(text);
  });
  await app.evaluate(({ app }) => {
    for (const event of [
      "before-quit",
      "will-quit",
      "quit",
      "window-all-closed",
    ])
      app.on(event, () => process.stderr.write(`QA lifecycle: ${event}\n`));
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => {
    // Match the existing desktop suite's two known optional Monaco services;
    // keep them visible in the receipt rather than treating them as app errors.
    if (
      /UNKNOWN service (ICodeLensCache|treeViewsDndService)\b/.test(
        error.message,
      )
    )
      upstreamDiagnostics.push(error.message);
    else errors.push(error.message);
  });
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  await page.evaluate(async (uri) => {
    const settings = await window.workbench.request("settings.get", {});
    await window.workbench.request("settings.set", {
      ...settings,
      language: "en",
      theme: "light",
      autoCheckUpdates: false,
      autoRunOnOpen: true,
    });
    await window.workbench.request("connections.save", {
      profile: {
        id: "shell-edit-qa",
        name: "Shell editing QA",
        uri,
        database: "shell_ui_initial",
      },
    });
  }, server.getUri());
  await page.reload();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 1000 }),
  );
  await page
    .locator(".app-header")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .getByRole("button", { name: "Shell editing QA" })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "shell_ui_initial", exact: true })
    .click();
  const treeRow = page
    .locator(".collection-row")
    .filter({ has: page.getByRole("button", { name: "docs", exact: true }) });
  await treeRow.getByRole("button", { name: "docs", exact: true }).click();
  await expect(cell()).toBeVisible();
  await active()
    .getByRole("button", { name: "Free command", exact: true })
    .click();
  await query(findOne);
  await cell().dblclick();
  const inline = cell().locator("input");
  await inline.fill("3");
  await inline.press("Enter");
  await expect
    .poll(async () => (await actual.findOne({ _id: "same" }))?.value)
    .toBe(3);
  expect((await origin.findOne({ _id: "same" }))?.value).toBe(1);
  await expect(
    active().getByRole("button", { name: "Delete document", exact: true }),
  ).toBeDisabled();
  checks.push(
    "Free-mode findOne edits only its verified sibling-database source",
  );

  // Same _id in two namespaces must not make copy/delete or a full replacement
  // target the collection associated with the original tab.
  await query(findOne.replace('({_id:"same"})', '({_id:"same"},{value:1})'));
  await openEdit();
  await expect(modal().locator(".view-lines")).toContainText("hidden");
  await page.screenshot({
    path: ".runtime/screenshots/shell-editing-projected.png",
  });
  await paste(
    modal().locator(".monaco-editor"),
    '{ _id:"same", value:3, hidden:"keep", nested:{count:3} }',
  );
  await modal().getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal()).toHaveCount(0);
  const saved = await actual.findOne({ _id: "same" }, { promoteValues: false });
  expect(saved.hidden).toBe("keep");
  expect(saved.nested.count._bsontype).toBe("Int32");
  expect(saved.nested.count.valueOf()).toBe(3);
  expect((await origin.findOne({ _id: "same" }))?.nested.count).toBe(1);
  checks.push(
    "Whole-document editing refetches projected hidden fields, preserves BSON and shows the actual namespace",
  );

  await query(findOne);
  await cell().dblclick();
  await inline.fill("5");
  await actual.updateOne({ _id: "same" }, { $set: { value: 4 } });
  await inline.press("Enter");
  await expect(cell().locator(".cell-error")).toContainText("Conflict");
  expect((await actual.findOne({ _id: "same" }))?.value).toBe(4);
  await inline.press("Escape");
  checks.push(
    "Concurrent inline edits conflict instead of overwriting server changes",
  );

  await query(findOne);
  await openEdit();
  await paste(
    modal().locator(".monaco-editor"),
    '{ _id:"same", value:7, hidden:"keep", nested:{count:3} }',
  );
  await actual.updateOne({ _id: "same" }, { $set: { value: 6 } });
  await modal().getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal().locator(".document-error")).toContainText("Conflict");
  await expect(modal()).toContainText(
    "The current database version was loaded",
  );
  await page.screenshot({
    path: ".runtime/screenshots/shell-editing-conflict.png",
  });
  await modal()
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const differences = page.getByRole("dialog", {
    name: "Document changes",
    exact: true,
  });
  await differences
    .getByRole("button", { name: "Use database version", exact: true })
    .click();
  await differences
    .getByRole("button", { name: "Keep current edit", exact: true })
    .click();
  await expect(modal().locator(".view-lines")).toContainText("6");
  await modal()
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  expect((await actual.findOne({ _id: "same" }))?.value).toBe(6);
  expect((await origin.findOne({ _id: "same" }))?.value).toBe(1);
  checks.push(
    "Whole-document conflicts and refresh remain bound to the original result source",
  );

  for (const code of [
    'db.getSiblingDB("shell_ui_actual").originals.aggregate([{$match:{_id:"same"}}])',
    'db.getSiblingDB("shell_ui_actual").originals.find({_id:"same"}).map(d=>({...d,value:99}))',
    '({_id:"same",value:99})',
    'db.getSiblingDB("shell_ui_actual").originals.findOne({_id:"same"},{value:{$literal:99}})',
  ]) {
    await query(code);
    await cell().click({ button: "right" });
    await expect(
      active().getByRole("button", { name: "Edit document", exact: true }),
    ).toBeDisabled();
    await expect(
      active()
        .getByRole("button", { name: "Delete document", exact: true })
        .last(),
    ).toBeDisabled();
    await cell().click();
  }
  checks.push(
    "Aggregation, mapping, fabricated documents and computed projections remain read-only",
  );

  await treeRow
    .getByRole("button", { name: "Collection menu", exact: true })
    .click();
  await page
    .locator(".collection-context-menu")
    .getByRole("button", { name: "Shell", exact: true })
    .click();
  await query(findOne.replace("findOne", "find"));
  await cell().dblclick();
  await inline.fill("8");
  await inline.press("Enter");
  await expect
    .poll(async () => (await actual.findOne({ _id: "same" }))?.value)
    .toBe(8);
  expect((await origin.findOne({ _id: "same" }))?.value).toBe(1);
  checks.push("A standalone Shell tab can edit an attributable find result");
  expect(errors).toEqual([]);
  passed = true;
} catch (error) {
  failure = String(error);
  if (page && !page.isClosed())
    await page.screenshot({
      path: ".runtime/screenshots/shell-editing-failure.png",
    });
  throw error;
} finally {
  try {
    if (app) await closeElectronWindowNormally(app);
    checks.push("Normal window close exits Electron successfully");
  } catch (error) {
    passed = false;
    failure = String(error);
    throw error;
  } finally {
    await writeFile(
      ".runtime/shell-editing-results.json",
      JSON.stringify(
        { passed, checks, errors, upstreamDiagnostics, failure, lifecycle },
        null,
        2,
      ),
    );
    await client.close();
    await server.stop();
  }
}
console.log(
  JSON.stringify({ passed, checks, errors, upstreamDiagnostics }, null, 2),
);
