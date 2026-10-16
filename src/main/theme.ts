import type { Settings } from "../shared/contracts";
import { isDarkTheme } from "../shared/themes";

export function nativeThemeSource(
  theme: Settings["theme"],
): "dark" | "light" | "system" {
  return theme === "system" ? "system" : isDarkTheme(theme) ? "dark" : "light";
}
