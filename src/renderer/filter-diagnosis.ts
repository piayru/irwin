import type { Page, QueryInput } from "../shared/contracts";
import { diagnosticProbes, type DiagnosticProbe } from "../shared/filter-tools";

export type ProbeResult = DiagnosticProbe & {
  matches: boolean;
  error?: string;
};
export type DiagnosisResult = {
  results: ProbeResult[];
  truncated: boolean;
  completion: "complete" | "cancelled" | "timedOut" | "error";
};
type Transport = {
  read(query: QueryInput): Promise<Page>;
  cancel(cursorId: string): Promise<unknown>;
};
export async function runFilterDiagnosis(
  query: QueryInput,
  transport: Transport,
  signal: AbortSignal,
  progress?: (results: ProbeResult[]) => void,
): Promise<DiagnosisResult> {
  const plan = diagnosticProbes(query.filter);
  const results: ProbeResult[] = [];
  const controller = new AbortController();
  const abort = () => controller.abort("cancelled");
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const total = setTimeout(() => controller.abort("timedOut"), 12000);
  let completion: DiagnosisResult["completion"] = "complete";
  try {
    for (const probe of plan.probes) {
      if (controller.signal.aborted) {
        completion = controller.signal.reason;
        break;
      }
      const cursorId = crypto.randomUUID();
      const cancel = () => {
        void transport.cancel(cursorId).catch(() => {});
      };
      try {
        const page = await new Promise<Page>((resolve, reject) => {
          let settled = false;
          const finish = (operation: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", aborted);
            operation();
          };
          const aborted = () => {
            cancel();
            finish(() => reject(new Error(controller.signal.reason)));
          };
          const timeout = setTimeout(() => {
            cancel();
            finish(() => reject(new Error("timedOut")));
          }, 2200);
          controller.signal.addEventListener("abort", aborted, { once: true });
          transport
            .read({
              ...query,
              filter: probe.filter,
              sort: "{}",
              projection: '{"_id":1}',
              skip: 0,
              batchSize: 1,
              maxTimeMS: Math.min(query.maxTimeMS, 2000),
              cursorId,
              hint: undefined,
              collation: query.collation,
            })
            .then(
              (page) => {
                if (settled) {
                  cancel();
                  return;
                }
                finish(() => resolve(page));
              },
              (error) => finish(() => reject(error)),
            );
        });
        if (controller.signal.aborted) {
          completion = controller.signal.reason;
          break;
        }
        results.push({ ...probe, matches: page.rows.length > 0 });
        progress?.([...results]);
        if (probe.kind === "collection" && !page.rows.length) break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (controller.signal.aborted) completion = controller.signal.reason;
        else if (
          message === "timedOut" ||
          /time.*limit|timed out|MaxTimeMS/i.test(message)
        )
          completion = "timedOut";
        else {
          completion = "error";
          results.push({ ...probe, matches: false, error: message });
          progress?.([...results]);
        }
        break;
      } finally {
        cancel();
      }
    }
  } finally {
    clearTimeout(total);
    signal.removeEventListener("abort", abort);
  }
  return { results, truncated: plan.truncated, completion };
}
