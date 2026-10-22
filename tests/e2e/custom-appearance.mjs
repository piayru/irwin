import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "@playwright/test";
import { preferenceFixture } from "./helpers/preference-fixture.mjs";

const { server, browser, page, errors } = await preferenceFixture({
  settingsWriteDelayMS: 250,
});
try {
  const dialog = page.locator("dialog.preferences-modal");
  const open = async (section = "appearance") => {
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await dialog.locator(`[data-preference-section="${section}"]`).click();
  };
  const colors = async () =>
    dialog.getByRole("tab", { name: "Custom colors", exact: true }).click();
  const save = () =>
    dialog.getByRole("button", { name: "Save settings", exact: true });
  const saveAndWait = async () => {
    await save().click();
    // Clicking starts async IPC; wait for acknowledgement before reloading or
    // inspecting storage. Live preview alone does not prove persistence.
    await expect(dialog).not.toBeVisible();
  };
  const cancel = () =>
    dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const css = (key) =>
    page
      .locator("html")
      .evaluate(
        (el, key) => getComputedStyle(el).getPropertyValue(key).trim(),
        key,
      );
  const snapshot = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("qa-settings")));
  const themeSelect = () =>
    dialog.locator(".preferences-form-grid select").first();
  await mkdir(".runtime/custom-appearance", { recursive: true });
  const original = await css("--bg");
  await open();
  await colors();
  await dialog
    .getByLabel("Workspace background HEX", { exact: true })
    .fill("#112233");
  await expect.poll(() => css("--bg")).toBe("#112233");
  await dialog.getByLabel("Sidebar HEX", { exact: true }).fill("#203040");
  await expect(page.locator(".sidebar")).toHaveCSS(
    "background-color",
    "rgb(32, 48, 64)",
  );
  await cancel();
  await expect.poll(() => css("--bg")).toBe(original);
  assert.equal(await page.evaluate(() => window.settingsWrites.length), 0);

  await open();
  await colors();
  const accent = dialog.getByLabel("Accent HEX", { exact: true });
  await accent.fill("#12");
  await expect(accent).toHaveAttribute("aria-invalid", "true");
  await expect(save()).toBeDisabled();
  assert.notEqual(await css("--accent"), "#12");
  await accent.fill("#abc");
  await accent.blur();
  await expect(accent).toHaveValue("#aabbcc");
  await expect(save()).toBeEnabled();
  await dialog
    .getByLabel("Sidebar color picker", { exact: true })
    .evaluate((el) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(el, "#203040");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await expect.poll(() => css("--sidebar-background")).toBe("#203040");
  await dialog
    .getByLabel("Workspace background HEX", { exact: true })
    .fill("#112233");
  await dialog
    .getByLabel("Column header background HEX", { exact: true })
    .fill("#334455");
  await dialog
    .getByLabel("Column header text HEX", { exact: true })
    .fill("#ffffff");
  await dialog.getByLabel("String HEX", { exact: true }).fill("#fa8072");
  await expect(page.locator(".grid-heading").first()).toHaveCSS(
    "background-color",
    "rgb(51, 68, 85)",
  );
  await expect(page.locator(".grid-heading").first()).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator(".grid-cell.type-string").first()).toHaveCSS(
    "color",
    "rgb(250, 128, 114)",
  );
  await themeSelect().selectOption("paper");
  await expect.poll(() => css("--bg")).toBe("#f5f6f5");
  await dialog
    .getByLabel("Workspace background HEX", { exact: true })
    .fill("#fafafa");
  await dialog
    .getByLabel("Column header text HEX", { exact: true })
    .fill("#123456");
  await expect(page.locator(".grid-heading").first()).toHaveCSS(
    "color",
    "rgb(18, 52, 86)",
  );
  await themeSelect().selectOption("dark");
  await expect.poll(() => css("--bg")).toBe("#112233");
  await expect(dialog.getByLabel("Number HEX", { exact: true })).toHaveValue(
    "#e6bd89",
  );
  await expect(dialog.getByLabel("ObjectId HEX", { exact: true })).toHaveValue(
    "#8bbba9",
  );
  await page.screenshot({ path: ".runtime/custom-appearance/colors.png" });
  await saveAndWait();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => css("--bg")).toBe("#112233");
  assert.equal((await snapshot()).themeOverrides.paper.background, "#fafafa");
  // Restore only this theme; another theme's customization is retained.
  await open();
  await colors();
  await dialog
    .getByRole("button", { name: "Restore this theme's colors", exact: true })
    .click();
  await expect.poll(() => css("--bg")).toBe(original);
  await cancel();
  await expect.poll(() => css("--bg")).toBe("#112233");
  await open();
  await colors();
  await dialog
    .getByRole("button", { name: "Restore this theme's colors", exact: true })
    .click();
  await saveAndWait();
  assert.equal((await snapshot()).themeOverrides.dark, undefined);
  assert.equal((await snapshot()).themeOverrides.paper.background, "#fafafa");
  // Re-open a result tab after reload. All changes below are presentation only.
  await page
    .locator(".connection-row")
    .filter({ hasText: "Theme QA" })
    .locator(".tree-main")
    .click();
  await page.getByText("theme_qa", { exact: true }).first().click();
  await page.getByText("documents", { exact: true }).first().click();
  await expect(page.locator(".grid-row").first()).toBeVisible();
  await open("editor");
  const viewTabs = dialog.getByRole("tablist", { name: "View typography" });
  const fill = async (view, label, value) =>
    dialog.getByLabel(`${view} ${label}`, { exact: true }).fill(value);
  await fill("table", "Font family", "Arial, sans-serif");
  await fill("table", "Font size", "99");
  await expect(save()).toBeDisabled();
  await fill("table", "Font size", "20");
  await fill("table", "Line height", "30");
  await fill("table", "Horizontal padding", "16");
  await fill("table", "Vertical padding", "6");
  await expect(page.locator(".grid-row").first()).toHaveCSS("height", "42px");
  await expect(page.locator(".grid-cell.type-string").first()).toHaveCSS(
    "font-size",
    "20px",
  );
  await viewTabs.getByRole("tab", { name: "Tree", exact: true }).click();
  await fill("tree", "Font size", "16");
  await fill("tree", "Line height", "24");
  await fill("tree", "Vertical padding", "4");
  await fill("tree", "Horizontal padding", "12");
  await fill("tree", "Node indentation", "28");
  await viewTabs.getByRole("tab", { name: "JSON", exact: true }).click();
  await fill("json", "Font family", "Courier New, monospace");
  await fill("json", "Font size", "17");
  await fill("json", "Line height", "28");
  await fill("json", "Vertical padding", "6");
  await dialog
    .getByLabel("json Indent spaces", { exact: true })
    .selectOption("8");
  await page.screenshot({ path: ".runtime/custom-appearance/views.png" });
  await saveAndWait();
  const first = page.locator(".grid-cell.type-string").first();
  await expect(first).toHaveCSS("font-family", "Arial, sans-serif");
  await expect(first).toHaveCSS("line-height", "30px");
  await expect(first).toHaveCSS("padding", "6px 16px");
  await first.click();
  for (let i = 0; i < 30; i++) await page.getByRole("grid").press("ArrowDown");
  await expect(page.locator(".selected-cell .cell-preview")).toHaveText(
    "Document 31",
  );
  const alignment = await page.locator(".selected-cell").evaluate((el) => ({
    height: el.parentElement.getBoundingClientRect().height,
    bottom: el.parentElement.getBoundingClientRect().bottom,
    viewport: el.closest(".table-scroll").getBoundingClientRect().bottom,
  }));
  assert.equal(alignment.height, 42);
  assert.ok(alignment.bottom <= alignment.viewport);
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await expect(page.locator(".tree-row").first()).toHaveCSS(
    "font-size",
    "16px",
  );
  await expect(page.locator(".tree-row").first()).toHaveCSS(
    "line-height",
    "24px",
  );
  await expect(page.locator(".tree-value").first()).toHaveCSS(
    "padding-top",
    "4px",
  );
  await expect(
    page
      .locator(".tree-name")
      .filter({ hasText: /^name$/ })
      .first()
      .locator(".."),
  ).toHaveCSS("padding-left", "40px");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const editor = page.locator(".json-editor-surface .monaco-editor");
  await expect(editor.locator(".view-line").first()).toHaveCSS(
    "font-size",
    "17px",
    { timeout: 60000 },
  );
  await expect(editor.locator(".view-line").first()).toHaveCSS(
    "line-height",
    "28px",
  );
  await expect
    .poll(async () => {
      const a = await editor.locator(".view-line").first().boundingBox(),
        b = await editor.boundingBox();
      return a && b ? Math.round(a.y - b.y) : null;
    })
    .toBe(6);
  await expect
    .poll(() =>
      editor
        .locator(".view-lines")
        .evaluate((el) => el.textContent.replaceAll("\u00a0", " ")),
    )
    .toContain("        _id:");
  const editorText = await editor.locator(".view-lines").innerText();
  await page.screenshot({ path: ".runtime/custom-appearance/json.png" });
  await open("editor");
  await dialog
    .getByRole("tablist", { name: "View typography" })
    .getByRole("tab", { name: "JSON", exact: true })
    .click();
  await fill("json", "Font size", "22");
  await cancel();
  await expect(editor.locator(".view-line").first()).toHaveCSS(
    "font-size",
    "17px",
  );
  assert.equal(await editor.locator(".view-lines").innerText(), editorText);
  const saved = await snapshot();
  assert.equal(saved.viewSettings.table.fontSize, 20);
  assert.equal(saved.viewSettings.tree.indent, 28);
  assert.equal(saved.viewSettings.json.tabWidth, 8);
  await open("editor");
  await dialog
    .getByRole("tablist", { name: "View typography" })
    .getByRole("tab", { name: "JSON", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Reset this view", exact: true })
    .click();
  await expect(editor.locator(".view-line").first()).toHaveCSS(
    "font-size",
    "13px",
  );
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(save()).toBeInViewport();
  await page.screenshot({ path: ".runtime/custom-appearance/narrow.png" });
  await cancel();
  assert.deepEqual(await page.evaluate(() => window.documentWrites), []);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal((await snapshot()).viewSettings.json.tabWidth, 8);
  // Existing global BSON colors remain the inherited value until overridden here.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("qa-settings"));
    saved.colors.number = "#fedcba";
    localStorage.setItem("qa-settings", JSON.stringify(saved));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await open();
  await colors();
  await expect(dialog.getByLabel("Number HEX", { exact: true })).toHaveValue(
    "#fedcba",
  );
  await cancel();
  assert.deepEqual(errors, []);
  console.log(
    "PASS custom palette preview/cancel/persistence/isolation/restore, invalid input, picker/HEX, Table virtualization, Tree indentation, JSON typography and preserved content",
  );
} catch (error) {
  await page.screenshot({ path: ".runtime/custom-appearance/failure.png" });
  throw error;
} finally {
  await browser.close();
  server.httpServer?.closeAllConnections();
  await server.close();
}
