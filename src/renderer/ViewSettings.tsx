import { useState } from "react";
import { settingsSchema, type Settings } from "../shared/contracts";
import { resolveViewStyles } from "./appearance";
import { Field, useUi } from "./ui";

type View = "table" | "tree" | "json";
export function ViewSettings({
  draft,
  onUpdate,
}: {
  draft: Settings;
  onUpdate(settings: Settings): void;
}) {
  const { t } = useUi();
  const [view, setView] = useState<View>("table");
  const overrides = draft.viewSettings[view];
  const styles = resolveViewStyles(draft);
  const resolved = styles[view];
  const parsed = settingsSchema.safeParse(draft);
  const issue = (key: string) =>
    !parsed.success &&
    parsed.error.issues.some(
      (error) =>
        error.path[0] === "viewSettings" &&
        error.path[1] === view &&
        error.path[2] === key,
    );
  const update = (key: string, value: string | number | undefined) => {
    const next = { ...overrides };
    if (value === undefined) delete (next as Record<string, unknown>)[key];
    else (next as Record<string, unknown>)[key] = value;
    onUpdate({
      ...draft,
      viewSettings: { ...draft.viewSettings, [view]: next },
    });
  };
  const numberField = (
    key: string,
    zh: string,
    en: string,
    min: number,
    max: number,
  ) => (
    <Field key={key} label={`${t(zh, en)} (px)`}>
      <input
        type="number"
        aria-label={`${view} ${en}`}
        min={min}
        max={max}
        placeholder={String((resolved as Record<string, unknown>)[key])}
        value={(overrides as Record<string, number>)[key] ?? ""}
        aria-invalid={issue(key)}
        onChange={(event) =>
          update(
            key,
            event.target.value === "" ? undefined : Number(event.target.value),
          )
        }
      />
      {issue(key) && (
        <small className="preference-error" role="alert">
          {key === "lineHeight"
            ? t(
                `請輸入 ${min}–${max}；至少為字級加 2。`,
                `Use ${min}–${max}; at least font size + 2.`,
              )
            : t(
                `請輸入 ${min}–${max} 的整數。`,
                `Use a whole number from ${min} to ${max}.`,
              )}
        </small>
      )}
    </Field>
  );
  return (
    <section className="view-customization">
      <div className="customization-heading">
        <div>
          <h4>{t("各 View 的顯示設定", "Per-view display settings")}</h4>
          <p>
            {t(
              "留空即使用預設值。只影響顯示，不會變更文件內容。",
              "Leave blank to inherit defaults. Display changes do not alter documents.",
            )}
          </p>
        </div>
        <button
          disabled={!Object.keys(overrides).length}
          onClick={() =>
            onUpdate({
              ...draft,
              viewSettings: { ...draft.viewSettings, [view]: {} },
            })
          }
        >
          {t("重設此 View", "Reset this view")}
        </button>
      </div>
      <div
        className="segmented view-style-tabs"
        role="tablist"
        aria-label={t("檢視排版", "View typography")}
      >
        {(["table", "tree", "json"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            {id === "table" ? "Table" : id === "tree" ? "Tree" : "JSON"}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-label={`${view} ${t("顯示設定", "display settings")}`}
        className="preferences-form-grid"
      >
        <Field label={t("字型", "Font family")}>
          <input
            aria-label={`${view} Font family`}
            value={overrides.fontFamily ?? ""}
            placeholder={resolved.fontFamily}
            aria-invalid={issue("fontFamily")}
            onChange={(event) =>
              update(
                "fontFamily",
                event.target.value === "" ? undefined : event.target.value,
              )
            }
          />
          {issue("fontFamily") && (
            <small className="preference-error" role="alert">
              {t("請輸入有效的字型名稱。", "Enter a valid font family.")}
            </small>
          )}
        </Field>
        {numberField("fontSize", "字體大小", "Font size", 10, 24)}
        {numberField("lineHeight", "行高", "Line height", 14, 48)}
        {view !== "json" && (
          <>
            {numberField("paddingX", "左右內距", "Horizontal padding", 0, 32)}
            {numberField("paddingY", "上下內距", "Vertical padding", 0, 16)}
          </>
        )}
        {view === "tree" &&
          numberField("indent", "節點縮排", "Node indentation", 8, 40)}
        {view === "json" && (
          <>
            {numberField("padding", "上下內距", "Vertical padding", 0, 40)}
            <Field label={t("縮排空格數", "Indent spaces")}>
              <select
                aria-label="json Indent spaces"
                value={draft.viewSettings.json.tabWidth ?? ""}
                onChange={(event) =>
                  update(
                    "tabWidth",
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                  )
                }
              >
                <option value="">
                  {t(
                    `使用全域預設（${draft.tabWidth}）`,
                    `Inherit default (${draft.tabWidth})`,
                  )}
                </option>
                {[2, 4, 8].map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>
      <div
        className={`view-style-sample view-style-sample-${view}`}
        aria-label={t("排版預覽", "Typography preview")}
        style={{
          fontFamily: resolved.fontFamily,
          fontSize: resolved.fontSize,
          lineHeight: `${resolved.lineHeight}px`,
          padding:
            view === "json"
              ? `${styles.json.padding}px 12px`
              : `${styles[view].paddingY}px ${styles[view].paddingX}px`,
        }}
      >
        <pre>
          {view === "json"
            ? JSON.stringify(
                { collection: "orders", count: 42 },
                null,
                styles.json.tabWidth,
              )
            : view === "tree"
              ? "▾ document\n" +
                " ".repeat(Math.round(styles.tree.indent / 6)) +
                "name    String\n" +
                " ".repeat(Math.round(styles.tree.indent / 6)) +
                "count   Int"
              : "name                 count\nSample document      42\nAnother document     18"}
        </pre>
      </div>
    </section>
  );
}
