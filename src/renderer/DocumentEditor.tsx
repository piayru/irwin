import { useState, useRef, useMemo } from "react";
import type { editor } from "monaco-editor";
import type { Profile } from "../shared/contracts";
import type { WorkspaceTab } from "./CollectionTab";
import { Copy, Braces } from "lucide-react";
import { api, message, useUi, Modal } from "./ui";
import { CodeEditor } from "./Editor";
import { prettyDocument } from "./Results";
import { getPath, encode, decode } from "../shared/bson";
import {
  formatDocument,
  formatEditableDocument,
  shellJsonLanguage,
} from "./json-format";
import { documentErrorLocation } from "./document-error";
import { documentChanges } from "./document-diff";
import { diagnoseConnectionError } from "../shared/connection-diagnostics";
import { resolveViewStyles } from "./appearance";
type DocumentContext = {
  tab: WorkspaceTab;
  profile?: Profile;
  notify(text: string, error?: boolean, autoDismiss?: boolean): void;
};
export function useDocumentEditor({ tab, notify }: DocumentContext) {
  const ui = useUi();
  const { t } = ui;
  const { tabWidth } = resolveViewStyles(ui).json;
  const target = {
    connectionId: tab.connectionId,
    database: tab.database,
    collection: tab.collection,
  };
  const [docEditor, setDocEditor] = useState<{
    title: string;
    value: string;
    originalValue: string;
    originalEjson?: string;
    originalValueEjson?: string;
    numericReferenceEjson?: string;
    field?: string;
    submit: (value: string, original?: string) => Promise<any>;
    readOnly?: boolean;
  }>();
  const [docError, setDocError] = useState("");
  const docEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const docErrorPosition = documentErrorLocation(docError);
  const docIdentity = useMemo(() => {
    if (!docEditor?.originalEjson) return "";
    const id = JSON.parse(docEditor.originalEjson)._id;
    return id === undefined ? "" : prettyDocument(id, { indent: tabWidth });
  }, [docEditor?.originalEjson, tabWidth]);
  const [docBusy, setDocBusy] = useState(false);
  const [discardDocEditor, setDiscardDocEditor] = useState(false);
  const [showDocChanges, setShowDocChanges] = useState(false);
  const [conflictServerDocument, setConflictServerDocument] = useState<{
    value: string;
    ejson: string;
    originalEjson: string;
  }>();
  const refreshConflictDocument = async () => {
    if (!docEditor) return;
    try {
      const result = await api.request("documents.fetch", {
        ...target,
        original: docEditor.originalEjson ?? docEditor.originalValue,
      });
      const fieldValue = docEditor.field
        ? getPath(JSON.parse(result.ejson), docEditor.field)
        : undefined;
      if (fieldValue && !fieldValue.exists)
        throw new Error(
          t(
            "資料庫中已沒有此欄位，請重新查詢後編輯。",
            "This field no longer exists. Refresh the query before editing.",
          ),
        );
      const valueEjson = fieldValue
        ? JSON.stringify(fieldValue.value)
        : result.ejson;
      setConflictServerDocument({
        value: formatDocument(valueEjson, tabWidth),
        ejson: valueEjson,
        originalEjson: result.ejson,
      });
    } catch (e) {
      setDocError(message(e));
    }
  };
  const applyServerDocument = () => {
    if (!docEditor || !conflictServerDocument) return;
    setDocEditor({
      ...docEditor,
      value: conflictServerDocument.value,
      originalValue: conflictServerDocument.value,
      originalEjson: conflictServerDocument.originalEjson,
      originalValueEjson: conflictServerDocument.ejson,
      numericReferenceEjson: conflictServerDocument.ejson,
    });
    setConflictServerDocument(undefined);
    setDocError("");
  };
  const copyDocumentContent = async () => {
    if (!docEditor) return;
    try {
      await api.request("clipboard.write", { text: docEditor.value });
      notify(t("文件內容已複製", "Document content copied"));
    } catch (e) {
      setDocError(message(e));
    }
  };
  const requestCloseDocEditor = () => {
    if (docBusy || !docEditor) return;
    if (!docEditor.readOnly && docEditor.value !== docEditor.originalValue) {
      setDiscardDocEditor(true);
      return;
    }
    setConflictServerDocument(undefined);
    setDocEditor(undefined);
  };

  return {
    docEditor,
    setDocEditor,
    docError,
    setDocError,
    docEditorRef,
    docErrorPosition,
    docIdentity,
    docBusy,
    setDocBusy,
    discardDocEditor,
    setDiscardDocEditor,
    showDocChanges,
    setShowDocChanges,
    conflictServerDocument,
    setConflictServerDocument,
    refreshConflictDocument,
    applyServerDocument,
    copyDocumentContent,
    requestCloseDocEditor,
  };
}
export function DocumentEditorDialogs({
  controller,
  tab,
  profile,
  notify,
  readOnly,
}: {
  controller: ReturnType<typeof useDocumentEditor>;
  readOnly: boolean;
} & DocumentContext) {
  const ui = useUi();
  const { t, theme, jsonExpandedDepth } = ui;
  const { tabWidth } = resolveViewStyles(ui).json;
  const {
    docEditor,
    setDocEditor,
    docError,
    setDocError,
    docEditorRef,
    docErrorPosition,
    docIdentity,
    docBusy,
    setDocBusy,
    discardDocEditor,
    setDiscardDocEditor,
    showDocChanges,
    setShowDocChanges,
    conflictServerDocument,
    setConflictServerDocument,
    refreshConflictDocument,
    applyServerDocument,
    copyDocumentContent,
    requestCloseDocEditor,
  } = controller;
  return (
    <>
      {" "}
      {docEditor && (
        <Modal
          wide
          resizable
          documentViewer={docEditor.readOnly}
          title={docEditor.title}
          close={requestCloseDocEditor}
          footer={
            <>
              <span className="muted">
                {t(
                  "簡易 JSON · 保留 BSON 型別",
                  "Simple JSON · BSON types preserved",
                )}
              </span>
              <button
                className="icon"
                aria-label={t("複製內容", "Copy content")}
                title={t("複製內容", "Copy content")}
                onClick={() => void copyDocumentContent()}
                disabled={docBusy}
              >
                <Copy size={15} />
              </button>
              <button onClick={requestCloseDocEditor} disabled={docBusy}>
                {t("關閉", "Close")}
              </button>
              {!docEditor.readOnly && (
                <button
                  onClick={() => {
                    try {
                      const formatted = formatEditableDocument(
                        docEditor.value,
                        tabWidth,
                        docEditor.numericReferenceEjson ??
                          docEditor.originalEjson,
                      );
                      setDocEditor({
                        ...docEditor,
                        value: formatted.value,
                        numericReferenceEjson: formatted.ejson,
                      });
                      setDocError("");
                    } catch (e) {
                      setDocError(message(e));
                    }
                  }}
                  disabled={docBusy}
                >
                  <Braces size={15} />
                  {t("格式化文件", "Format document")}
                </button>
              )}
              {!docEditor.readOnly && (
                <button
                  disabled={
                    docBusy || docEditor.value === docEditor.originalValue
                  }
                  onClick={() => setShowDocChanges(true)}
                >
                  {t("檢視變更", "Review changes")}
                </button>
              )}
              {!docEditor.readOnly && (
                <button
                  className="primary"
                  disabled={docBusy}
                  onClick={async () => {
                    setDocBusy(true);
                    setDocError("");
                    try {
                      const original = docEditor.originalEjson;
                      const reference =
                        docEditor.numericReferenceEjson ?? original;
                      const document = encode(
                        decode(
                          docEditor.value,
                          reference === undefined
                            ? undefined
                            : decode(reference),
                        ),
                      );
                      await docEditor.submit(document, original);
                      setDiscardDocEditor(false);
                      setConflictServerDocument(undefined);
                      setDocEditor(undefined);
                    } catch (e) {
                      const error = message(e);
                      const diagnostic = diagnoseConnectionError(error);
                      setDocError(
                        diagnostic.kind === "compatibility"
                          ? `${error}\n${t(
                              "請在「編輯連線 → 進階設定」將「寫入重試」設為「停用」，儲存後重新連線。",
                              diagnostic.advice,
                            )}`
                          : error,
                      );
                      if (docEditor.field) notify(error, true, true);
                      if (/^Conflict:/.test(error))
                        void refreshConflictDocument();
                    } finally {
                      setDocBusy(false);
                    }
                  }}
                >
                  {t("儲存", "Save")}
                </button>
              )}
            </>
          }
        >
          <div className="document-context">
            <span title={tab.connectionName}>{tab.connectionName}</span>
            <strong title={`${tab.database}.${tab.collection}`}>
              {tab.database}.{tab.collection}
            </strong>
            {profile && (
              <span className={`environment-badge ${profile.environment}`}>
                {profile.environment.toUpperCase()}
              </span>
            )}
            {readOnly && (
              <span className="read-only-badge">{t("唯讀", "Read only")}</span>
            )}
            <code title={docIdentity}>
              {docIdentity
                ? `_id: ${docIdentity}`
                : t("新文件", "New document")}
            </code>
          </div>
          <div className="document-editor-surface">
            <CodeEditor
              theme={theme}
              value={docEditor.value}
              onChange={(v) => {
                setDocEditor({ ...docEditor, value: v });
                setDocError("");
              }}
              height="100%"
              language={shellJsonLanguage}
              readOnly={docEditor.readOnly}
              defaultExpandedDepth={jsonExpandedDepth}
              onReady={(instance) => {
                docEditorRef.current = instance;
              }}
              validationError={
                docErrorPosition
                  ? { ...docErrorPosition, message: docError }
                  : undefined
              }
            />
          </div>
          {docError && (
            <div className="notice error document-error" role="alert">
              <strong>
                {docErrorPosition
                  ? t(
                      "文件語法無法解析，請修正後再儲存。",
                      "The document could not be parsed. Fix the syntax before saving.",
                    )
                  : t(
                      "無法確認儲存成功。請查看詳細訊息；遇到逾時或連線中斷時，先重新查詢確認資料。",
                      "The save could not be confirmed. Check the details; after a timeout or connection failure, refresh the document before retrying.",
                    )}
              </strong>
              {docErrorPosition && (
                <button
                  type="button"
                  onClick={() => {
                    const instance = docEditorRef.current,
                      model = instance?.getModel();
                    if (!instance || !model) return;
                    const lineNumber = Math.min(
                      docErrorPosition.line,
                      model.getLineCount(),
                    );
                    const column = Math.min(
                      docErrorPosition.column,
                      model.getLineMaxColumn(lineNumber),
                    );
                    instance.setPosition({ lineNumber, column });
                    instance.revealPositionInCenter({ lineNumber, column });
                    instance.focus();
                  }}
                >
                  {t(
                    `跳到第 ${docErrorPosition.line} 行，第 ${docErrorPosition.column} 列`,
                    `Go to line ${docErrorPosition.line}, column ${docErrorPosition.column}`,
                  )}
                </button>
              )}
              <details>
                <summary>{t("詳細訊息", "Details")}</summary>
                <pre>{docError}</pre>
              </details>
            </div>
          )}
          {conflictServerDocument && (
            <div className="notice warning" role="status">
              {t(
                "已讀取資料庫目前版本。請檢視差異後，選擇保留目前編輯或使用資料庫版本。",
                "The current database version was loaded. Review the differences, then keep your edit or use the database version.",
              )}
            </div>
          )}
        </Modal>
      )}
      {showDocChanges && docEditor && (
        <Modal
          wide
          title={t("文件變更", "Document changes")}
          close={() => setShowDocChanges(false)}
          footer={
            <>
              {conflictServerDocument && (
                <button className="danger" onClick={applyServerDocument}>
                  {t("使用資料庫版本", "Use database version")}
                </button>
              )}
              <button onClick={() => setShowDocChanges(false)}>
                {t("保留目前編輯", "Keep current edit")}
              </button>
            </>
          }
        >
          {(() => {
            try {
              const changes = documentChanges(
                conflictServerDocument?.ejson ??
                  docEditor.originalValueEjson ??
                  docEditor.originalEjson ??
                  docEditor.originalValue,
                docEditor.value,
                docEditor.numericReferenceEjson ?? docEditor.originalEjson,
              );
              return changes.length ? (
                <div className="document-change-list">
                  {changes.map((change) => (
                    <div
                      className={`document-change ${change.kind}`}
                      key={`${change.kind}:${change.path}`}
                    >
                      <code>{change.path}</code>
                      <span>{change.kind}</span>
                      {change.before !== undefined && (
                        <del>{change.before}</del>
                      )}
                      {change.after !== undefined && <ins>{change.after}</ins>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  {t("沒有可比較的變更。", "No changes to compare.")}
                </p>
              );
            } catch {
              return (
                <p className="notice error">
                  {t(
                    "目前內容不是有效的 JSON 或 Mongo Shell 文件，請先格式化或修正後再比較。",
                    "The current content is not valid JSON or a Mongo Shell document. Correct it before comparing.",
                  )}
                </p>
              );
            }
          })()}
        </Modal>
      )}
      {discardDocEditor && docEditor && (
        <Modal
          title={t("放棄未儲存的變更", "Discard unsaved changes")}
          close={() => setDiscardDocEditor(false)}
          footer={
            <>
              <button onClick={() => setDiscardDocEditor(false)}>
                {t("取消", "Cancel")}
              </button>
              <button
                className="danger"
                onClick={() => {
                  setDiscardDocEditor(false);
                  setConflictServerDocument(undefined);
                  setDocEditor(undefined);
                }}
              >
                {t("放棄變更", "Discard changes")}
              </button>
            </>
          }
        >
          <p>
            {t(
              "關閉後將遺失此文件中尚未儲存的內容。",
              "Closing will discard the unsaved content in this document.",
            )}
          </p>
        </Modal>
      )}
    </>
  );
}
