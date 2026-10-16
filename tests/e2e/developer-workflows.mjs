import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient, Long, ObjectId } from "mongodb";
import { startTestMongo } from "./helpers/test-mongo.mjs";
const exec = promisify(execFile),
  directory = resolve(`.runtime/workflows-${Date.now()}`);
await mkdir(directory, { recursive: true });
const server = await startTestMongo(),
  client = await new MongoClient(server.getUri()).connect();
const firstId = new ObjectId(),
  collection = client.db("workflow_qa").collection("orders");
await collection.insertMany(
  Array.from({ length: 205 }, (_, n) => ({
    _id: n === 0 ? firstId : new ObjectId(),
    n,
    large: Long.fromString("9007199254740993"),
    team: n % 2 ? "A" : "B",
  })),
);
await collection.createIndex({ n: 1 });
const env = {
  ...process.env,
  WORKBENCH_USER_DATA: resolve(directory, "user-data"),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.WORKBENCH_DEV_URL;
let app, page;
const checks = [],
  errors = [];
const active = () => page.locator(".workspace-panel.visible");
const collectionAction = async (name) => {
  await active().locator(".toolbar-more > summary").click();
  await active().getByRole("button", { name, exact: true }).click();
};
const modal = (name) => page.getByRole("dialog", { name, exact: true });
const close = async (dialog) =>
  dialog
    .locator(".modal-head")
    .getByRole("button", { name: "Close", exact: true })
    .click();
const savePath = async (path) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.acceptanceSaveOptions = options;
      return { canceled: false, filePath: path };
    };
  }, path);
