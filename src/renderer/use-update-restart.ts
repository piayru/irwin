import { useEffect, useRef, useState } from "react";
import type { ShellDraft } from "../shared/contracts";
import type { UpdateStatus } from "../main/update-service";
import type { WorkspaceTab } from "./CollectionTab";
import { api, message } from "./ui";
import { setUpdateRestartLock } from "./update-restart";

type Options = {
  tabs: WorkspaceTab[];
  connected: string[];
  blocked: boolean;
  showUpdates: boolean;
  status?: UpdateStatus;
  shellDirty: Record<string, boolean>;
  shellDraftByTab: Record<string, ShellDraft>;
  preserveDrafts(drafts: ShellDraft[]): void;
  closeTabs(): void;
  notify(text: string, error?: boolean): void;
  t(zh: string, en: string): string;
};

/** Owns restart consent and the renderer side of the native restart handshake. */
export function useUpdateRestart(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [confirm, setConfirm] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [installAfterTabClose, setInstallAfterTabClose] = useState(false);
  const preparingRef = useRef(false),
    confirmed = useRef(false);
  const ready = useRef(false);
  ready.current =
    options.showUpdates &&
    !confirm &&
    !options.blocked &&
    options.tabs.length === 0 &&
    (options.connected.length === 0 || confirmed.current);
  const requestInstall = () =>
    void api
      .request("updates.install", {})
      .catch((error) => latest.current.notify(message(error), true));
  const install = () => {
    const { status, tabs, connected } = latest.current;
    if (status?.state === "downloaded" && (tabs.length || connected.length)) {
      setError("");
      setConfirm(true);
    } else requestInstall();
  };
  const closeTabsAndInstall = async () => {
    if (preparingRef.current) return;
    const blocked = () =>
      latest.current.blocked ||
      [...document.querySelectorAll("dialog[open]")].some(
        (dialog) =>
          !dialog.classList.contains("update-modal") &&
          !dialog.classList.contains("update-restart-modal"),
      );
    const blockedMessage = () =>
      latest.current.t(
        "請先儲存並關閉其他對話框，等待背景工作完成後再安裝。",
        "Save and close other dialogs and wait for background work to finish before installing.",
      );
    if (blocked()) {
      setError(blockedMessage());
      return;
    }
    preparingRef.current = true;
    setPreparing(true);
    setError("");
    try {
      const { tabs, shellDirty, shellDraftByTab, t } = latest.current;
      const drafts: ShellDraft[] = [];
      for (const tab of tabs) {
        if (tab.kind !== "shell" || !shellDirty[tab.id]) continue;
        const draft = shellDraftByTab[tab.id];
        if (!draft)
          throw new Error(
            t(
              "Shell 草稿尚未就緒，請返回工作區儲存後重試。",
              "The Shell draft is not ready. Return to the workspace, save it and retry.",
            ),
          );
        await api.request("shellDrafts.save", draft);
        drafts.push(draft);
      }
      if (blocked()) throw new Error(blockedMessage());
      latest.current.preserveDrafts(drafts);
      confirmed.current = true;
      latest.current.closeTabs();
      setConfirm(false);
      setInstallAfterTabClose(true);
    } catch (error) {
      setError(message(error));
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  };
  // Installation must observe the committed tab/dialog removal, including
  // CollectionTab cleanup that closes native cursors and Shell sessions.
  useEffect(() => {
    if (!installAfterTabClose || options.tabs.length || confirm) return;
    setInstallAfterTabClose(false);
    requestInstall();
  }, [installAfterTabClose, options.tabs.length, confirm]);
  const receiveStatus = (status: UpdateStatus) => {
    if (status.state !== "installing") {
      confirmed.current = false;
      setUpdateRestartLock(false);
    }
  };
  const restartReady = (id: string) => {
    const dialogs = [...document.querySelectorAll("dialog[open]")];
    const accepted =
      ready.current &&
      dialogs.every((dialog) => dialog.classList.contains("update-modal"));
    if (accepted) setUpdateRestartLock(true);
    void api
      .request("updates.restartReady", { id, ready: accepted })
      .catch(() => setUpdateRestartLock(false));
  };
  return {
    confirm,
    preparing,
    error,
    install,
    closeTabsAndInstall,
    receiveStatus,
    restartReady,
    cancel: () => {
      if (!preparingRef.current) setConfirm(false);
    },
  };
}
