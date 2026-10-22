export type RegexPreview = {
  matches?: { start: number; end: number }[];
  truncated?: boolean;
  error?: string;
  cancelled?: boolean;
};
type PreviewWorker = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror"
>;
export function previewRegex(
  pattern: string,
  flags: string,
  sample: string,
  signal: AbortSignal,
  create: () => PreviewWorker = () =>
    new Worker(new URL("./filter-regex.worker.ts", import.meta.url), {
      type: "module",
    }),
): Promise<RegexPreview> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ cancelled: true });
      return;
    }
    let worker: PreviewWorker;
    try {
      worker = create();
    } catch {
      resolve({ error: "Regex preview could not start / 無法啟動 Regex 預覽" });
      return;
    }
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: RegexPreview) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(result);
    };
    const cancel = () => finish({ cancelled: true });
    timer = setTimeout(
      () => finish({ error: "Regex preview timed out / Regex 預覽逾時" }),
      3000,
    );
    worker.onmessage = (event) => {
      if (done) return;
      if (event.data.ready) {
        clearTimeout(timer);
        timer = setTimeout(
          () => finish({ error: "Regex preview timed out / Regex 預覽逾時" }),
          200,
        );
        worker.postMessage({ pattern, flags, sample });
      } else finish(event.data);
    };
    worker.onerror = () =>
      finish({ error: "Regex preview failed / Regex 預覽失敗" });
    signal.addEventListener("abort", cancel, { once: true });
  });
}
