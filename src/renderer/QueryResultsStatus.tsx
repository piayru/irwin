import { Hash, LoaderCircle } from "lucide-react";
import { useUi } from "./ui";

export function QueryResultsStatus({
  loaded,
  hasMore,
  count,
  counting,
  error,
  onCount,
}: {
  loaded: number;
  hasMore: boolean;
  count?: number;
  counting: boolean;
  error: string;
  onCount?: () => void;
}) {
  const { t } = useUi();
  return (
    <div
      className="query-results-status"
      role="group"
      aria-label={t("查詢結果狀態", "Query result status")}
    >
      <span className="muted small" role="status">
        {loaded.toLocaleString()} {t("筆已載入", "loaded")}
        {hasMore ? t(" · 尚可載入更多", " · more available") : ""}
        {count !== undefined
          ? ` · ${t("符合", "Matching")} ${count.toLocaleString()}`
          : ""}
      </span>
      {onCount && (
        <button
          type="button"
          className="count-documents"
          disabled={counting}
          aria-label={t("計算筆數", "Count documents")}
          title={t(
            "手動計算符合 Filter 的總筆數；大型集合可能需要較長時間。",
            "Count all documents matching the filter. Large collections may take time.",
          )}
          onClick={onCount}
        >
          {counting ? (
            <LoaderCircle size={13} className="spin" aria-hidden="true" />
          ) : (
            <Hash size={13} aria-hidden="true" />
          )}
          {counting
            ? t("計算中…", "Counting…")
            : t("計算筆數", "Count documents")}
        </button>
      )}
      {error && (
        <span className="count-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
