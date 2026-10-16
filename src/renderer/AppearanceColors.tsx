import { useEffect, useState } from "react";
import type { Settings } from "../shared/contracts";
import { paletteFields, type PaletteKey } from "../shared/appearance";
import { normalizeColor, readThemePalette } from "./appearance";
import type { ResolvedTheme } from "./preferences";
import { useUi } from "./ui";

export function AppearanceColors({
  draft,
  onUpdate,
}: {
  draft: Settings;
  onUpdate(settings: Settings): void;
}) {
  const { t, theme } = useUi();
  const currentTheme = theme as ResolvedTheme;
  const [base, setBase] = useState<Partial<Record<PaletteKey, string>>>({});
  useEffect(
    () => setBase(readThemePalette(currentTheme, draft.colors)),
    [currentTheme, draft.colors],
  );
  const overrides = draft.themeOverrides[currentTheme] || {};
  const update = (key: PaletteKey, value?: string) => {
    const palette = { ...overrides };
    if (value === undefined) delete palette[key];
    else palette[key] = value;
    const all = { ...draft.themeOverrides };
    if (Object.keys(palette).length) all[currentTheme] = palette;
    else delete all[currentTheme];
    onUpdate({ ...draft, themeOverrides: all });
  };
  return (
    <div className="appearance-customization">
      <div className="customization-heading">
        <p>
          {t(
            "自訂目前主題；切換主題時，各自的配色會獨立保留。",
            "Customize this theme. Each theme retains its own colors.",
          )}
        </p>
        <button
          onClick={() => {
            const all = { ...draft.themeOverrides };
            delete all[currentTheme];
            onUpdate({ ...draft, themeOverrides: all });
          }}
          disabled={!Object.keys(overrides).length}
        >
          {t("還原目前主題配色", "Restore this theme's colors")}
        </button>
      </div>
      {[
        ["workspace", "工作區區域", "Workspace areas"],
        ["data", "資料與選取", "Data and selection"],
        ["interface", "文字與狀態", "Text and status"],
      ].map(([group, zh, en]) => (
        <fieldset className="palette-group" key={group}>
          <legend>{t(zh, en)}</legend>
          <div className="palette-controls">
            {paletteFields
              .filter((field) => field[4] === group)
              .map(([key, , zh, en]) => {
                const value = overrides[key] ?? base[key] ?? "#000000";
                const valid = normalizeColor(value);
                return (
                  <div className="palette-color-field" key={key}>
                    <label htmlFor={`palette-${key}`}>{t(zh, en)}</label>
                    <div className="palette-color-inputs">
                      <input
                        type="color"
                        value={valid || base[key] || "#000000"}
                        aria-label={`${t(zh, en)} ${t("調色盤", "color picker")}`}
                        onChange={(event) => update(key, event.target.value)}
                      />
                      <input
                        id={`palette-${key}`}
                        type="text"
                        spellCheck={false}
                        maxLength={7}
                        aria-label={`${t(zh, en)} HEX`}
                        value={value}
                        aria-invalid={!valid}
                        onChange={(event) => update(key, event.target.value)}
                        onBlur={() => {
                          if (valid && overrides[key] !== undefined)
                            update(key, valid);
                        }}
                      />
                      <button
                        className="subtle"
                        aria-label={`${t("還原", "Restore")} ${t(zh, en)}`}
                        disabled={overrides[key] === undefined}
                        onClick={() => update(key)}
                      >
                        {t("還原", "Reset")}
                      </button>
                    </div>
                    {!valid && (
                      <small className="preference-error" role="alert">
                        {t(
                          "請輸入 #RGB 或 #RRGGBB 色碼。",
                          "Use a #RGB or #RRGGBB color.",
                        )}
                      </small>
                    )}
                  </div>
                );
              })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
