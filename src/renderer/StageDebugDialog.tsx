import { useEffect, useState } from "react";
import type { AggregationInput, Row } from "../shared/contracts";
import { stageDebugPipelines } from "../shared/aggregation";
import { Modal, api, message, useUi } from "./ui";

export function StageDebugDialog({
  input,
  index,
  close,
  notify,
}: {
  input: AggregationInput;
  index: number;
  close(): void;
  notify(text: string, error?: boolean): void;
}) {
  const { t } = useUi();
  const [samples, setSamples] = useState<{ before: Row[]; after: Row[] }>(),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const run = async () => {
      try {
        const prefix = stageDebugPipelines(input.stages, index);
        const results = await Promise.all([
          api.request("aggregations.preview", {
            ...input,
            stages: prefix.before,
            cursorId: ids[0],
          }),
          api.request("aggregations.preview", {
            ...input,
            stages: prefix.after,
            cursorId: ids[1],
          }),
        ]);
        if (live) {
          setSamples({ before: results[0].rows, after: results[1].rows });
          notify(t("階段除錯預覽完成", "Stage debugging preview completed"));
        }
      } catch (e) {
        if (live) {
          setError(message(e));
          notify(message(e), true);
        }
      } finally {
        ids.forEach(
          (cursorId) =>
            void api.request("queries.cancel", { cursorId }).catch(() => {}),
        );
      }
    };
    void run();
    return () => {
      live = false;
      ids.forEach(
        (cursorId) =>
          void api.request("queries.cancel", { cursorId }).catch(() => {}),
      );
    };
  }, []);
  return (
    <Modal
      wide
      resizable
      title={`${t("階段輸入／輸出", "Stage input / output")} · ${index + 1}`}
      close={close}
    >
      <p className="muted">
        {t(
          "兩側分別執行階段前後的 Pipeline，各取最多 20 筆樣本、時間上限 10 秒。這是取樣筆數，不代表全部資料量；兩次讀取不是同一時間點的快照。",
          "Runs the pipeline before and after this stage, separately. Each side samples at most 20 rows within 10 seconds. Counts describe samples, not totals; reads are not a point-in-time snapshot.",
        )}
      </p>
      {!input.stages[index].enabled && (
        <p className="muted">
          {t(
            "此階段已停用，兩側執行相同的 Pipeline。",
            "This stage is disabled; both sides run the same pipeline.",
          )}
        </p>
      )}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : samples ? (
        <div className="stage-debug-samples">
          {(["before", "after"] as const).map((side) => (
            <section key={side}>
              <h3>
                {side === "before"
                  ? t("輸入樣本", "Input sample")
                  : t("輸出樣本", "Output sample")}{" "}
                · {samples[side].length}
              </h3>
              <pre>
                {JSON.stringify(
                  samples[side].map((row) => JSON.parse(row.ejson)),
                  null,
                  2,
                )}
              </pre>
            </section>
          ))}
        </div>
      ) : (
        <p role="status">{t("讀取樣本中…", "Reading samples…")}</p>
      )}
    </Modal>
  );
}
