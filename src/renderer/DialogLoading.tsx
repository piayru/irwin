import { Modal, useUi } from "./ui";

/** A cancellable modal fallback keeps the workspace layout and focus stable. */
export function DialogLoading({ close }: { close(): void }) {
  const { t } = useUi();
  return (
    <Modal
      title={t("正在載入…", "Loading…")}
      close={close}
      footer={<button onClick={close}>{t("取消", "Cancel")}</button>}
    >
      <p role="status">
        {t("正在載入此功能，請稍候。", "Loading this feature. Please wait.")}
      </p>
    </Modal>
  );
}
