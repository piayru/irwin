import { lazy, Suspense, useState, type ComponentProps } from "react";
import { useUi } from "./ui";
type EditorModule = typeof import("./MonacoEditor");
let loadedEditor: EditorModule["CodeEditor"] | undefined;
let loadingEditor: Promise<EditorModule> | undefined;
// Keep Monaco out of startup; query workspaces can warm it before the first edit.
export function preloadCodeEditor() {
  return (loadingEditor ??= import("./MonacoEditor").then(
    (module) => {
      loadedEditor = module.CodeEditor;
      return module;
    },
    (error) => {
      loadingEditor = undefined;
      throw error;
    },
  ));
}
const MonacoEditor = lazy(() =>
  preloadCodeEditor().then((module) => ({ default: module.CodeEditor })),
);
export function CodeEditor(props: ComponentProps<typeof MonacoEditor>) {
  const { t } = useUi();
  // A warmed editor can mount directly. Keep its component identity stable for
  // this mount so later parent updates never recreate a live editing session.
  const [EditorComponent] = useState(() => loadedEditor ?? MonacoEditor);
  return (
    <Suspense
      fallback={
        <div
          className="editor-loading"
          style={{ height: props.height || "200px" }}
          role="status"
        >
          {t("正在載入編輯器…", "Loading editor…")}
        </div>
      }
    >
      <EditorComponent {...props} />
    </Suspense>
  );
}
