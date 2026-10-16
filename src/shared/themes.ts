/** Keep the native window and embedded editors in the same color scheme. */
export function isDarkTheme(
  theme: string,
): theme is "dark" | "midnight" | "graphite" {
  return ["dark", "midnight", "graphite"].includes(theme);
}
