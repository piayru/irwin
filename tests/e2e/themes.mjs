// Real settings dialog, workspace and Monaco; only database/settings IPC is isolated.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { preferenceFixture } from "./helpers/preference-fixture.mjs";

function contrast(foreground, background) {
  const luminance = (color) => {
    const rgb = color.startsWith("#")
      ? color
          .slice(1)
          .match(/../g)
          .map((value) => parseInt(value, 16))
      : color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number);
    return rgb
      .map((value) => value / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      )
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  };
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const { server, browser, page, errors } = await preferenceFixture();
try {
  const dialog = page.locator("dialog.preferences-modal");
  const open = async () => {
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-preference-section="appearance"]').click();
  };
  const schemeChecks = [];
  const backgrounds = [];
  await mkdir(".runtime/themes", { recursive: true });
  for (const [theme, scheme] of [
    ["midnight", "dark"],
    ["graphite", "dark"],
    ["lavender", "light"],
    ["paper", "light"],
  ]) {
    await open();
    await expect(dialog.locator(".theme-preview")).toHaveCount(8);
    // Preview cards and the dropdown must apply the same palette.
    await dialog
      .locator(`.theme-preview-window[data-theme="${theme}"]`)
      .locator("..")
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      dialog.locator(".preferences-form-grid select").first(),
    ).toHaveValue(theme);
    await dialog
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("qa-settings")).theme,
      ),
      theme,
    );
    const colors = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        scheme: root.colorScheme,
        bg: root.getPropertyValue("--bg").trim(),
        panel: root.getPropertyValue("--panel").trim(),
        accent: root.getPropertyValue("--accent").trim(),
        muted: root.getPropertyValue("--muted").trim(),
        selected: root.getPropertyValue("--accent-soft").trim(),
        primary: getComputedStyle(document.querySelector(".run-query")).color,
        values: ["string", "numberInt", "oid", "date", "boolean", "null"].map(
          (type) => [
            type,
            getComputedStyle(document.querySelector(`.grid-cell.type-${type}`))
              .color,
          ],
        ),
      };
    });
    assert.equal(colors.scheme, scheme);
    assert.ok(
      contrast(colors.primary, colors.accent) >= 4.5,
      `${theme} primary action contrast`,
    );
    assert.ok(
      contrast(colors.muted, colors.panel) >= 4.5,
      `${theme} muted labels contrast`,
    );
    for (const [type, color] of colors.values) {
      assert.ok(
        contrast(color, colors.bg) >= 4.5,
        `${theme} ${type} value contrast`,
      );
      assert.ok(
        contrast(color, colors.selected) >= 4.5,
        `${theme} ${type} selected value contrast`,
      );
    }
    backgrounds.push(colors.bg);
    schemeChecks.push({ theme, ...colors });
    await page.mouse.move(500, 600);
    await page.screenshot({ path: `.runtime/themes/${theme}.png` });
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    await expect(page.locator(".monaco-editor")).toHaveClass(
      scheme === "dark" ? /\bvs-dark\b/ : /(?:^|\s)vs(?:\s|$)/,
      { timeout: 60000 },
    );
    await page.getByRole("button", { name: "Table", exact: true }).click();
  }
  assert.equal(
    new Set(backgrounds).size,
    4,
    "New palettes must have distinct backgrounds",
  );
  await open();
  await dialog
    .locator(".preferences-form-grid select")
    .first()
    .selectOption("midnight");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  // Follow-system supports the two additional light palettes.
  await open();
  await dialog
    .locator(".preferences-form-grid select")
    .first()
    .selectOption("system");
  await dialog
    .locator(".preferences-form-grid select")
    .nth(1)
    .selectOption("lavender");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "lavender");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 900, height: 650 });
  const save = dialog.getByRole("button", {
    name: "Save settings",
    exact: true,
  });
  await expect(save).toBeInViewport();
  await page.screenshot({ path: ".runtime/themes/preferences-narrow.png" });
  await save.click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "lavender");
  await open();
  await expect(
    dialog.locator(".preferences-form-grid select").first(),
  ).toHaveValue("system");
  await expect(
    dialog.locator(".preferences-form-grid select").nth(1),
  ).toHaveValue("lavender");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(errors, []);
  await writeFile(
    ".runtime/themes/contrast.json",
    JSON.stringify(schemeChecks, null, 2),
  );
  console.log(
    "PASS four themes: previews, save/cancel, readable values and selection, editor schemes, system mode, narrow dialog",
  );
} finally {
  await browser.close();
  server.httpServer?.closeAllConnections();
  await server.close();
}
