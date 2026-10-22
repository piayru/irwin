// User expressions execute only in this disposable worker, never on the UI thread.
self.onmessage = (
  event: MessageEvent<{ pattern: string; flags: string; sample: string }>,
) => {
  const { pattern, flags, sample } = event.data;
  try {
    if (pattern.length > 1000 || sample.length > 4000 || /[^imsu]/.test(flags))
      throw new Error(
        "Pattern, flags or sample exceeds preview limits / 規則、旗標或範例超出預覽限制",
      );
    const regex = new RegExp(pattern, flags + "g");
    const matches: { start: number; end: number }[] = [];
    let match: RegExpExecArray | null;
    while (matches.length < 100 && (match = regex.exec(sample))) {
      matches.push({ start: match.index, end: match.index + match[0].length });
      if (!match[0].length)
        regex.lastIndex +=
          flags.includes("u") &&
          (sample.codePointAt(regex.lastIndex) ?? 0) > 0xffff
            ? 2
            : 1;
    }
    self.postMessage({ matches, truncated: matches.length === 100 });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
self.postMessage({ ready: true });
