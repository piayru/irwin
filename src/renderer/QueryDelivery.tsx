import { useEffect, useState } from "react";
import {
  driverCode,
  parseQueryBundle,
  type DeliveryInput,
  type QueryBundle,
} from "../shared/query-delivery";
import type { SavedQuery } from "../shared/saved-query";
import type { SavedPipeline } from "../shared/saved-pipeline";
import { CodeEditor } from "./Editor";
import { Field, Modal, api, message, useUi } from "./ui";

export function QueryDeliveryDialog({
  input,
  close,
  notify,
}: {
  input: DeliveryInput;
  close(): void;
  notify(text: string, error?: boolean): void;
}) {
  const { t, theme } = useUi();
  const [language, setLanguage] = useState<"node" | "python">("node"),
    [error, setError] = useState("");
  let content = "";
  try {
    content = driverCode(input, language);
  } catch (e) {
    content = `${t("無法產生程式碼", "Cannot generate code")}: ${message(e)}`;
  }
  const valid = !content.startsWith(
    t("無法產生程式碼", "Cannot generate code"),
  );
  const deliver = async (copy: boolean) => {
    try {
      if (copy) await api.request("clipboard.write", { text: content });
      else {
        const path = await api.request("files.choose", {
          kind: "save",
          title: t("匯出 Driver 程式碼", "Export driver code"),
          defaultPath: `${input.collection.replace(/[\\/<>:"|?*]/g, "_")}-${input.stages ? "pipeline" : "query"}.${language === "node" ? "mjs" : "py"}`,
        });
        if (!path) return;
        await api.request("delivery.export", { path, content });
      }
      setError("");
      notify(
        copy
          ? t("程式碼已複製", "Code copied")
          : t("程式碼已匯出", "Code exported"),
      );
    } catch (e) {
      setError(message(e));
      notify(message(e), true);
    }
  };
  return (
    <Modal
      wide
      resizable
      title={t("查詢交付", "Query delivery")}
      close={close}
      footer={
        <>
          <button disabled={!valid} onClick={() => void deliver(true)}>
            {t("複製程式碼", "Copy code")}
          </button>
          <button
            disabled={!valid}
            className="primary"
            onClick={() => void deliver(false)}
          >
            {t("匯出程式碼", "Export code")}
          </button>
        </>
      }
    >
      <Field label={t("目標語言", "Target language")}>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as "node" | "python")}
        >
          <option value="node">Node.js / TypeScript</option>
          <option value="python">Python / PyMongo</option>
        </select>
      </Field>
      <p className="muted">
        {input.database}.{input.collection} ·{" "}
        {t(
          "使用 MONGODB_URI 環境變數連線。程式保留 BSON 型別、排序與查詢時間上限；逐筆讀取全部符合條件的結果。",
          "Connects using MONGODB_URI. Preserves BSON types, sort and time limits; streams all matching results.",
        )}
      </p>
      <CodeEditor theme={theme} value={content} readOnly height="420px" />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function QueryBundleDialog({
  close,
  notify = () => {},
}: {
  close(): void;
  notify?(text: string, error?: boolean): void;
}) {
  const { t } = useUi();
  const [queries, setQueries] = useState<SavedQuery[]>([]),
    [pipelines, setPipelines] = useState<SavedPipeline[]>([]);
  const [selected, setSelected] = useState<string[]>([]),
    [name, setName] = useState("Team queries"),
    [source, setSource] = useState(false);
  const [preview, setPreview] = useState<QueryBundle>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const [q, p] = await Promise.all([
      api.request("savedQueries.list", {}),
      api.request("savedPipelines.list", {}),
    ]);
    setQueries(q);
    setPipelines(p);
    setSelected([
      ...q.map((v: SavedQuery) => `q:${v.id}`),
      ...p.map((v: SavedPipeline) => `p:${v.id}`),
    ]);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, []);
  const failed = (e: unknown) => {
    setError(message(e));
    notify(message(e), true);
  };
  const exportBundle = async () => {
    setBusy(true);
    setError("");
    try {
      if (!selected.length)
        throw new Error(
          t(
            "請選擇至少一筆查詢或 Pipeline。",
            "Select at least one query or pipeline.",
          ),
        );
      const metadata = <T extends { source?: unknown }>(entry: T) =>
        source ? entry : { ...entry, source: undefined };
      const bundle = parseQueryBundle({
        format: "irwin-query-bundle",
        version: 1,
        name,
        exportedAt: new Date().toISOString(),
        queries: queries
          .filter((q) => selected.includes(`q:${q.id}`))
          .map(metadata),
        pipelines: pipelines
          .filter((p) => selected.includes(`p:${p.id}`))
          .map(metadata),
      });
      const path = await api.request("files.choose", {
        kind: "save",
        title: t("匯出團隊查詢包", "Export team query bundle"),
        defaultPath: `${bundle.name.replace(/[\\/<>:"|?*]/g, "_")}.irwin-queries.json`,
      });
      if (!path) return;
      await api.request("reports.export", {
        path,
        content: JSON.stringify(bundle, null, 2),
      });
      notify(t("查詢包已匯出", "Query bundle exported"));
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  const read = async () => {
    setBusy(true);
    setError("");
    try {
      const path = await api.request("files.choose", {
        kind: "open",
        title: t("選擇團隊查詢包", "Choose team query bundle"),
      });
      if (path) setPreview(await api.request("queryBundles.read", { path }));
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  const importBundle = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await api.request("queryBundles.import", preview);
      await refresh();
      window.dispatchEvent(new Event("irwin:query-library-changed"));
      setPreview(undefined);
      notify(t("查詢包已匯入", "Query bundle imported"));
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  const entries = (q: SavedQuery[], p: SavedPipeline[], check: boolean) => (
    <div className="bundle-entries">
      {[
        ...q.map((item) => ({
          key: `q:${item.id}`,
          name: item.name,
          kind: item.query.mode,
          group: item.group,
          description: item.description,
          details: item,
        })),
        ...p.map((item) => ({
          key: `p:${item.id}`,
          name: item.name,
          kind: "pipeline",
          group: item.group,
          description: item.description,
          details: item,
        })),
      ].map((item, index) => (
        <div className="bundle-entry" key={`${item.key}:${index}`}>
          {check && (
            <input
              type="checkbox"
              aria-label={item.name}
              checked={selected.includes(item.key)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, item.key]
                    : selected.filter((id) => id !== item.key),
                )
              }
            />
          )}
          <details>
            <summary>
              <strong>{item.name}</strong> · {item.kind} ·{" "}
              {item.group || t("未分組", "Ungrouped")}
            </summary>
            <p>{item.description}</p>
            <pre>{JSON.stringify(item.details, null, 2)}</pre>
          </details>
        </div>
      ))}
    </div>
  );
  return (
    <Modal
      wide
      resizable
      title={t("團隊查詢包", "Team query bundle")}
      close={() => {
        if (!busy) close();
      }}
      footer={
        <>
          <button disabled={busy} onClick={() => void read()}>
            {t("選擇匯入檔案", "Choose import file")}
          </button>
          {preview ? (
            <button
              disabled={busy}
              className="primary"
              onClick={() => void importBundle()}
            >
              {t("確認匯入", "Confirm import")}
            </button>
          ) : (
            <button
              disabled={busy || !selected.length}
              className="primary"
              onClick={() => void exportBundle()}
            >
              {t("匯出選取項目", "Export selected")}
            </button>
          )}
        </>
      }
    >
      {preview ? (
        <>
          <h3>
            {t("匯入預覽", "Import preview")}: {preview.name}
          </h3>
          <p className="muted">
            {t(
              "匯入會建立新的查詢，不會覆蓋既有項目。之後套用到目前分頁才會選定目標環境。",
              "Imports as new entries. Applying later selects the active target environment.",
            )}
          </p>
          {entries(preview.queries, preview.pipelines, false)}
          <button disabled={busy} onClick={() => setPreview(undefined)}>
            {t("取消預覽", "Cancel preview")}
          </button>
        </>
      ) : (
        <>
          <Field label={t("查詢包名稱", "Bundle name")}>
            <input
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={source}
              onChange={(e) => setSource(e.target.checked)}
            />
            {t(
              "包含來源連線名稱與 namespace",
              "Include source connection name and namespace",
            )}
          </label>
          {entries(queries, pipelines, true)}
        </>
      )}
      <p className="muted">
        {t(
          "分享前可展開檢查內容。查詢包包含條件中的實際值與 Shell 原始程式；連線設定與密碼不會隨包匯出。匯入後不會自動執行。",
          "Expand entries to review before sharing. Bundles contain literal query values and raw Shell scripts; connection settings and stored credentials are excluded. Imports never execute.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
