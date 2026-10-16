import { describe, expect, it } from "vitest";
import { settingsSchema } from "../src/shared/contracts";
import { nativeThemeSource } from "../src/main/theme";
import { resolveTheme } from "../src/renderer/preferences";

describe("theme settings", () => {
  it.each([
    ["midnight", "dark"],
    ["graphite", "dark"],
    ["lavender", "light"],
    ["paper", "light"],
  ])(
    "retains the %s palette and uses the matching native frame",
    (theme, frame) => {
      const saved = settingsSchema.parse({ theme });
      expect(
        settingsSchema.parse(JSON.parse(JSON.stringify(saved))).theme,
      ).toBe(theme);
      expect(nativeThemeSource(saved.theme)).toBe(frame);
      expect(resolveTheme(saved.theme, "dark", saved.systemLightTheme)).toBe(
        theme,
      );
    },
  );

  it.each(["lavender", "paper"])(
    "uses %s as the light palette in System mode",
    (theme) => {
      const settings = settingsSchema.parse({
        theme: "system",
        systemLightTheme: theme,
      });
      expect(
        resolveTheme(settings.theme, "light", settings.systemLightTheme),
      ).toBe(theme);
      expect(
        resolveTheme(settings.theme, "dark", settings.systemLightTheme),
      ).toBe("dark");
    },
  );
  it("accepts the selectable Mango, Azure, Forest, and Dark themes", () => {
    for (const theme of ["light", "azure", "forest", "dark"] as const) {
      expect(settingsSchema.parse({ theme }).theme).toBe(theme);
    }
  });

  it("uses a native light window frame for every custom light theme", () => {
    expect(nativeThemeSource("light")).toBe("light");
    expect(nativeThemeSource("azure")).toBe("light");
    expect(nativeThemeSource("forest")).toBe("light");
    expect(nativeThemeSource("dark")).toBe("dark");
  });

  it("does not retain the removed startup workspace preference", () => {
    expect(settingsSchema.parse({ restoreWorkspace: true })).not.toHaveProperty(
      "restoreWorkspace",
    );
  });
});
