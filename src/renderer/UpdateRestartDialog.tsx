import { Modal, useUi } from "./ui";

export function UpdateRestartDialog({
  connections,
  tabs,
  blocked,
  preparing,
  error,
  cancel,
  install,
}: {
  connections: number;
  tabs: number;
  blocked: boolean;
  preparing: boolean;
  error: string;
  cancel(): void;
  install(): void;
}) {
  const { t } = useUi();
  return (
    <Modal
      title={t("安裝更新並重新啟動？", "Install update and restart?")}
      className="update-restart-modal"
      close={cancel}
      footer={
        <>
          <button disabled={preparing} onClick={cancel}>
            {t("取消", "Cancel")}
          </button>
          <button
            className="primary"
            disabled={preparing || blocked}
            onClick={install}
          >
            {preparing
              ? t("正在保留草稿…", "Saving drafts…")
              : t("關閉分頁並安裝", "Close tabs and install")}
          </button>
        </>
      }
    >
      <p>
        {t(
          `安裝更新將關閉目前 ${connections} 個連線、${tabs} 個分頁，完成後自動重新啟動 Irwin。`,
          `Installing closes ${connections} active ${connections === 1 ? "connection" : "connections"} and ${tabs} open ${tabs === 1 ? "tab" : "tabs"}, then automatically restarts Irwin.`,
        )}
      </p>
      <p>
        {t(
          "未儲存的查詢修改將會遺失；尚未執行的 Shell 內容會先保留為草稿。若需儲存查詢，請取消並返回工作區。",
          "Unsaved query changes will be lost. Unexecuted Shell content is saved as a draft first. Cancel to return to the workspace if you need to save queries.",
        )}
      </p>
      {blocked && (
        <p className="notice warning">
          {t(
            "請先關閉其他對話框並等待背景工作完成，再安裝更新。",
            "Close other dialogs and wait for background work to finish before installing.",
          )}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
