export function documentErrorLocation(
  message: string,
): { line: number; column: number } | undefined {
  const match = message.match(/\bline\s+(\d+)\s*,?\s*column\s+(\d+)/i);
  if (!match) return undefined;
  const line = Number(match[1]),
    column = Number(match[2]);
  return Number.isSafeInteger(line) &&
    line > 0 &&
    Number.isSafeInteger(column) &&
    column > 0
    ? { line, column }
    : undefined;
}
