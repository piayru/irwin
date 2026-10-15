import { useUi } from "./ui";
import { Modal } from "./ui";
import type { UpdateStatus } from "../main/update-service";
import { ReleaseNotes } from "./ReleaseNotes";

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
  const downloadIndeterminate =
    state === "downloading" &&
    (status?.downloadPhase === "recovering" ||
      status?.downloadPhase === "verifying");
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
        if (status?.downloadPhase === "recovering")
          return t("正在重試下載更新檔…", "Retrying the update download…");
        if (status?.downloadPhase === "verifying")
          return t("正在驗證更新檔…", "Verifying the update file…");
        return t("正在下載更新…", "Downloading the update…");
      case "installing":
        return t("正在安裝更新並重新啟動…", "Installing and restarting…");
      case "downloaded":
        if (status?.restartDeferred)
          return t(
            "更新已下載。按「重新啟動並安裝」可確認關閉目前連線與分頁；若仍有背景工作，請等待完成。",
            "Update downloaded. Restart and install lets you confirm closing current connections and tabs. Wait for background work to finish first.",
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
  const releaseNotes = status?.releaseNotes?.trim();
  const canOpenRelease = state === "error" || Boolean(status?.availableVersion);

  return (
    <Modal
      title={t("軟體更新", "Software updates")}
      close={onClose}
      className="update-modal"
      resizable
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
                  : t("確認下載並更新", "Confirm download and update")}
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
            className={`update-progress${downloadIndeterminate ? " indeterminate" : ""}`}
            role="progressbar"
            aria-label={
              status?.downloadPhase === "verifying"
                ? t("更新驗證進度", "Update verification progress")
                : t("更新下載進度", "Update download progress")
            }
            aria-valuemin={downloadIndeterminate ? undefined : 0}
            aria-valuemax={downloadIndeterminate ? undefined : 100}
            aria-valuenow={
              downloadIndeterminate ? undefined : (status?.progress ?? 0)
            }
          >
            <span
              style={
                downloadIndeterminate
                  ? undefined
                  : { width: `${status?.progress ?? 0}%` }
              }
            />
            <small>
              {downloadIndeterminate
                ? t("請稍候…", "Please wait…")
                : `${status?.progress ?? 0}%`}
            </small>
          </div>
        )}
        {state === "installing" && (
          <div
            className="update-progress indeterminate"
            role="progressbar"
            aria-label={t("更新安裝進度", "Update installation progress")}
          >
            <span />
            <small>
              {t(
                "正在準備安裝，完成後自動重新啟動",
                "Preparing installation; Irwin will restart automatically",
              )}
            </small>
          </div>
        )}
        {status?.delivery === "automatic" && state === "available" && (
          <p className="muted">
            {t(
              "請先閱讀下方版本說明。按「確認下載並更新」才會下載更新，完成後靜默安裝並重新啟動。請先儲存並關閉工作分頁；若仍有工作進行中，更新會暫緩重新啟動。",
              "Review the release notes below. Confirm download and update downloads the update, then silently installs it and restarts Irwin. Save and close workspace tabs first; restart is deferred while work is open or running.",
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
        {status?.availableVersion && (
          <section
            className="update-notes"
            aria-label={t("版本說明", "Release notes")}
          >
            <h3 className="update-release-title">
              {status.releaseName || `Irwin ${status.availableVersion}`}
            </h3>
            <h3>{t("版本說明", "Release notes")}</h3>
            {releaseNotes ? (
              <ReleaseNotes content={releaseNotes} />
            ) : (
              <p className="muted">
                {t(
                  "此版本未提供版本說明。",
                  "No release notes were provided for this version.",
                )}
              </p>
            )}
          </section>
        )}
      </section>
    </Modal>
  );
}