const openPath = async (path) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, path);
async function launch() {
  app = await electron.launch({
    ...(process.env.WORKBENCH_EXECUTABLE
      ? { executablePath: process.env.WORKBENCH_EXECUTABLE }
      : {}),
    args: [...(process.env.WORKBENCH_EXECUTABLE ? [] : ["."]), "--disable-gpu"],
    env,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
}
async function connect() {
  await page
    .locator(".app-header")
    .getByRole("button", { name: /^Connections/ })
    .click();
  await page
    .locator(".connection-picker-item")
    .filter({ hasText: "Workflow QA" })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "workflow_qa", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "orders", exact: true })
    .click();
  await expect(active().locator(".result-toolbar")).toContainText("100 loaded");
}
try {
  await launch();
  await page.evaluate(async (uri) => {
    const settings = await window.workbench.request("settings.get", {});
    await window.workbench.request("settings.set", {
      ...settings,
      language: "en",
      autoRunOnOpen: true,
    });
    await window.workbench.request("connections.save", {
      profile: {
        id: "workflow-qa",
        name: "Workflow QA",
        uri,
        database: "workflow_qa",
      },
    });
  }, server.getUri());
  await page.reload();
  await connect();
  await active()
    .getByRole("button", { name: "Next batch", exact: true })
    .click();
  await expect(active().locator(".result-toolbar")).toContainText("100 loaded");
  const csvPath = resolve(directory, "loaded.csv");
  await savePath(csvPath);
  await active()
    .getByRole("button", { name: "Export results", exact: true })
    .click();
  await modal("Export query results")
    .getByRole("button", { name: "Export 100 loaded rows (CSV)", exact: true })
    .click();
  await expect
    .poll(async () => {
      try {
        return (await readFile(csvPath, "utf8")).trim().split("\n").length;
      } catch {
        return 0;
      }
    })
    .toBe(101);
  assert.equal(
    await app.evaluate(() => globalThis.acceptanceSaveOptions.defaultPath),
    "orders-loaded.csv",
  );
  checks.push("loaded export: 100 rows and explicit default filename");
  const fullPath = resolve(directory, "all.jsonl");
  await savePath(fullPath);
  await active()
    .getByRole("button", { name: "Export results", exact: true })
    .click();
  await modal("Export query results")
    .getByRole("button", {
      name: "Stream all matching documents (Extended JSON)",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  assert.equal(
    await app.evaluate(() => globalThis.acceptanceSaveOptions.defaultPath),
    "orders-all-matching.jsonl",
  );
  await page
    .getByRole("button", { name: "Start transfer", exact: true })
    .click();
  await expect
    .poll(async () => {
      try {
        return (await readFile(fullPath, "utf8")).trim().split("\n").length;
      } catch {
        return 0;
      }
    })
    .toBe(205);
  checks.push(
    "all matching export ignores the visible page offset and writes 205 documents",
  );
  const codePath = resolve(directory, "query.mjs");
  await savePath(codePath);
  await collectionAction("Query delivery");
  await modal("Query delivery")
    .getByRole("button", { name: "Export code", exact: true })
    .click();
  const generated = await readFile(codePath, "utf8");
  assert.ok(generated.includes("MONGODB_URI"));
  const executed = await exec(process.execPath, [codePath], {
    env: { ...process.env, MONGODB_URI: server.getUri() },
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = executed.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(output.length, 205);
  assert.equal(output[0].large.$numberLong, "9007199254740993");
  checks.push(
    "generated Node.js driver code actually executes and preserves Int64",
  );
  await modal("Query delivery")
    .getByLabel("Target language")
    .selectOption("python");
  await savePath(resolve(directory, "query.py"));
  await modal("Query delivery")
    .getByRole("button", { name: "Export code", exact: true })
    .click();
  const python = await readFile(resolve(directory, "query.py"), "utf8");
  assert.ok(python.includes('os.environ["MONGODB_URI"]'));
  await close(modal("Query delivery"));
  await collectionAction("Explain query");
  const explain = modal("Explain · executionStats");
  await explain.locator('[name="explain-hint"]').fill("{n:1}");
  await explain.locator('[name="explain-collation"]').fill('{locale:"simple"}');
  await explain
    .getByRole("button", { name: "Run / compare again", exact: true })
    .click();
  await expect(explain).toContainText("Indexes used: n_1");
  const first = await page.evaluate(() =>
    window.workbench.request("diagnostics.list", {}),
  );
  assert.equal(first.length, 1);
  assert.equal(first[0].input.hint, "{n:1}");
  assert.ok(first[0].serverVersion.startsWith("8."));
  assert.ok(!JSON.stringify(first[0]).includes("mongodb://"));
  await explain.getByLabel("Comparison baseline").selectOption(first[0].id);
  await explain.locator('[name="explain-filter"]').fill("{n:{$gte:200}}");
  await explain
    .getByRole("button", { name: "Run / compare again", exact: true })
    .click();
  await expect(explain.locator(".explain-runs > section")).toHaveCount(2);
  const recordPath = resolve(directory, "diagnostic.json");
  await savePath(recordPath);
  await explain
    .getByRole("button", { name: "Export latest record", exact: true })
    .click();
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  assert.equal(record.input.filter, "{n:{$gte:200}}");
  assert.ok(JSON.parse(record.indexes).some((index) => index.name === "n_1"));
  await openPath(recordPath);
  await explain
    .getByRole("button", { name: "Import record", exact: true })
    .click();
  await modal("Diagnostic import preview")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(modal("Diagnostic import preview")).toHaveCount(0);
  assert.equal(
    (
      await page.evaluate(() =>
        window.workbench.request("diagnostics.list", {}),
      )
    ).length,
    3,
  );
  await close(explain);
  checks.push(
    "Find diagnostics: hint/collation, persisted plans, baseline comparison and JSON round trip",
  );
  await collectionAction("Save query");
  const saved = modal("Save / edit query");
  await saved.getByLabel("Query name", { exact: true }).fill("By ObjectId");
  await saved
    .getByLabel("FILTER", { exact: true })
    .fill('{_id:{$irwinParam:"owner"}}');
  await saved
    .getByRole("button", { name: "Add parameter", exact: true })
    .click();
  await saved.getByLabel("Parameter name 1", { exact: true }).fill("owner");
  await saved
    .getByLabel("Parameter type 1", { exact: true })
    .selectOption("objectId");
  await saved.getByRole("button", { name: "Save query", exact: true }).click();
  await expect(saved).toHaveCount(0);
  await collectionAction("Open saved queries");
  await page
    .getByRole("article", { name: "By ObjectId", exact: true })
    .getByRole("button", { name: "Apply to current tab", exact: true })
    .click();
  await modal("Fill query parameters")
    .getByLabel("Parameter owner", { exact: true })
    .fill(String(firstId));
  await modal("Fill query parameters")
    .getByRole("button", { name: "Apply inputs", exact: true })
    .click();
  await expect(active().getByLabel("FILTER", { exact: true })).toContainText(
    '"$oid"',
  );
  await expect(active().locator(".result-toolbar")).toContainText("100 loaded");
  await active().getByRole("button", { name: "Run", exact: true }).click();
  await expect(active().locator(".result-toolbar")).toContainText("1 loaded");
  checks.push(
    "typed query parameter applies on the active namespace without automatic execution",
  );
  await page
    .locator(".collection-row")
    .filter({ hasText: "orders" })
    .getByRole("button", { name: "Collection menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Aggregation", exact: true })
    .click();
  const aggregation = page.locator(".aggregation-workspace");
  await aggregation
    .getByRole("button", { name: "Paste whole pipeline", exact: true })
    .click();
  await modal("Paste whole pipeline")
    .getByLabel("Whole pipeline", { exact: true })
    .fill("[{$match:{n:{$gte:200}}},{$group:{_id:null,count:{$sum:1}}}]");
  await modal("Paste whole pipeline")
    .getByRole("button", { name: "Validate and replace stages", exact: true })
    .click();
  await expect(aggregation.locator(".aggregation-stage")).toHaveCount(2);
  await aggregation
    .locator(".aggregation-stage")
    .nth(1)
    .getByRole("button", { name: "Compare input / output", exact: true })
    .click();
  const debug = modal("Stage input / output · 2");
  await expect(debug).toContainText("Input sample · 5");
  await expect(debug).toContainText("Output sample · 1");
  await close(debug);
  await aggregation
    .getByRole("button", { name: "Run pipeline", exact: true })
    .click();
  await expect(aggregation.locator(".aggregation-result-count")).toContainText(
    "Loaded 1 rows",
  );
  checks.push(
    "whole pipeline import and stage debugging use actual five-input / one-output samples",
  );
  await aggregation
    .getByRole("button", { name: "Save pipeline", exact: true })
    .click();
  await page.locator('[name="saved-pipeline-name"]').fill("Final count");
  await modal("Save pipeline")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await aggregation
    .getByRole("button", { name: "Explain pipeline", exact: true })
    .click();
  await explain
    .getByRole("button", { name: "Run / compare again", exact: true })
    .click();
  await expect(explain.locator(".explain-runs > section")).toHaveCount(1);
  assert.equal(
    (
      await page.evaluate(() =>
        window.workbench.request("diagnostics.list", {}),
      )
    )[0].input.kind,
    "aggregation",
  );
  await close(explain);
  checks.push(
    "Aggregation captures reproducible diagnostics through the same workflow",
  );
  const bundlePath = resolve(directory, "team.irwin-queries.json");
  await savePath(bundlePath);
  await aggregation
    .getByRole("button", { name: "Team query bundle", exact: true })
    .click();
  const bundle = modal("Team query bundle");
  await bundle
    .getByRole("button", { name: "Export selected", exact: true })
    .click();
  const exported = JSON.parse(await readFile(bundlePath, "utf8"));
  assert.equal(exported.queries.length, 1);
  assert.equal(exported.pipelines.length, 1);
  assert.equal(exported.queries[0].parameters[0].type, "objectId");
  assert.equal(exported.queries[0].source, undefined);
  await openPath(bundlePath);
  await bundle
    .getByRole("button", { name: "Choose import file", exact: true })
    .click();
  await expect(bundle).toContainText("Import preview");
  assert.equal(
    (
      await page.evaluate(() =>
        window.workbench.request("savedQueries.list", {}),
      )
    ).length,
    1,
  );
  await bundle
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    bundle.getByText("Import preview", { exact: false }),
  ).toHaveCount(0);
  assert.equal(
    (
      await page.evaluate(() =>
        window.workbench.request("savedQueries.list", {}),
      )
    ).length,
    2,
  );
  assert.equal(
    (
      await page.evaluate(() =>
        window.workbench.request("savedPipelines.list", {}),
      )
    ).length,
    2,
  );
  await close(bundle);
  checks.push(
    "team bundle includes Find parameters and pipelines; preview precedes atomic fresh-ID import",
  );
  await page.screenshot({ path: resolve(directory, "aggregation.png") });
  await app.close();
  await launch();
  assert.equal(
    (
      await page.evaluate(() =>
        window.workbench.request("diagnostics.list", {}),
      )
    ).length,
    4,
  );
  assert.equal(
    (
      await page.evaluate(() =>
        window.workbench.request("savedQueries.list", {}),
      )
    ).length,
    2,
  );
  checks.push(
    "diagnostics and imported query libraries survive a real Electron restart",
  );
  const longCollection = `orders_${"x".repeat(150)}`;
  await client.db("workflow_qa").collection(longCollection).insertOne({ n: 1 });
  const longDiagnostic = await page.evaluate(
    (collection) =>
      window.workbench.request("diagnostics.capture", {
        kind: "find",
        input: {
          connectionId: "workflow-qa",
          database: "workflow_qa",
          collection,
          filter: "{}",
          sort: "{}",
          projection: "{}",
          skip: 0,
          batchSize: 100,
          maxTimeMS: 10000,
        },
      }),
    longCollection,
  );
  assert.equal(longDiagnostic.source.collection, longCollection);
  assert.ok(longDiagnostic.name.length <= 160);
  assert.ok(longDiagnostic.name.endsWith(longDiagnostic.capturedAt));
  const storedDiagnostics = await page.evaluate(() =>
    window.workbench.request("diagnostics.list", {}),
  );
  assert.ok(
    storedDiagnostics.some((record) => record.id === longDiagnostic.id),
  );
  checks.push(
    "diagnostics for long collection names save without truncating the namespace",
  );
  assert.deepEqual(
    errors.filter(
      (error) =>
        !error.includes("ICodeLensCache") &&
        !error.includes("treeViewsDndService"),
    ),
    [],
  );
  console.log(`PASS ${checks.length} developer workflow checks`);
} catch (error) {
  process.exitCode = 1;
  errors.push(String(error));
  console.error(error);
  if (page)
    await page
      .screenshot({ path: resolve(directory, "failure.png") })
      .catch(() => {});
} finally {
  await writeFile(
    resolve(".runtime/developer-workflows.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        executable: process.env.WORKBENCH_EXECUTABLE || "development",
        checks,
        errors,
        directory,
      },
      null,
      2,
    ),
  );
  await app?.close();
  await client.close();
  await server.stop();
}
