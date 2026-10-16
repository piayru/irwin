import { describe, expect, it } from "vitest";
import { settingsSchema } from "../src/shared/contracts";
import {
  appearanceVariables,
  normalizeColor,
  resolveViewStyles,
} from "../src/renderer/appearance";
import { fitInitialTableColumnWidths } from "../src/renderer/result-layout";
import { resetSettingsSection } from "../src/renderer/preferences";

describe("custom appearance settings", () => {
  it("resets appearance and editor customizations independently", () => {
    const settings = settingsSchema.parse({
      themeOverrides: { dark: { accent: "#112233" } },
      viewSettings: { table: { fontSize: 18 } },
    });
    const resetAppearance = resetSettingsSection(
      settings,
      "appearance",
      settingsSchema.parse({}),
    );
    expect(resetAppearance.themeOverrides).toEqual({});
    expect(resetAppearance.viewSettings.table.fontSize).toBe(18);
    const resetEditor = resetSettingsSection(
      settings,
      "editor",
      settingsSchema.parse({}),
    );
    expect(resetEditor.viewSettings).toEqual({ table: {}, tree: {}, json: {} });
    expect(resetEditor.themeOverrides.dark?.accent).toBe("#112233");
  });
  it("fits table columns using the chosen font size and horizontal padding", () => {
    expect(
      fitInitialTableColumnWidths(["n"], { n: ["12345678"] }, 24, 16).n,
    ).toBe(148);
  });
  it("expands shorthand RGB and ignores unfinished input during preview", () => {
    expect(normalizeColor("#aBc")).toBe("#aabbcc");
    expect(normalizeColor("#12")).toBeUndefined();
    const settings = settingsSchema.parse({
      themeOverrides: {
        dark: { accent: "#abc" },
        paper: { accent: "#123456" },
      },
    });
    expect(appearanceVariables(settings, "dark")["--accent"]).toBe("#aabbcc");
    expect(appearanceVariables(settings, "dark")["--on-accent"]).toBe(
      "#122d4c",
    );
    expect(appearanceVariables(settings, "paper")["--accent"]).toBe("#123456");
    expect(appearanceVariables(settings, "paper")["--on-accent"]).toBe(
      "#ffffff",
    );
    expect(
      appearanceVariables(
        { ...settings, themeOverrides: { dark: { accent: "#12" } } },
        "dark",
      ),
    ).not.toHaveProperty("--accent");
  });
  it("preserves legacy densities and JSON preferences until a view is customized", () => {
    const settings = settingsSchema.parse({
      fontSize: 14,
      editorLineHeight: 26,
      editorPadding: 18,
      tabWidth: 4,
    });
    expect(resolveViewStyles(settings).table.rowHeight).toBe(36);
    expect(
      resolveViewStyles({ ...settings, rowDensity: "compact" }).table.rowHeight,
    ).toBe(28);
    expect(
      resolveViewStyles({ ...settings, longTextDisplay: "wrap" }).table
        .rowHeight,
    ).toBe(48);
    expect(
      resolveViewStyles({
        ...settings,
        rowDensity: "compact",
        longTextDisplay: "wrap",
      }).table.rowHeight,
    ).toBe(42);
    expect(resolveViewStyles(settings).json).toMatchObject({
      fontSize: 14,
      lineHeight: 26,
      padding: 18,
      tabWidth: 4,
    });
  });
  it("sizes virtual rows from real typography and keeps views independent", () => {
    const settings = settingsSchema.parse({
      viewSettings: {
        table: { fontSize: 18, lineHeight: 28, paddingY: 4 },
        tree: { indent: 30 },
        json: { tabWidth: 8 },
      },
    });
    const styles = resolveViewStyles(settings);
    expect(styles.table.rowHeight).toBe(36);
    expect(styles.tree).toMatchObject({ fontSize: 12, indent: 30 });
    expect(styles.json).toMatchObject({ fontSize: 13, tabWidth: 8 });
    expect(
      resolveViewStyles({ ...settings, longTextDisplay: "wrap" }).table
        .rowHeight,
    ).toBe(64);
  });
  it("keeps old settings compatible without inventing custom overrides", () => {
    const settings = settingsSchema.parse({
      theme: "forest",
      fontSize: 14,
      tabWidth: 4,
    });
    expect(settings.themeOverrides).toEqual({});
    expect(settings.viewSettings).toEqual({ table: {}, tree: {}, json: {} });
    expect(settings.fontSize).toBe(14);
    expect(settings.tabWidth).toBe(4);
  });
  it("persists independent palette and view overrides", () => {
    const raw = {
      themeOverrides: {
        dark: { background: "#123456", accent: "#abc" },
        paper: { sidebar: "#ffffff" },
      },
      viewSettings: {
        table: { fontSize: 16, paddingY: 3 },
        tree: { indent: 24 },
        json: { tabWidth: 8 },
      },
    };
    const settings = settingsSchema.parse(JSON.parse(JSON.stringify(raw)));
    expect(settings.themeOverrides).toEqual(raw.themeOverrides);
    expect(settings.viewSettings).toEqual(raw.viewSettings);
  });
  it.each([
    {
      themeOverrides: { dark: { background: "url(https://example.invalid)" } },
    },
    { themeOverrides: { dark: { accent: "#12" } } },
    { themeOverrides: { system: { accent: "#abcdef" } } },
    { themeOverrides: { dark: { unknown: "#abcdef" } } },
    { viewSettings: { table: { fontSize: 500 } } },
    { viewSettings: { table: { paddingY: -1 } } },
    { viewSettings: { tree: { indent: 1000 } } },
    { viewSettings: { json: { tabWidth: 3 } } },
    { viewSettings: { json: { fontFamily: "   " } } },
    { viewSettings: { table: { fontSize: 20, lineHeight: 14 } } },
  ])("rejects unsafe or unusable overrides: %j", (raw) => {
    expect(settingsSchema.safeParse(raw).success).toBe(false);
  });
});
