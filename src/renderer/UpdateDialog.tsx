import { useUi } from "./ui";
import { Modal } from "./ui";
import type { UpdateStatus } from "../main/update-service";

export function UpdateDialog({
  currentVersion,
  platform,
  status,
  onCheck,
  onInstall,
  onOpenRelease,
  onClose,
}: {
  currentVersion: string;
  platform: string;
  status?: UpdateStatus;
  onCheck(): void;
  onInstall(): void;
  onOpenRelease(): void;
  onClose(): void;
}) {
  const { t } = useUi();
  const state = status?.state ?? "idle";
  const busy =
    state === "checking" || state === "downloading" || state === "installing";
  const message = (() => {
    switch (state) {
      case "checking":
        return t("正在檢查 GitHub Releases…", "Checking GitHub Releases…");
      case "current":
        return t("目前已是最新版本。", "You’re using the latest version.");
      case "available":
        return t(
          `Irwin ${status?.availableVersion ?? ""} 已可更新。`,
          `Irwin ${status?.availableVersion ?? ""} is available.`,
        );
      case "downloading":
        return t("正在下載更新…", "Downloading the update…");
      case "installing":
        return t("正在安裝更新並重新啟動…", "Installing and restarting…");
      case "downloaded":
        if (status?.restartDeferred)
          return t(
            "更新已下載。請先儲存並關閉工作分頁、其他對話框，等待背景任務完成，再按重新啟動並安裝。",
            "Update downloaded. Save and close workspace tabs and other dialogs, then wait for background work to finish before restarting.",
          );
        return t(
          "更新已下載，重新啟動即可安裝。",
          "The update is ready to install.",
        );
      case "no-release":
        return t(
          "目前尚無公開的 GitHub Release。",
          "No public GitHub release is available yet.",
        );
      case "error":
        return t(
          "無法完成更新。請確認網路連線後重試；若持續失敗，可從 GitHub Releases 手動下載。",
          "The update could not be completed. Check your connection and retry, or download it from GitHub Releases.",
        );
      default:
        return t(
          "檢查 GitHub 上是否有較新的版本。",
          "Check GitHub for a newer version.",
        );
    }
  })();
  const canInstall =
    status?.delivery === "automatic" &&
    Boolean(status.availableVersion) &&
    (state === "available" || state === "error" || state === "downloaded");
  const canOpenRelease =
    state === "error" ||
    (status?.delivery === "manual" && state === "available");
  const releaseNotes = status?.releaseNotes?.trim();

  return (
    <Modal
      title={t("軟體更新", "Software updates")}
      close={onClose}
      className="update-modal"
      footer={
        <>
          <span className="muted">
            {t("目前版本", "Installed")}: {currentVersion}
          </span>
          <button onClick={onClose}>{t("關閉", "Close")}</button>
          {canOpenRelease && (
            <button onClick={onOpenRelease}>
              {t("開啟 GitHub Releases", "Open GitHub Releases")}
            </button>
          )}
          {canInstall ? (
            <button className="primary" onClick={onInstall}>
              {state === "downloaded"
                ? t("重新啟動並安裝", "Restart and install")
                : state === "error"
                  ? t("重試更新並重新啟動", "Retry update and restart")
                  : t("更新並重新啟動", "Update and restart")}
            </button>
          ) : (
            <button disabled={busy} onClick={onCheck}>
              {t("檢查更新", "Check for updates")}
            </button>
          )}
        </>
      }
    >
      <section className="update-content" aria-live="polite">
        <div className={`update-state update-state-${state}`}>
          {busy && <span className="update-spinner" aria-hidden="true" />}
          <strong>{message}</strong>
        </div>
        {state === "downloading" && (
          <div
            className="update-progress"
            role="progressbar"
            aria-label={t("更新下載進度", "Update download progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status?.progress ?? 0}
          >
            <span style={{ width: `${status?.progress ?? 0}%` }} />
            <small>{status?.progress ?? 0}%</small>
          </div>
        )}
        {status?.delivery === "automatic" && state === "available" && (
          <p className="muted">
            {t(
              "按「更新並重新啟動」會自動下載、安裝並重新啟動。請先儲存並關閉工作分頁；若仍有工作進行中，更新會暫緩重新啟動。",
              "Update and restart downloads and installs the update, then restarts Irwin. Save and close workspace tabs first; restart is deferred while work is open or running.",
            )}
          </p>
        )}
        {status?.delivery === "manual" && state === "available" && (
          <p className="muted">
            {platform === "darwin"
              ? t(
                  "此 macOS 版本尚未啟用經驗證的更新簽章，無法進行應用程式內自動安裝。請從 GitHub Releases 下載啟用自動更新的 DMG，並將 Irwin 拖移至 Applications 覆蓋安裝。",
                  "This macOS build is not enabled for verified in-app updates. Install an updater-enabled DMG from GitHub Releases into Applications to bootstrap future updates.",
                )
              : t(
                  "請從 GitHub Releases 下載新版安裝檔並手動安裝。",
                  "Download the new installer from GitHub Releases and install it manually.",
                )}
          </p>
        )}
        {platform === "linux" && status?.delivery === "automatic" && (
          <p className="muted">
            {t(
              "安裝 .deb 更新時，系統可能會要求你輸入密碼授權。",
              "Your system may ask for your password to install the .deb update.",
            )}
          </p>
        )}
        {(state === "available" || state === "downloaded") &&
          status?.releaseName && (
            <h3 className="update-release-title">{status.releaseName}</h3>
          )}
        {(state === "available" || state === "downloaded") && releaseNotes && (
          <div className="update-notes">
            <h3>{t("版本說明", "Release notes")}</h3>
            <pre>{releaseNotes}</pre>
          </div>
        )}
      </section>
    </Modal>
  );
}
