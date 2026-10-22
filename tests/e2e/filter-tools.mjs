import { _electron as electron, expect } from "@playwright/test";
import { MongoClient, ObjectId } from "mongodb";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { startTestMongo } from "./helpers/test-mongo.mjs";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";

const server = await startTestMongo();
const client = await new MongoClient(server.getUri()).connect();
const id = "507f1f77bcf86cd799439011";
const collection = client.db("filter_tools_qa").collection("documents");
const dataDir = resolve(`.runtime/filter-tools-qa-${Date.now()}`);
await mkdir(".runtime/screenshots", { recursive: true });
await collection.insertMany([
  {
    _id: new ObjectId(id),
    name: "Ada",
    code: "001",
    state: null,
    createdAt: new Date("2026-10-22T02:00:00Z"),
  },
  { name: "Grace", code: "002", createdAt: new Date("2026-10-23T02:00:00Z") },
  { name: "ADA", code: "003", state: "" },
  { name: "other", code: "004", state: [] },
  { name: "array", code: "005", state: [null, ""] },
]);
let app, page;
const checks = [],
  errors = [];
try {
  const env = { ...process.env, WORKBENCH_USER_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: process.env.WORKBENCH_EXECUTABLE,
    args: process.env.WORKBENCH_EXECUTABLE
      ? ["--disable-gpu"]
      : [".", "--disable-gpu"],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
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
    });
    await window.workbench.request("connections.save", {
      profile: {
        id: "filter-qa",
        name: "Filter QA",
        uri,
        database: "filter_tools_qa",
      },
    });
  }, server.getUri());
  await page.reload();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 960 }),
  );
  await page
    .locator(".app-header")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .getByRole("button", { name: "Filter QA" })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "filter_tools_qa", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "documents", exact: true })
    .click();
  const active = () => page.locator(".workspace-panel.visible");
  const filter = () => active().getByLabel("FILTER", { exact: true });
  const dialog = () =>
    page.getByRole("dialog", { name: "Filter assistant", exact: true });
  const query = async (value) => {
    await filter().fill(value);
    await expect(active().locator(".query-suggestions")).toHaveCount(0);
    await active().getByRole("button", { name: "Run", exact: true }).click();
    await expect(active().locator(".results-wrapper")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  };
  const openTool = async (name) => {
    await active()
      .getByRole("button", { name: "Filter assistant", exact: true })
      .click();
    await expect(dialog()).toBeVisible();
    if (name !== "Regex")
      await dialog().getByRole("button", { name, exact: true }).click();
  };
  const apply = async () => {
    await dialog()
      .getByRole("button", { name: "Apply to FILTER", exact: true })
      .click();
    await expect(dialog()).not.toBeVisible();
  };
  await expect(active().locator(".grid-row")).toHaveCount(5);
  await query("name:/^ada$/i");
  await expect(active().locator(".grid-row")).toHaveCount(2);
  checks.push("Shorthand filters run without outer braces");

  await filter().fill("{}");
  await openTool("Regex");
  await dialog().getByLabel("Field path", { exact: true }).fill("name");
  await dialog()
    .getByLabel("Pattern (without delimiters)", { exact: true })
    .fill("^grace$");
  await dialog().getByLabel("m Multiline anchors", { exact: true }).check();
  await dialog()
    .getByLabel("Test text (local only)", { exact: true })
    .fill("Grace\nGRACE\nAda");
  await expect(dialog().getByRole("status")).toContainText("2 matches");
  await expect(
    dialog().getByLabel("Regex match preview", { exact: true }).locator("mark"),
  ).toHaveText(["Grace", "GRACE"]);
  await page.screenshot({
    path: ".runtime/screenshots/filter-tools-regex-light.png",
  });
  await apply();
  await expect(active().locator(".grid-row")).toHaveCount(2);
  await query(await filter().inputValue());
  await expect(active().locator(".grid-row")).toHaveCount(1);
  checks.push(
    "Regex preview stays local, highlights matches and applies without running",
  );

  await openTool("Regex");
  await dialog()
    .getByLabel("Pattern (without delimiters)", { exact: true })
    .fill("(a+)+$");
  await dialog()
    .getByLabel("Test text (local only)", { exact: true })
    .fill("a".repeat(2000) + "!");
  await expect(dialog().getByText(/Regex preview timed out/)).toBeVisible({
    timeout: 6000,
  });
  await expect(
    dialog().getByRole("button", { name: "Apply to FILTER", exact: true }),
  ).toBeDisabled();
  await dialog()
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  checks.push(
    "Pathological regex is terminated while the desktop remains responsive",
  );

  await filter().fill("{}");
  await openTool("List to $in");
  await dialog().getByLabel("Field path", { exact: true }).fill("code");
  await dialog()
    .getByLabel("Paste a list (up to 500 values)", { exact: true })
    .fill("001\n002\n001\n\n");
  await expect(
    dialog().getByRole("status").filter({ hasText: "2 values" }),
  ).toBeVisible();
  await apply();
  expect(await filter().inputValue()).toContain('"001"');
  await query(await filter().inputValue());
  await expect(active().locator(".grid-row")).toHaveCount(2);
  checks.push("Multiline lists preserve leading zeros and remove duplicates");

  await filter().fill(`_id:"${id}"`);
  await active()
    .getByRole("button", { name: /ObjectId strings detected/ })
    .click();
  await expect(
    dialog().getByLabel("Filter preview", { exact: true }),
  ).toContainText(`ObjectId("${id}")`);
  expect(await filter().inputValue()).not.toContain("ObjectId(");
  await apply();
  await query(await filter().inputValue());
  await expect(active().locator(".grid-row")).toHaveCount(1);
  checks.push(
    "ObjectId paste suggestions convert only after explicit confirmation",
  );

  await filter().fill("{}");
  await openTool("Date range");
  await dialog().getByLabel("Field path", { exact: true }).fill("createdAt");
  await dialog().getByLabel("Timezone", { exact: true }).selectOption("+08:00");
  await dialog().getByLabel("Timezone", { exact: true }).selectOption("custom");
  await dialog()
    .getByLabel("UTC offset (e.g. +08:00)", { exact: true })
    .fill("+08:00");
  await dialog()
    .getByLabel("Start time (inclusive)", { exact: true })
    .fill("2026-10-22T08:00");
  await dialog()
    .getByLabel("End time", { exact: true })
    .fill("2026-10-23T08:00");
  await expect(
    dialog().getByLabel("Filter preview", { exact: true }),
  ).toContainText("2026-10-22T00:00:00.000Z");
  await page.screenshot({
    path: ".runtime/screenshots/filter-tools-date-light.png",
  });
  await apply();
  await query(await filter().inputValue());
  await expect(active().locator(".grid-row")).toHaveCount(1);
  checks.push("Date range controls convert a selected offset to UTC");

  for (const [kind, expected] of [
    ["null", "Ada"],
    ["missing", "Grace"],
    ["emptyString", "ADA"],
    ["emptyArray", "other"],
  ]) {
    await filter().fill("{}");
    await openTool("Empty values");
    await dialog().getByLabel("Field path", { exact: true }).fill("state");
    await dialog()
      .getByLabel("Value state", { exact: true })
      .selectOption(kind);
    await apply();
    await query(await filter().inputValue());
    await expect(active().locator(".grid-row")).toHaveCount(1);
    await expect(active().locator(".grid-row")).toContainText(expected);
  }
  checks.push("Null, missing, empty strings and empty arrays remain distinct");

  await query('name:"Ada",code:"002"');
  await active()
    .getByRole("button", { name: "Diagnose no results", exact: true })
    .click();
  await expect(dialog()).toBeVisible();
  await expect(dialog().locator(".filter-diagnosis-row")).toHaveCount(0);
  await dialog()
    .getByRole("button", { name: "Start diagnosis", exact: true })
    .click();
  await expect(dialog().getByRole("status")).toHaveText("Diagnosis completed", {
    timeout: 15000,
  });
  await expect(dialog().locator(".filter-diagnosis-row")).toHaveCount(5);
  await expect(
    dialog().getByRole("button", { name: "Apply this filter", exact: true }),
  ).toHaveCount(2);
  await page.screenshot({
    path: ".runtime/screenshots/filter-tools-diagnosis-light.png",
  });
  await dialog()
    .getByRole("button", { name: "Apply this filter", exact: true })
    .last()
    .click();
  await expect(active().locator(".grid-row")).toHaveCount(0);
  await query(await filter().inputValue());
  await expect(active().locator(".grid-row")).toHaveCount(1);
  checks.push(
    "No-result diagnosis is opt-in, checks at most bounded probes and applies without executing",
  );

  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await openTool("List to $in");
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    // Override the desktop app's production minimum only inside this QA process.
    window.setMinimumSize(640, 600);
    window.setContentSize(720, 820);
  });
  await expect
    .poll(() => page.evaluate(() => innerWidth))
    .toBeLessThanOrEqual(720);
  const box = await dialog().boundingBox();
  expect(box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(
    await dialog().evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".runtime/screenshots/filter-tools-narrow-dark.png",
  });
  await dialog()
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  checks.push(
    "Assistant fits a narrow dark desktop without horizontal overflow",
  );
  expect(errors).toEqual([]);
  expect(await collection.countDocuments()).toBe(5);
} catch (error) {
  if (page) {
    await page.screenshot({
      path: ".runtime/screenshots/filter-tools-failure.png",
    });
    console.error(await page.locator("body").innerText());
  }
  throw error;
} finally {
  if (app) await closeElectronWindowNormally(app);
  await client.close();
  await server.stop();
  await writeFile(
    ".runtime/filter-tools-results.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
}
console.log(JSON.stringify({ checks, errors }, null, 2));
