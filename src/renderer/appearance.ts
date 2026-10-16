import type { Settings } from "../shared/contracts";
import { paletteFields, type PaletteKey } from "../shared/appearance";
import type { ResolvedTheme } from "./preferences";
import { isDarkTheme } from "../shared/themes";

export function normalizeColor(value: string | undefined): string | undefined {
  if (!value || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value))
    return undefined;
  return (
    value.length === 4
      ? "#" + [...value.slice(1)].map((c) => c + c).join("")
      : value
  ).toLowerCase();
}
const legacyDefaults = {
  string: "#c7d6e0",
  number: "#e6bd89",
  objectId: "#8bbba9",
  boolean: "#bd9ddb",
  null: "#5c6974",
};
const semanticVariables = {
  string: "--theme-string",
  number: "--theme-number",
  objectId: "--theme-oid",
  boolean: "--theme-boolean",
  null: "--theme-null",
};
export const appearanceVariableNames = [
  ...new Set([
    ...paletteFields.map(([, variable]) => variable),
    ...Object.values(semanticVariables),
    "--custom-null",
    "--on-accent",
    "--custom-success",
    "--custom-error",
  ]),
];

export function appearanceVariables(
  settings: Settings,
  theme: ResolvedTheme,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings.colors)) {
    const variable = paletteFields.find(([name]) => name === key)![1];
    const color = normalizeColor(value);
    if (color) result[variable] = color;
    if (color && color !== legacyDefaults[key as keyof typeof legacyDefaults])
      result[semanticVariables[key as keyof typeof semanticVariables]] = color;
    if (key === "null" && color && color !== legacyDefaults.null)
      result["--custom-null"] = color;
  }
  for (const [key, variable] of paletteFields) {
    const color = normalizeColor(settings.themeOverrides?.[theme]?.[key]);
    if (!color) continue;
    result[variable] = color;
    if (key in semanticVariables)
      result[semanticVariables[key as keyof typeof semanticVariables]] = color;
    if (key === "null") result["--custom-null"] = color;
    if (key === "positive") result["--custom-success"] = color;
    if (key === "danger") result["--custom-error"] = color;
    if (key === "accent") {
      const luminance = (hex: string) =>
        hex
          .slice(1)
          .match(/../g)!
          .map((v) => parseInt(v, 16) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const light = 1.05 / (luminance(color) + 0.05);
      const dark = (luminance(color) + 0.05) / (luminance("#122d4c") + 0.05);
      result["--on-accent"] = light > dark ? "#ffffff" : "#122d4c";
    }
  }
  return result;
}

/** Read inherited colors without picking up another theme's overrides. */
export function readThemePalette(
  theme: ResolvedTheme,
  inheritedColors: Settings["colors"],
): Record<PaletteKey, string> {
  const probe = document.createElement("div");
  probe.dataset.theme = theme;
  probe.hidden = true;
  for (const [key, value] of Object.entries(legacyDefaults))
    probe.style.setProperty(
      paletteFields.find(([name]) => name === key)![1],
      value,
    );
  document.body.append(probe);
  try {
    const style = getComputedStyle(probe);
    const read = (variable: string) =>
      normalizeColor(style.getPropertyValue(variable).trim()) || "#000000";
    const fallback = {
      sidebar: "--panel",
      header: "--bg",
      tableBackground: "--bg",
      tableHeader: "--raised",
      tableText: "--text",
      tableHeaderText: "--muted",
    };
    const result = Object.fromEntries(
      paletteFields.map(([key, variable]) => [
        key,
        read(fallback[key as keyof typeof fallback] || variable),
      ]),
    ) as Record<PaletteKey, string>;
    // Read the probe's own variables. Descendant selectors can still match the
    // previous theme on <html> while React's root-theme effect is committing.
    for (const key of Object.keys(
      semanticVariables,
    ) as (keyof typeof semanticVariables)[]) {
      const legacyColor = normalizeColor(inheritedColors[key]);
      result[key] =
        legacyColor && legacyColor !== legacyDefaults[key]
          ? legacyColor
          : isDarkTheme(theme)
            ? key === "null" && theme !== "dark"
              ? read("--muted")
              : legacyDefaults[key]
            : read(semanticVariables[key]);
    }
    result.tableHeaderText = isDarkTheme(theme)
      ? "#bac7d0"
      : read("--theme-label");
    return result;
  } finally {
    probe.remove();
  }
}

function number(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return value !== undefined &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}
function family(value: string | undefined, fallback: string) {
  return value?.trim() && value.length <= 160 ? value.trim() : fallback;
}
export function resolveViewStyles(settings: Settings) {
  const table = settings.viewSettings?.table || {};
  const tree = settings.viewSettings?.tree || {};
  const json = settings.viewSettings?.json || {};
  const fontSize = number(table.fontSize, 12, 10, 24);
  const lineHeight = Math.max(
    fontSize + 2,
    number(table.lineHeight, Math.round(fontSize * 1.5), 14, 48),
  );
  const wrap = settings.longTextDisplay === "wrap",
    compact = settings.rowDensity === "compact";
  const paddingY = number(
    table.paddingY,
    wrap ? (compact ? 3 : 6) : compact ? 5 : 9,
    0,
    16,
  );
  const treeFontSize = number(tree.fontSize, 12, 10, 24);
  const jsonFontSize = number(json.fontSize, settings.fontSize, 10, 24);
  return {
    table: {
      fontFamily: family(table.fontFamily, "Consolas, Menlo, monospace"),
      fontSize,
      lineHeight,
      paddingX: number(table.paddingX, compact ? 9 : 12, 0, 32),
      paddingY,
      rowHeight: Math.max(24, lineHeight * (wrap ? 2 : 1) + paddingY * 2),
    },
    tree: {
      fontFamily: family(tree.fontFamily, "Consolas, Menlo, monospace"),
      fontSize: treeFontSize,
      lineHeight: Math.max(
        treeFontSize + 2,
        number(tree.lineHeight, 18, 14, 48),
      ),
      paddingX: number(tree.paddingX, 10, 0, 32),
      keyPaddingX: number(tree.paddingX, 6, 0, 32),
      paddingY: number(tree.paddingY, 6, 0, 16),
      indent: number(tree.indent, 18, 8, 40),
    },
    json: {
      fontFamily: family(json.fontFamily, settings.editorFontFamily),
      fontSize: jsonFontSize,
      lineHeight: Math.max(
        jsonFontSize + 2,
        number(json.lineHeight, settings.editorLineHeight, 14, 48),
      ),
      padding: number(json.padding, settings.editorPadding, 0, 40),
      tabWidth:
        json.tabWidth === 2 || json.tabWidth === 4 || json.tabWidth === 8
          ? json.tabWidth
          : settings.tabWidth,
    },
  };
}
