import { useState } from "react";
import {
  parameterTypes,
  type QueryParameter,
} from "../shared/query-parameters";
import { Field, Modal, message, useUi } from "./ui";

export function ParameterEditor({
  value,
  change,
}: {
  value: QueryParameter[];
  change(value: QueryParameter[]): void;
}) {
  const { t } = useUi();
  return (
    <fieldset className="query-parameters full">
      <legend>{t("查詢參數", "Query parameters")}</legend>
      <p className="muted">
        {t(
          '以 {"$irwinParam":"名稱"} 取代值；只替換完整物件，不替換字串。',
          'Use {"$irwinParam":"name"} as a value. Only complete placeholder objects are replaced.',
        )}
      </p>
      {value.map((parameter, index) => (
        <div key={index} className="parameter-row">
          <Field label={t("參數名稱", "Parameter name")}>
            <input
              aria-label={`${t("參數名稱", "Parameter name")} ${index + 1}`}
              value={parameter.name}
              maxLength={64}
              onChange={(e) =>
                change(
                  value.map((p, i) =>
                    i === index ? { ...p, name: e.target.value } : p,
                  ),
                )
              }
            />
          </Field>
          <Field label={t("型別", "Type")}>
            <select
              aria-label={`${t("參數型別", "Parameter type")} ${index + 1}`}
              value={parameter.type}
              onChange={(e) =>
                change(
                  value.map((p, i) =>
                    i === index
                      ? { ...p, type: e.target.value as QueryParameter["type"] }
                      : p,
                  ),
                )
              }
            >
              {parameterTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
          <Field label={t("說明", "Description")}>
            <input
              value={parameter.description}
              maxLength={500}
              onChange={(e) =>
                change(
                  value.map((p, i) =>
                    i === index ? { ...p, description: e.target.value } : p,
                  ),
                )
              }
            />
          </Field>
          <button
            type="button"
            onClick={() => change(value.filter((_, i) => i !== index))}
          >
            {t("移除", "Remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={value.length >= 30}
        onClick={() =>
          change([...value, { name: "", type: "string", description: "" }])
        }
      >
        {t("新增參數", "Add parameter")}
      </button>
    </fieldset>
  );
}
export function ResolveParametersDialog({
  parameters,
  close,
  apply,
}: {
  parameters: QueryParameter[];
  close(): void;
  apply(values: Record<string, string>): void;
}) {
  const { t } = useUi();
  const [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(parameters.map((parameter) => [parameter.name, ""])),
    ),
    [error, setError] = useState("");
  return (
    <Modal
      title={t("填入查詢參數", "Fill query parameters")}
      close={close}
      footer={
        <button
          className="primary"
          onClick={() => {
            try {
              for (const p of parameters)
                if (!Object.hasOwn(values, p.name))
                  throw new Error(`${t("請填入", "Enter")} ${p.name}`);
              apply(values);
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          {t("套用條件", "Apply inputs")}
        </button>
      }
    >
      <p className="muted">
        {t(
          "套用到目前分頁，不會自動執行。",
          "Applies to the current tab without executing.",
        )}
      </p>
      {parameters.map((p) => (
        <Field key={p.name} label={`${p.name} · ${p.type}`}>
          <input
            aria-label={`Parameter ${p.name}`}
            autoComplete="off"
            value={values[p.name] ?? ""}
            onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
          />
          <small>{p.description}</small>
        </Field>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
