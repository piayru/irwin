import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { QueryInput } from "../shared/contracts";
import type { FieldHint } from "../shared/exploration";
import {
  buildDateCondition,
  buildEmptyCondition,
  buildListCondition,
  buildObjectIdCondition,
  buildRegexCondition,
  combineFilterCondition,
  convertObjectIdStrings,
  objectIdConversions,
  type EmptyKind,
  type ListSeparator,
  type ListType,
} from "../shared/filter-tools";
import { previewRegex, type RegexPreview } from "./filter-regex-preview";
import {
  runFilterDiagnosis,
  type DiagnosisResult,
  type ProbeResult,
} from "./filter-diagnosis";
import { api, Field, Modal, message, useUi } from "./ui";
import { formatQuery } from "./query-editing";

export type FilterTool =
  "regex" | "list" | "objectId" | "date" | "empty" | "diagnose";
export function FilterToolsDialog({
  value,
  fields,
  initialTool = "regex",
  query,
  apply,
  close,
}: {
  value: string;
  fields: FieldHint[];
  initialTool?: FilterTool;
  query?: QueryInput;
  apply(value: string): void;
  close(): void;
}) {
  const { t } = useUi(),
    id = useId();
  const [tool, setTool] = useState<FilterTool>(initialTool);
  const [field, setField] = useState(
    fields.find((item) => item.types.includes("String"))?.path ||
      fields[0]?.path ||
      "",
  );
  const [replace, setReplace] = useState(false);
  const [pattern, setPattern] = useState(""),
    [flags, setFlags] = useState("i"),
    [sample, setSample] = useState("");
  const [regex, setRegex] = useState<RegexPreview>(),
    [testing, setTesting] = useState(false);
  const [testedInput, setTestedInput] = useState("");
  const regexInput = JSON.stringify([pattern, flags, sample]);
  const previewPending = testing || testedInput !== regexInput;
  const [list, setList] = useState(""),
    [listType, setListType] = useState<ListType>("string"),
    [separator, setSeparator] = useState<ListSeparator>("newline");
  const [hex, setHex] = useState("");
  const suggestions = useMemo(
    () => objectIdConversions(value, fields),
    [value, fields],
  );
  const [convert, setConvert] = useState(suggestions.length > 0);
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [zone, setZone] = useState("local"),
    [inclusive, setInclusive] = useState(false);
  const [customZone, setCustomZone] = useState("+08:00");
  const [emptyKind, setEmptyKind] = useState<EmptyKind>("null");
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult>();
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]),
    [diagnosing, setDiagnosing] = useState(false),
    [diagnosisError, setDiagnosisError] = useState("");
  const diagnosisAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (tool !== "regex") return;
    const controller = new AbortController();
    setTesting(true);
    const timer = setTimeout(() => {
      void previewRegex(pattern, flags, sample, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) {
            setRegex(result);
            setTestedInput(JSON.stringify([pattern, flags, sample]));
            setTesting(false);
          }
        },
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tool, pattern, flags, sample]);
  useEffect(
    () => () => {
      diagnosisAbort.current?.abort();
      diagnosisAbort.current = null;
    },
    [tool, value, query?.connectionId, query?.database, query?.collection],
  );
  const generated = useMemo(() => {
    try {
      let condition: string,
        detail = "";
      if (tool === "diagnose") return { text: "", detail: "" };
      if (tool === "objectId" && convert && suggestions.length)
        return {
          text: convertObjectIdStrings(value, fields),
          detail: t(
            `將轉換 ${suggestions.length} 個字串；其他條件保留。`,
            `${suggestions.length} strings will be converted; other conditions are preserved.`,
          ),
        };
      if (tool === "regex")
        condition = buildRegexCondition(field, pattern, flags);
      else if (tool === "list") {
        const result = buildListCondition(field, list, listType, separator);
        condition = result.condition;
        detail = t(
          `${result.count} 個值 · 已移除 ${result.duplicates} 個重複值`,
          `${result.count} values · ${result.duplicates} duplicates removed`,
        );
      } else if (tool === "objectId")
        condition = buildObjectIdCondition(field, hex);
      else if (tool === "date")
        condition = buildDateCondition(field, {
          start,
          end,
          zone: zone === "custom" ? customZone : zone,
          inclusiveEnd: inclusive,
        });
      else condition = buildEmptyCondition(field, emptyKind);
      return {
        text: replace ? condition : combineFilterCondition(value, condition),
        detail,
      };
    } catch (error) {
      return { text: "", detail: "", error: message(error) };
    }
  }, [
    tool,
    field,
    pattern,
    flags,
    list,
    listType,
    separator,
    hex,
    start,
    end,
    zone,
    customZone,
    inclusive,
    emptyKind,
    convert,
    suggestions.length,
    value,
    fields,
    replace,
    t,
  ]);
  const previewText = useMemo(() => {
    try {
      return formatQuery(generated.text);
    } catch {
      return generated.text;
    }
  }, [generated.text]);
  const runDiagnosis = async () => {
    if (!query || diagnosing) return;
    const controller = new AbortController();
    diagnosisAbort.current = controller;
    setDiagnosing(true);
    setDiagnosis(undefined);
    setProbeResults([]);
    setDiagnosisError("");
    try {
      const result = await runFilterDiagnosis(
        { ...query, filter: value },
        {
          read: (input) => api.request("queries.run", input),
          cancel: (cursorId) => api.request("queries.cancel", { cursorId }),
        },
        controller.signal,
        (results) => {
          if (!controller.signal.aborted) setProbeResults(results);
        },
      );
      if (diagnosisAbort.current === controller) setDiagnosis(result);
    } catch (error) {
      if (!controller.signal.aborted) setDiagnosisError(message(error));
    } finally {
      if (diagnosisAbort.current === controller) setDiagnosing(false);
    }
  };
  const tools: { key: FilterTool; label: string }[] = [
    { key: "regex", label: t("Regex 測試", "Regex") },
    { key: "list", label: t("清單轉 $in", "List to $in") },
    { key: "objectId", label: "ObjectId" },
    { key: "date", label: t("日期區間", "Date range") },
    { key: "empty", label: t("空值分類", "Empty values") },
    ...(query
      ? [
          {
            key: "diagnose" as const,
            label: t("無結果診斷", "No-result diagnosis"),
          },
        ]
      : []),
  ];
  const samplePreview = () => {
    const parts = [],
      matches = testedInput === regexInput ? regex?.matches || [] : [];
    let offset = 0;
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index];
      parts.push(
        sample.slice(offset, match.start),
        <mark key={index}>{sample.slice(match.start, match.end) || "∣"}</mark>,
      );
      offset = match.end;
    }
    parts.push(sample.slice(offset));
    return parts;
  };
  return (
    <Modal
      title={t("Filter 助手", "Filter assistant")}
      close={close}
      wide
      resizable
      className="filter-tools-modal"
      footer={
        <>
          <span className="muted">
            {t(
              "套用只修改 Filter，不會執行查詢。",
              "Apply changes the filter without running a query.",
            )}
          </span>
          <button onClick={close}>{t("關閉", "Close")}</button>
          {tool !== "diagnose" && (
            <button
              className="primary"
              disabled={
                !generated.text ||
                (tool === "regex" &&
                  (previewPending || !!regex?.error || !regex?.matches))
              }
              onClick={() => {
                apply(generated.text);
                close();
              }}
            >
              {t("套用到 Filter", "Apply to FILTER")}
            </button>
          )}
        </>
      }
    >
      <nav
        className="filter-tools-nav"
        aria-label={t("Filter 工具", "Filter tools")}
      >
        {tools.map((item) => (
          <button
            key={item.key}
            className={tool === item.key ? "active" : ""}
            aria-pressed={tool === item.key}
            onClick={() => {
              diagnosisAbort.current?.abort();
              setDiagnosing(false);
              setTool(item.key);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <datalist id={`${id}-fields`}>
        {fields.map((item) => (
          <option key={item.path} value={item.path}>
            {item.types.join(" / ")}
          </option>
        ))}
      </datalist>
      {tool === "diagnose" ? (
        <section className="filter-diagnosis">
          <p>
            {t(
              "逐一檢查 Collection、單一條件，以及移除某條件後是否有文件。最多 9 次唯讀探測，每次最多 2 秒、總計 12 秒；不計算總筆數。",
              "Check whether the collection, individual conditions, and filters with one condition removed match any document. Up to 9 read-only probes, 2 seconds each and 12 seconds total; no full counts.",
            )}
          </p>
          <p className="muted">
            {t(
              "只分析前四個 AND 條件；OR 分組保持完整。資料可能在探測之間變動，結果用於排查，不保證單一成因。",
              "Only the first four AND conditions are analyzed; OR groups stay intact. Data may change between probes, so results are clues rather than proof of a single cause.",
            )}
          </p>
          <pre className="filter-tools-preview">{value || "{}"}</pre>
          <div className="filter-tools-actions">
            <button
              className="primary"
              disabled={diagnosing || !query}
              onClick={() => void runDiagnosis()}
            >
              {t("開始診斷", "Start diagnosis")}
            </button>
            {diagnosing && (
              <button onClick={() => diagnosisAbort.current?.abort()}>
                {t("取消診斷", "Cancel diagnosis")}
              </button>
            )}
            <span role="status">
              {diagnosing
                ? t(
                    `正在檢查 · 已完成 ${probeResults.length} 項`,
                    `Checking · ${probeResults.length} probes completed`,
                  )
                : diagnosis?.completion === "cancelled"
                  ? t("已取消", "Cancelled")
                  : diagnosis?.completion === "timedOut"
                    ? t(
                        "已達時間上限，未完成的檢查不能視為無匹配。",
                        "Time limit reached; unfinished probes do not mean no matches.",
                      )
                    : diagnosis?.completion === "complete"
                      ? t("診斷完成", "Diagnosis completed")
                      : ""}
            </span>
          </div>
          {diagnosisError && (
            <p role="alert" className="notice error">
              {diagnosisError}
            </p>
          )}
          {diagnosis?.truncated && (
            <p className="muted">
              {t(
                "條件超過四項，本次只測試前四項；移除測試仍保留其他條件。",
                "More than four conditions: only the first four were tested; removal probes retain all remaining conditions.",
              )}
            </p>
          )}
          <div className="filter-diagnosis-results">
            {probeResults.map((result) => (
              <div key={result.id} className="filter-diagnosis-row">
                <div>
                  <strong>
                    {result.kind === "collection"
                      ? t("Collection 是否有資料", "Collection has documents")
                      : result.kind === "only"
                        ? t(`只使用 ${result.field}`, `Only ${result.field}`)
                        : t(`移除 ${result.field}`, `Without ${result.field}`)}
                  </strong>
                  <span className={result.error ? "error-text" : "muted"}>
                    {result.error ||
                      (result.matches
                        ? t("有符合文件", "Matches found")
                        : t("沒有符合文件", "No matches"))}
                  </span>
                  <details>
                    <summary>{t("查看檢查條件", "View probe filter")}</summary>
                    <pre className="filter-tools-preview">{result.filter}</pre>
                  </details>
                </div>
                {result.kind === "without" &&
                  result.matches &&
                  !result.error && (
                    <button
                      disabled={diagnosing}
                      onClick={() => {
                        apply(result.filter);
                        close();
                      }}
                    >
                      {t("套用此條件", "Apply this filter")}
                    </button>
                  )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="filter-tools-grid">
          <section className="filter-tools-form">
            {!(tool === "objectId" && convert && suggestions.length > 0) && (
              <Field label={t("欄位路徑", "Field path")}>
                <input
                  list={`${id}-fields`}
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                  placeholder="profile.name"
                  autoComplete="off"
                />
              </Field>
            )}
            {tool === "regex" && (
              <>
                <Field
                  label={t(
                    "規則（不含前後斜線）",
                    "Pattern (without delimiters)",
                  )}
                >
                  <input
                    value={pattern}
                    maxLength={1000}
                    onChange={(event) => setPattern(event.target.value)}
                    placeholder="^Ada"
                    spellCheck={false}
                  />
                </Field>
                <div className="filter-regex-flags">
                  {["i", "m", "s", "u"].map((flag) => (
                    <label key={flag}>
                      <input
                        type="checkbox"
                        checked={flags.includes(flag)}
                        onChange={(event) =>
                          setFlags((old) =>
                            event.target.checked
                              ? [...old, flag].sort().join("")
                              : old.replace(flag, ""),
                          )
                        }
                      />
                      {
                        {
                          i: t("i 忽略大小寫", "i Ignore case"),
                          m: t("m 多行錨點", "m Multiline anchors"),
                          s: t("s 跨行比對", "s Dot matches newline"),
                          u: t("u Unicode", "u Unicode"),
                        }[flag]
                      }
                    </label>
                  ))}
                </div>
                <Field
                  label={t(
                    "測試文字（僅在本機使用）",
                    "Test text (local only)",
                  )}
                >
                  <textarea
                    rows={5}
                    value={sample}
                    maxLength={4000}
                    onChange={(event) => setSample(event.target.value)}
                    placeholder={"Ada\nADA\nGrace"}
                  />
                </Field>
                <div role="status">
                  {previewPending ? (
                    t("測試中…", "Testing…")
                  ) : regex?.error ? (
                    <span className="error-text">{regex.error}</span>
                  ) : (
                    t(
                      `${regex?.matches?.length ?? 0} 處匹配${regex?.truncated ? "（最多顯示 100 處）" : ""}`,
                      `${regex?.matches?.length ?? 0} matches${regex?.truncated ? " (first 100)" : ""}`,
                    )
                  )}
                </div>
                <pre
                  className="filter-regex-sample"
                  aria-label={t("Regex 比對預覽", "Regex match preview")}
                >
                  {samplePreview()}
                </pre>
                <small className="muted">
                  {t(
                    "此預覽使用瀏覽器 Regex；MongoDB 的 PCRE 規則可能不同。",
                    "This preview uses browser Regex; MongoDB PCRE behavior may differ.",
                  )}
                </small>
              </>
            )}
            {tool === "list" && (
              <>
                <div className="filter-tools-pair">
                  <Field label={t("值的型別", "Value type")}>
                    <select
                      aria-label={t("值的型別", "Value type")}
                      value={listType}
                      onChange={(event) =>
                        setListType(event.target.value as ListType)
                      }
                    >
                      <option value="string">
                        {t("文字（保留前導零）", "Text (keeps leading zeros)")}
                      </option>
                      <option value="number">{t("數字", "Number")}</option>
                      <option value="objectId">ObjectId</option>
                    </select>
                  </Field>
                  <Field label={t("分隔方式", "Separator")}>
                    <select
                      aria-label={t("分隔方式", "Separator")}
                      value={separator}
                      onChange={(event) =>
                        setSeparator(event.target.value as ListSeparator)
                      }
                    >
                      <option value="newline">
                        {t("每行一個值", "One value per line")}
                      </option>
                      <option value="comma">{t("逗號", "Comma")}</option>
                      <option value="tab">
                        {t("Tab／換行", "Tab / newline")}
                      </option>
                    </select>
                  </Field>
                </div>
                <Field
                  label={t(
                    "貼上清單（最多 500 個值）",
                    "Paste a list (up to 500 values)",
                  )}
                >
                  <textarea
                    rows={6}
                    maxLength={64000}
                    value={list}
                    onChange={(event) => setList(event.target.value)}
                    placeholder={"001\n002\n003"}
                  />
                </Field>
                <small className="muted">
                  {t(
                    "會去除每個值前後空白、空行與重複值；不會自動判定文字為數字。",
                    "Trims whitespace and removes empty lines and duplicates; text is never silently converted to numbers.",
                  )}
                </small>
              </>
            )}
            {tool === "objectId" && (
              <>
                {suggestions.length > 0 && (
                  <>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={convert}
                        onChange={(event) => setConvert(event.target.checked)}
                      />
                      {t(
                        "轉換目前 Filter 中已辨識的字串",
                        "Convert recognized strings in the current filter",
                      )}
                    </label>
                    <p className="muted">
                      {suggestions.map((item) => item.field).join(", ")}
                    </p>
                  </>
                )}
                {(!convert || !suggestions.length) && (
                  <Field
                    label={t(
                      "ObjectId（24 位十六進位）",
                      "ObjectId (24 hexadecimal characters)",
                    )}
                  >
                    <input
                      value={hex}
                      maxLength={24}
                      onChange={(event) => setHex(event.target.value)}
                      placeholder="507f1f77bcf86cd799439011"
                      spellCheck={false}
                    />
                  </Field>
                )}
                <p className="muted">
                  {t(
                    "只有 _id 或已知為 ObjectId 的欄位會提供自動建議。按套用才轉換，文字 ID 不會自動變更。",
                    "Automatic suggestions only target _id or fields known to hold ObjectIds. Strings change only after you apply the preview.",
                  )}
                </p>
              </>
            )}
            {tool === "date" && (
              <>
                <Field label={t("時區", "Timezone")}>
                  <select
                    aria-label={t("時區", "Timezone")}
                    value={zone}
                    onChange={(event) => setZone(event.target.value)}
                  >
                    <option value="local">
                      {t("本機時區", "Local timezone")} (
                      {Intl.DateTimeFormat().resolvedOptions().timeZone})
                    </option>
                    <option value="UTC">UTC</option>
                    {[
                      "-08:00",
                      "-05:00",
                      "+01:00",
                      "+05:30",
                      "+08:00",
                      "+09:00",
                    ].map((offset) => (
                      <option key={offset} value={offset}>
                        UTC{offset} {t("固定偏移", "fixed offset")}
                      </option>
                    ))}
                    <option value="custom">
                      {t("自訂 UTC 固定偏移", "Custom UTC offset")}
                    </option>
                  </select>
                </Field>
                {zone === "custom" && (
                  <Field
                    label={t(
                      "UTC 偏移（例如 +08:00）",
                      "UTC offset (e.g. +08:00)",
                    )}
                  >
                    <input
                      value={customZone}
                      onChange={(event) => setCustomZone(event.target.value)}
                      placeholder="+08:00"
                      maxLength={6}
                    />
                  </Field>
                )}
                <Field label={t("起始時間（含）", "Start time (inclusive)")}>
                  <input
                    type="datetime-local"
                    step="1"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </Field>
                <Field label={t("結束時間", "End time")}>
                  <input
                    type="datetime-local"
                    step="1"
                    value={end}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </Field>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={inclusive}
                    onChange={(event) => setInclusive(event.target.checked)}
                  />
                  {t(
                    "包含結束時間（預設不含）",
                    "Include end time (excluded by default)",
                  )}
                </label>
                <p className="muted">
                  {t(
                    "可只填一端；預覽會顯示轉換後的 UTC 時間。本機夏令時間的重複時段請以 UTC 或固定偏移確認。",
                    "Either endpoint is optional. Preview shows UTC. For ambiguous local daylight-saving times, use UTC or a fixed offset.",
                  )}
                </p>
              </>
            )}
            {tool === "empty" && (
              <>
                <Field label={t("要尋找的狀態", "Value state")}>
                  <select
                    aria-label={t("要尋找的狀態", "Value state")}
                    value={emptyKind}
                    onChange={(event) =>
                      setEmptyKind(event.target.value as EmptyKind)
                    }
                  >
                    <option value="null">Null</option>
                    <option value="missing">
                      {t("欄位不存在", "Field is missing")}
                    </option>
                    <option value="emptyString">
                      {t('空字串 ""', 'Empty string ""')}
                    </option>
                    <option value="emptyArray">
                      {t("空陣列 []", "Empty array []")}
                    </option>
                  </select>
                </Field>
                <p className="muted">
                  {t(
                    "Null 與欄位不存在分開查詢；含有 Null 或空字串的非空陣列不會被當成空值。",
                    "Null and missing fields are distinct. Non-empty arrays containing null or empty strings are not classified as empty values.",
                  )}
                </p>
              </>
            )}
          </section>
          <aside className="filter-tools-output">
            <strong>{t("套用後的 Filter", "Filter after applying")}</strong>
            {!(tool === "objectId" && convert && suggestions.length) && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(event) => setReplace(event.target.checked)}
                />
                {t(
                  "取代目前 Filter（預設加入 AND）",
                  "Replace current filter (default: add AND)",
                )}
              </label>
            )}
            <pre
              className="filter-tools-preview"
              aria-label={t("Filter 預覽", "Filter preview")}
            >
              {generated.text
                ? previewText
                : t(
                    "完成左側欄位後即可預覽。",
                    "Complete the fields to preview the filter.",
                  )}
            </pre>
            {generated.detail && <p role="status">{generated.detail}</p>}
            {generated.error && (
              <p className="filter-tools-validation" role="status">
                {generated.error}
              </p>
            )}
          </aside>
        </div>
      )}
    </Modal>
  );
}
