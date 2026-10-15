import { useEffect, useState } from "react";
import { encode } from "../shared/bson";
import { compileReadOnlyPipeline, importPipeline } from "../shared/aggregation";
import {
  explainComparisonWarnings,
  type ExplainRecord,
} from "../shared/explain-record";
import { summarizeExplain } from "../shared/exploration";
import type { AggregationInput, QueryInput } from "../shared/contracts";
import { CodeEditor } from "./Editor";
import { PlanTree } from "./AnalysisDialog";
import { AIAssistantPanel } from "./AIAssistantPanel";
import type { PreferenceSection } from "./preferences";
import { Field, Modal, api, message, useUi } from "./ui";

export function ExplainDialog({
  query,
  aggregation,
  close,
  profileProvider = "mongodb",
  notify = () => {},
  onOpenPreferences,
}: {
  query: QueryInput;
  aggregation?: AggregationInput;
  close(): void;
  profileProvider?: "mongodb" | "cosmos";
  notify?(text: string, error?: boolean): void;
  onOpenPreferences?(section?: PreferenceSection): void;
}) {
  const { t, theme, language } = useUi();
  const [inputs, setInputs] = useState({
    ...query,
    hint: query.hint || "",
    collation: query.collation || "",
  });
  const [pipelineText, setPipelineText] = useState(() =>
    aggregation ? encode(compileReadOnlyPipeline(aggregation.stages)) : "[]",
  );
  const [records, setRecords] = useState<ExplainRecord[]>([]),
    [latest, setLatest] = useState<ExplainRecord>(),
    [baselineId, setBaselineId] = useState("");
  const [recordName, setRecordName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [raw, setRaw] = useState(false),
    [showAiAssistant, setShowAiAssistant] = useState(false);
  const baseline = records.find((r) => r.id === baselineId);
  const refresh = async () =>
    setRecords(await api.request("diagnostics.list", {}));
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, []);
  const failed = (e: unknown) => {
    setError(message(e));
    notify(message(e), true);
  };
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const record: ExplainRecord = await api.request(
        "diagnostics.capture",
        aggregation
          ? {
              kind: "aggregation",
              input: {
                ...aggregation,
                stages: importPipeline(pipelineText),
                maxTimeMS: inputs.maxTimeMS,
                hint: inputs.hint,
                collation: inputs.collation,
              },
            }
          : { kind: "find", input: inputs },
      );
      setLatest(record);
      setRecordName(record.name);
      await refresh();
      notify(t("效能診斷紀錄已儲存", "Performance diagnostic saved"));
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  const exportRecord = async (record: ExplainRecord) => {
    try {
      const path = await api.request("files.choose", {
        kind: "save",
        title: t("匯出效能診斷紀錄", "Export performance diagnostic"),
        defaultPath: `${record.source.collection.replace(/[\\/<>:"|?*]/g, "_")}-explain-${record.capturedAt.replace(/[:.]/g, "-")}.json`,
      });
      if (!path) return;
      await api.request("reports.export", {
        path,
        content: JSON.stringify(record, null, 2),
      });
      notify(t("診斷紀錄已匯出", "Diagnostic exported"));
    } catch (e) {
      failed(e);
    }
  };
  const importRecord = async () => {
    setBusy(true);
    try {
      const path = await api.request("files.choose", {
        kind: "open",
        title: t("匯入效能診斷紀錄", "Import performance diagnostic"),
      });
      if (!path) return;
      const preview: ExplainRecord = await api.request("diagnostics.read", {
        path,
      });
      setImportPreview(preview);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  const [importPreview, setImportPreview] = useState<ExplainRecord>();
  const useInputs = (record: ExplainRecord) => {
    const value = record.input;
    if ((value.kind === "aggregation") !== !!aggregation) {
      failed(
        new Error(
          t(
            "請在相同類型的查詢分頁套用紀錄。",
            "Apply this record in the matching query tab type.",
          ),
        ),
      );
      return;
    }
    if (value.kind === "aggregation")
      setPipelineText(encode(compileReadOnlyPipeline(value.stages)));
    else
      setInputs((old) => ({
        ...old,
        filter: value.filter,
        sort: value.sort,
        projection: value.projection,
        skip: value.skip,
      }));
    setInputs((old) => ({
      ...old,
      hint: value.hint,
      collation: value.collation,
      maxTimeMS: value.maxTimeMS,
    }));
    notify(
      t(
        "條件已套用至診斷面板，尚未執行",
        "Inputs applied to diagnostics; not executed",
      ),
    );
  };
  const display = [
    ...(baseline ? [baseline] : []),
    ...(latest && latest.id !== baseline?.id ? [latest] : []),
  ];
  const warnings =
    baseline && latest ? explainComparisonWarnings(baseline, latest) : [];
  const [deleteRecord, setDeleteRecord] = useState<ExplainRecord>();
  return (
    <Modal
      wide
      resizable
      className={`explain-modal${showAiAssistant ? " has-ai-assistant" : ""}`}
      title="Explain · executionStats"
      close={() => {
        if (!busy) close();
      }}
      footer={
        <>
          <button onClick={() => setRaw(!raw)}>
            {raw ? t("圖形檢視", "Visual plan") : "JSON"}
          </button>
          <button disabled={busy} onClick={() => void importRecord()}>
            {t("匯入紀錄", "Import record")}
          </button>
          {latest && (
            <button onClick={() => void exportRecord(latest)}>
              {t("匯出本次紀錄", "Export latest record")}
            </button>
          )}
          {profileProvider === "mongodb" && latest && (
            <button onClick={() => setShowAiAssistant(!showAiAssistant)}>
              {t("AI 解讀計畫", "Explain with AI")}
            </button>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy
              ? t("執行中…", "Running…")
              : t("執行／再次比較", "Run / compare again")}
          </button>
        </>
      }
    >
      <div
        className={`explain-layout${showAiAssistant ? " with-ai-assistant" : ""}`}
      >
        <div className="explain-content">
          <p className="muted">
            {t(
              "實際執行查詢並保存完整條件、計畫、索引定義、伺服器版本及時間。最近 200 筆存於本機；時間受快取、資料變化與伺服器負載影響。索引資訊在執行後讀取。",
              "Executes and saves inputs, plan, index definitions, server version and timestamp locally (latest 200). Cache, data changes and server load affect timings. Index metadata is read after execution.",
            )}
          </p>
          <p>
            <code>
              {query.database}.{query.collection}
            </code>{" "}
            · {t("目前目標環境", "Current target environment")}
          </p>
          <fieldset disabled={busy} className="analysis-options form-grid">
            {aggregation ? (
              <Field full label="Pipeline">
                <textarea
                  name="explain-pipeline"
                  aria-label="Explain pipeline input"
                  rows={6}
                  value={pipelineText}
                  onChange={(e) => setPipelineText(e.target.value)}
                />
              </Field>
            ) : (
              (["filter", "sort", "projection"] as const).map((key) => (
                <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
                  <input
                    name={`explain-${key}`}
                    value={inputs[key]}
                    onChange={(e) =>
                      setInputs({ ...inputs, [key]: e.target.value })
                    }
                  />
                </Field>
              ))
            )}
            <Field label="Hint">
              <input
                name="explain-hint"
                placeholder='{ "field": 1 }'
                value={inputs.hint}
                onChange={(e) => setInputs({ ...inputs, hint: e.target.value })}
              />
            </Field>
            <Field label="Collation">
              <input
                name="explain-collation"
                placeholder='{ "locale": "en", "strength": 2 }'
                value={inputs.collation}
                onChange={(e) =>
                  setInputs({ ...inputs, collation: e.target.value })
                }
              />
            </Field>
            {!aggregation && (
              <Field label="Skip">
                <input
                  name="explain-skip"
                  type="number"
                  min={0}
                  value={inputs.skip}
                  onChange={(e) =>
                    setInputs({ ...inputs, skip: Number(e.target.value) })
                  }
                />
              </Field>
            )}
            <Field label="maxTimeMS">
              <input
                name="explain-time-limit"
                type="number"
                min={100}
                max={3600000}
                value={inputs.maxTimeMS}
                onChange={(e) =>
                  setInputs({ ...inputs, maxTimeMS: Number(e.target.value) })
                }
              />
            </Field>
          </fieldset>
          <div className="diagnostic-library">
            <Field label={t("比較基準", "Comparison baseline")}>
              <select
                aria-label={t("比較基準", "Comparison baseline")}
                value={baselineId}
                onChange={(e) => setBaselineId(e.target.value)}
              >
                <option value="">{t("未選擇基準", "No baseline")}</option>
                {records.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.name} · {record.source.connectionName} /{" "}
                    {record.source.database}.{record.source.collection}
                  </option>
                ))}
              </select>
            </Field>
            {baseline && (
              <div className="diagnostic-actions">
                <button disabled={busy} onClick={() => useInputs(baseline)}>
                  {t("套用基準條件", "Use baseline inputs")}
                </button>
                <button onClick={() => void exportRecord(baseline)}>
                  {t("匯出基準紀錄", "Export baseline record")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setDeleteRecord(baseline)}
                >
                  {t("刪除基準紀錄", "Delete baseline record")}
                </button>
              </div>
            )}
          </div>
          {latest && (
            <div className="diagnostic-name">
              <Field label={t("本次紀錄名稱", "Latest record name")}>
                <input
                  value={recordName}
                  maxLength={160}
                  onChange={(e) => setRecordName(e.target.value)}
                />
              </Field>
              <button
                disabled={busy || !recordName.trim()}
                onClick={async () => {
                  try {
                    const record = await api.request("diagnostics.save", {
                      ...latest,
                      name: recordName,
                    });
                    setLatest(record);
                    await refresh();
                    notify(t("紀錄名稱已儲存", "Record name saved"));
                  } catch (e) {
                    failed(e);
                  }
                }}
              >
                {t("儲存名稱", "Save name")}
              </button>
            </div>
          )}
          {warnings.map((warning) => (
            <p key={warning} className="warning">
              {t("基準差異", "Baseline difference")}: {warning}
            </p>
          ))}
          {error && (
            <p className="error notice" role="alert">
              {error}
            </p>
          )}
          {raw ? (
            <CodeEditor
              theme={theme}
              readOnly
              height="400px"
              value={JSON.stringify(
                display.map((record) => ({
                  ...record,
                  plan: JSON.parse(record.plan),
                  indexes: JSON.parse(record.indexes),
                })),
                null,
                2,
              )}
            />
          ) : (
            <div className="explain-runs">
              {display.map((record) => {
                const summary = summarizeExplain(JSON.parse(record.plan));
                return (
                  <section key={record.id}>
                    <h3>
                      {record.id === baselineId
                        ? t("基準", "Baseline")
                        : t("本次", "Latest")}{" "}
                      · {record.name}
                    </h3>
                    <small>
                      {record.capturedAt} · {record.source.connectionName} /{" "}
                      {record.source.environment} · {record.source.provider}{" "}
                      {record.serverVersion} · {record.source.database}.
                      {record.source.collection}
                    </small>
                    <div className="analysis-summary">
                      {[
                        [t("回傳", "Returned"), summary.returned],
                        [t("掃描文件", "Docs examined"), summary.examined],
                        [t("掃描索引鍵", "Keys examined"), summary.keys],
                        [t("伺服器 ms", "Server ms"), summary.elapsed],
                        [t("客戶端 ms", "Client ms"), record.durationMS],
                        [t("掃描／回傳", "Examined / returned"), summary.ratio],
                      ].map(([label, value]) => (
                        <span key={label}>
                          <strong>{value ?? "—"}</strong> {label}
                        </span>
                      ))}
                    </div>
                    {summary.collectionScan && (
                      <p className="warning">
                        COLLSCAN · {t("集合掃描", "Collection scan")}
                      </p>
                    )}
                    <p>
                      {t("使用索引", "Indexes used")}:{" "}
                      {summary.indexes.join(", ") || "—"}
                    </p>
                    <PlanTree nodes={summary.tree} />
                    {record.warnings.map((warning) => (
                      <p className="warning" key={warning}>
                        {warning}
                      </p>
                    ))}
                    <details>
                      <summary>
                        {t(
                          "可重現條件與索引定義",
                          "Reproduction inputs and indexes",
                        )}
                      </summary>
                      <pre>
                        {JSON.stringify(
                          {
                            input: record.input,
                            indexes: JSON.parse(record.indexes),
                            appVersion: record.appVersion,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </section>
                );
              })}
            </div>
          )}
          {latest && (
            <p className="muted">
              {t(
                "匯出檔包含查詢中的實際值、計畫與伺服器資訊，分享前請檢查內容。連線設定與儲存的密碼不會匯出。",
                "Exports include literal query values, plans and server information. Review before sharing. Connection settings and stored credentials are excluded.",
              )}
            </p>
          )}
        </div>
        {showAiAssistant && latest && (
          <AIAssistantPanel
            key={`${query.connectionId}/${query.database}/${query.collection}/explain`}
            connectionId={query.connectionId}
            database={query.database}
            collection={query.collection}
            task="explain"
            language={language}
            profileProvider={profileProvider}
            collectionNames={[]}
            fieldHints={[]}
            currentQuery={
              latest.input.kind === "find"
                ? {
                    filter: latest.input.filter,
                    sort: latest.input.sort,
                    projection: latest.input.projection,
                  }
                : undefined
            }
            explainPlan={latest.plan}
            embedded
            onClose={() => setShowAiAssistant(false)}
            onOpenPreferences={(section) => onOpenPreferences?.(section)}
          />
        )}
      </div>
      {importPreview && (
        <Modal
          wide
          title={t("匯入診斷紀錄預覽", "Diagnostic import preview")}
          close={() => setImportPreview(undefined)}
          footer={
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const record = await api.request(
                    "diagnostics.import",
                    importPreview,
                  );
                  await refresh();
                  setBaselineId(record.id);
                  setImportPreview(undefined);
                  notify(t("診斷紀錄已匯入", "Diagnostic imported"));
                } catch (e) {
                  failed(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("確認匯入", "Confirm import")}
            </button>
          }
        >
          <p>
            {importPreview.name} · {importPreview.source.connectionName} /{" "}
            {importPreview.source.database}.{importPreview.source.collection}
          </p>
          <pre>{JSON.stringify(importPreview, null, 2)}</pre>
          <p className="muted">
            {t(
              "只保存紀錄，不會連線或執行查詢。",
              "Saves the record without connecting or running a query.",
            )}
          </p>
        </Modal>
      )}
      {deleteRecord && (
        <Modal
          title={t("刪除診斷紀錄", "Delete diagnostic record")}
          close={() => setDeleteRecord(undefined)}
          footer={
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.request("diagnostics.delete", {
                    id: deleteRecord.id,
                  });
                  if (latest?.id === deleteRecord.id) setLatest(undefined);
                  setBaselineId("");
                  await refresh();
                  setDeleteRecord(undefined);
                  notify(t("診斷紀錄已刪除", "Diagnostic deleted"));
                } catch (e) {
                  failed(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("確認刪除", "Confirm delete")}
            </button>
          }
        >
          <p>{deleteRecord.name}</p>
        </Modal>
      )}
    </Modal>
  );
}
