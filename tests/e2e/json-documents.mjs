import { _electron as electron, expect } from "@playwright/test";
import { startTestMongo } from "./helpers/test-mongo.mjs";
import {
  MongoClient,
  ObjectId,
  Int32,
  Double,
  Long,
  Decimal128,
} from "mongodb";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";
import {
  prepareClipboardCheck,
  copiedText,
} from "./helpers/clipboard-check.mjs";

const hex = "507f1f77bcf86cd799439011";
const copyHex = "507f1f77bcf86cd799439012";
const dataDir = resolve(`.runtime/json-documents-qa-${Date.now()}`);
const server = await startTestMongo();
const client = await new MongoClient(server.getUri()).connect();
const collection = client.db("json_documents_qa").collection("documents");
let app;
try {
  await collection.insertOne({
    _id: new ObjectId(hex),
    details: {
      owner: new ObjectId(copyHex),
      observedAt: new Date("2025-01-02T03:04:05.000Z"),
      count: new Int32(7),
      score: new Double(1),
      total: Long.fromString("42"),
      nested: [{ price: Decimal128.fromString("1.20") }],
    },
    name: "before",
    count: new Int32(179),
    score: new Double(1),
    smallLong: Long.fromString("42"),
    largeLong: Long.fromString("9007199254740993"),
    price: Decimal128.fromString("1234.50"),
    createdAt: new Date("2025-01-02T03:04:05.000Z"),
  });
  const env = { ...process.env, WORKBENCH_USER_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [".", "--disable-gpu"],
    cwd: process.env.WORKBENCH_PROJECT_DIR || process.cwd(),
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await prepareClipboardCheck(app);
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  await page.evaluate(async (uri) => {
    const settings = await window.workbench.request("settings.get", {});
    await window.workbench.request("settings.set", {
      ...settings,
      language: "en",
      theme: "light",
      jsonExpandedDepth: 0,
      autoCheckUpdates: false,
    });
    await window.workbench.request("connections.save", {
      profile: {
        id: "json-qa",
        name: "JSON QA",
        uri,
        database: "json_documents_qa",
      },
    });
  }, `${server.getUri()}?retryWrites=true`);
  await page.reload();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 1000 });
  });
  await page
    .locator(".app-header")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .getByRole("button", { name: "JSON QA" })
    .click();
  await expect(
    page.locator(".connection-row").filter({ hasText: "JSON QA" }),
  ).toBeVisible({ timeout: 120000 });
  const editConnection = async () => {
    await page
      .getByRole("button", { name: "JSON QA connection menu", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Edit connection",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
    return dialog;
  };
  let connectionDialog = await editConnection();
  const retrySetting = () =>
    connectionDialog.locator('select[name="connection-retry-writes"]');
  await expect(retrySetting()).toHaveValue("default");
  await retrySetting().selectOption("false");
  await connectionDialog
    .getByRole("button", { name: "Save & connect", exact: true })
    .click();
  await expect(connectionDialog).not.toBeVisible();
  const savedConnection = await page.evaluate(async () => {
    const profiles = await window.workbench.request("connections.list", {});
    const exported = await window.workbench.request("connections.exportUri", {
      id: "json-qa",
      includePassword: false,
    });
    return {
      retryWrites: profiles.find((profile) => profile.id === "json-qa")
        .retryWrites,
      uri: exported.uri,
    };
  });
  expect(savedConnection.retryWrites).toBe(false);
  expect(new MongoClient(savedConnection.uri).options.retryWrites).toBe(false);
  connectionDialog = await editConnection();
  await expect(retrySetting()).toHaveValue("false");
  await connectionDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  console.log(
    "PASS retryable-write overrides persist through Advanced settings, reconnect and URI export",
  );
  await page
    .locator(".db-row")
    .getByRole("button", { name: "json_documents_qa", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "documents", exact: true })
    .click();
  const active = () => page.locator(".workspace-panel.visible");
  const openDocument = async (action, title) => {
    const cell = active().locator(".grid-cell.type-oid").first();
    await expect(cell).toBeVisible({ timeout: 30000 });
    await cell.click({ button: "right" });
    await active().getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  // Monaco virtualizes long documents; verify the editor's complete Copy content
  // payload at Electron's clipboard boundary, rather than only visible lines.
  const content = async (dialog) => {
    await expect(dialog.locator(".monaco-editor")).toBeVisible();
    await app.evaluate(() => {
      globalThis.irwinTestClipboardText = undefined;
    });
    await dialog
      .getByRole("button", { name: "Copy content", exact: true })
      .click();
    await expect.poll(() => copiedText(app, false)).not.toBeUndefined();
    return copiedText(app, false);
  };
  const checkFriendly = async (dialog, count = 179, score = "1.0") => {
    await expect
      .poll(() => content(dialog))
      .toMatch(new RegExp(`count:\\s*${count}`));
    await expect
      .poll(() => content(dialog))
      .toMatch(new RegExp(`score:\\s*${score.replaceAll(".", "\\.")}`));
    const text = await content(dialog);
    expect(text).toMatch(/largeLong:\s*9007199254740993/);
    expect(text).toMatch(/price:\s*1234\.50/);
    expect(text).toContain(`ObjectId("${hex}")`);
    expect(text).toContain('ISODate("2025-01-02T03:04:05.000Z")');
    expect(text).not.toMatch(/(?:Int32|Long|Double|Decimal128)\(/);
  };
  const enterDocument = async (dialog, text) => {
    await dialog.locator(".monaco-editor").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(text);
    // Monaco auto-closes the opening brace for Playwright's text input event.
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Backspace");
  };
  const plainDocument = (id = hex, count = 180, score = "2") => `{
    _id: ObjectId("${id}"), name: "edited", count: ${count}, score: ${score},
    smallLong: 43, largeLong: 9007199254740993, price: 1234.50,
    createdAt: ISODate("2025-01-02T03:04:05.000Z")
  }`;
  const stored = async (id = hex) =>
    collection.findOne(
      { _id: new ObjectId(id) },
      { promoteValues: false, promoteLongs: false },
    );
  const checkTypes = (doc, scoreType = "Double") => {
    expect(doc.count._bsontype).toBe("Int32");
    expect(doc.count.valueOf()).toBe(180);
    expect(doc.score._bsontype).toBe(scoreType);
    expect(doc.smallLong._bsontype).toBe("Long");
    expect(doc.smallLong.toString()).toBe("43");
    expect(doc.largeLong.toString()).toBe("9007199254740993");
    expect(doc.price._bsontype).toBe("Decimal128");
    expect(doc.price.toString()).toBe("1234.50");
    expect(doc.createdAt.toISOString()).toBe("2025-01-02T03:04:05.000Z");
  };

  let dialog = await openDocument("View JSON", "View JSON");
  await checkFriendly(dialog);
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  console.log(
    "PASS JSON view displays plain numbers, exact large integers, dates and ObjectIds",
  );

  const detailsCell = active().locator(".grid-cell.type-object").first();
  await detailsCell.dblclick();
  dialog = page.getByRole("dialog", {
    name: "Edit field · details",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect.poll(() => content(dialog)).toContain("owner");
  const detailsText = await content(dialog);
  expect(detailsText).toContain(`ObjectId("${copyHex}")`);
  expect(detailsText).toContain('ISODate("2025-01-02T03:04:05.000Z")');
  expect(detailsText).not.toMatch(
    /\$(?:oid|date|numberInt|numberLong|numberDouble|numberDecimal)|(?:Int32|Long|Double|Decimal128)\(/,
  );
  await enterDocument(
    dialog,
    `{
    owner: ObjectId("${copyHex}"), observedAt: ISODate("2025-01-02T03:04:05.000Z"),
    count: 8, score: 2, total: 43, nested: [{ price: 1.234567890123456789012345678901234 }]
  }`,
  );
  await dialog
    .getByRole("button", { name: "Format document", exact: true })
    .click();
  expect(await content(dialog)).not.toMatch(
    /\$(?:oid|date|numberInt|numberLong|numberDouble|numberDecimal)/,
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const fieldStored = (await stored()).details;
  expect(fieldStored.owner.toHexString()).toBe(copyHex);
  expect(fieldStored.observedAt.toISOString()).toBe("2025-01-02T03:04:05.000Z");
  expect(fieldStored.count._bsontype).toBe("Int32");
  expect(fieldStored.score._bsontype).toBe("Double");
  expect(fieldStored.total._bsontype).toBe("Long");
  expect(fieldStored.total.toString()).toBe("43");
  expect(fieldStored.nested[0].price._bsontype).toBe("Decimal128");
  expect(fieldStored.nested[0].price.toString()).toBe(
    "1.234567890123456789012345678901234",
  );
  console.log(
    "PASS nested JSON field editing uses simple format and preserves BSON types and precision",
  );
  await expect(active().locator("details.output pre")).toContainText(
    `ObjectId("${copyHex}")`,
  );
  await expect(active().locator("details.output pre")).not.toContainText(
    "$oid",
  );

  await detailsCell.dblclick();
  dialog = page.getByRole("dialog", {
    name: "Edit field · details",
    exact: true,
  });
  await expect.poll(() => content(dialog)).toContain("owner");
  const fieldEdit = (count) => `{
    owner: ObjectId("${copyHex}"), observedAt: ISODate("2025-01-02T03:04:05.000Z"),
    count: ${count}, score: 2, total: 43, nested: [{ price: 1.234567890123456789012345678901234 }]
  }`;
  await enterDocument(dialog, fieldEdit(9));
  await collection.updateOne(
    { _id: new ObjectId(hex) },
    { $set: { "details.count": new Int32(10) } },
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.locator(".notice.error")).toContainText("Conflict:");
  await expect(dialog.getByRole("status")).toContainText(
    "current database version",
  );
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const fieldChanges = page.getByRole("dialog", {
    name: "Document changes",
    exact: true,
  });
  await expect(fieldChanges.locator(".document-change-list")).toContainText(
    "count",
  );
  await fieldChanges
    .getByRole("button", { name: "Use database version", exact: true })
    .click();
  await fieldChanges
    .getByRole("button", { name: "Keep current edit", exact: true })
    .click();
  await expect.poll(() => content(dialog)).toMatch(/count:\s*10/);
  expect(await content(dialog)).not.toContain("_id:");
  await enterDocument(dialog, fieldEdit(11));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const resolvedFieldDoc = await stored();
  expect(resolvedFieldDoc.name).toBe("before");
  expect(resolvedFieldDoc.count.valueOf()).toBe(179);
  expect(resolvedFieldDoc.details.count.valueOf()).toBe(11);
  expect(resolvedFieldDoc.details.score._bsontype).toBe("Double");
  expect(resolvedFieldDoc.details.total._bsontype).toBe("Long");
  console.log(
    "PASS field conflict refresh and retry stay scoped to the edited field",
  );

  dialog = await openDocument("Edit document", "Edit document");
  await checkFriendly(dialog);
  await enterDocument(dialog, plainDocument());
  await dialog
    .getByRole("button", { name: "Format document", exact: true })
    .click();
  await checkFriendly(dialog, 180, "2.0");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  checkTypes(await stored());
  console.log(
    "PASS plain-number edits and formatting preserve numeric BSON types on the server",
  );

  dialog = await openDocument("Edit document", "Edit document");
  await enterDocument(dialog, plainDocument(hex, 2147483648));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.locator(".notice.error")).toContainText(/int32/i);
  checkTypes(await stored());
  await enterDocument(
    dialog,
    plainDocument(hex, 180, '{ $numberDecimal: "4.50" }'),
  );
  await dialog
    .getByRole("button", { name: "Format document", exact: true })
    .click();
  await checkFriendly(dialog, 180, "4.50");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const changes = page.getByRole("dialog", {
    name: "Document changes",
    exact: true,
  });
  await expect(changes.locator(".document-change-list")).toContainText("score");
  await changes
    .getByRole("button", { name: "Keep current edit", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  checkTypes(await stored(), "Decimal128");
  expect((await stored()).score.toString()).toBe("4.50");
  console.log(
    "PASS overflowing edits are blocked and explicit Extended JSON type changes survive formatting",
  );

  dialog = await openDocument("Copy document", "Copy document");
  await enterDocument(dialog, plainDocument(copyHex, 180, "4.50"));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  checkTypes(await stored(copyHex), "Decimal128");
  console.log(
    "PASS copying a document preserves types and numeric precision without formatting",
  );

  await active()
    .getByRole("button", { name: "Add document", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Add document", exact: true });
  await expect(dialog).toBeVisible();
  const nestedDocument = {
    cardId: "add-doc-nested-qa",
    title: "巢狀 JSON 測試",
    ready: true,
    gridLayout: { w: 8, h: 20 },
    inputs: ["record"],
    providerConfig: {
      panel: {
        calculations: [
          {
            pairing: { maxDateDifferenceDays: 0 },
            computedFields: [
              {
                formula: "first / second * 100",
                precision: 2,
                defaultValue: null,
              },
            ],
          },
        ],
        fields: [{ format: "{value} µg/dL", defaultValue: null }],
      },
    },
  };
  await enterDocument(dialog, JSON.stringify(nestedDocument, null, 2));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await collection.countDocuments({ cardId: nestedDocument.cardId }),
  ).toBe(1);
  const added = await collection.findOne({ cardId: nestedDocument.cardId });
  delete added._id;
  expect(added).toEqual(nestedDocument);
  console.log(
    "PASS Add Doc saves pasted nested JSON exactly once with retryable writes disabled",
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    const body = await page.locator("body").innerText();
    await writeFile(resolve(dataDir, "failure-screen.txt"), body);
    console.error(body.slice(0, 4000));
  }
  throw error;
} finally {
  let closeError;
  if (app) {
    await closeElectronWindowNormally(app).catch((error) => {
      closeError = error;
      app.process().kill();
    });
  }
  await client.close();
  await server.stop();
  if (closeError) throw closeError;
}
