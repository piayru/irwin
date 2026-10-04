export type UpdateStatus = {
  state:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "no-release"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  delivery?: "automatic" | "manual";
  progress?: number;
  restartDeferred?: boolean;
  checkedAt?: string;
  message?: string;
};

type Release = {
  tag_name: string;
  name?: string | null;
  body?: string | null;
};

export interface UpdateAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  platform: NodeJS.Platform;
  packaged: boolean;
  macAutoUpdates?: boolean;
  linuxPackageType?: string;
  beforeInstall?(): Promise<boolean>;
  fetcher?: typeof fetch;
  updater?: UpdateAdapter;
  onStatus(status: UpdateStatus): void;
}

const releaseUrl = "https://api.github.com/repos/piayru/irwin/releases/latest";
const releasePage = "https://github.com/piayru/irwin/releases/latest";

function versionParts(value: string) {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (!match) return undefined;
  const prerelease = match[4]?.split(".");
  if (
    prerelease?.some(
      (part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0",
    )
  )
    return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
    prerelease,
  };
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error("Invalid semantic version");
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }
  if (!a.prerelease?.length) return b.prerelease?.length ? 1 : 0;
  if (!b.prerelease?.length) return -1;
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < count; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function readRelease(value: unknown): Release {
  if (!value || typeof value !== "object")
    throw new Error("Invalid release response");
  const release = value as Partial<Release>;
  if (typeof release.tag_name !== "string" || !versionParts(release.tag_name))
    throw new Error("Invalid release version");
  return {
    tag_name: release.tag_name,
    name: typeof release.name === "string" ? release.name.slice(0, 200) : "",
    body: typeof release.body === "string" ? release.body.slice(0, 12000) : "",
  };
}

const errorMessage =
  "Could not check for updates. Check your internet connection or open GitHub Releases.";

export function shouldAutoCheckForUpdates(enabled: boolean, online: boolean) {
  return enabled && online;
}

export class UpdateService {
  private value: UpdateStatus;
  private pendingCheck?: Promise<UpdateStatus>;
  private pendingInstall?: Promise<void>;
  private readonly updater?: UpdateAdapter;
  private readonly fetcher: typeof fetch;
  private readonly onStatus: (status: UpdateStatus) => void;

  constructor(private readonly options: UpdateServiceOptions) {
    this.value = { state: "idle", currentVersion: options.currentVersion };
    this.updater =
      options.packaged &&
      (options.platform === "win32" ||
        (options.platform === "linux" && options.linuxPackageType === "deb") ||
        (options.platform === "darwin" && options.macAutoUpdates === true))
        ? options.updater
        : undefined;
    this.fetcher = options.fetcher ?? fetch;
    this.onStatus = options.onStatus;
    if (this.updater) {
      // Discovery never downloads or quits. Only the explicit Update action does.
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = false;
      this.updater.allowPrerelease = false;
      this.listenForUpdaterEvents();
    }
  }

  get status(): UpdateStatus {
    return { ...this.value };
  }

  check(options: { silent?: boolean } = {}): Promise<UpdateStatus> {
    if (this.pendingCheck) return this.pendingCheck;
    // Opening the dialog again must not destroy an in-flight or cached update.
    if (
      this.pendingInstall ||
      ["downloading", "downloaded", "installing"].includes(this.value.state)
    )
      return Promise.resolve(this.status);
    this.pendingCheck = this.checkRelease(options.silent === true).finally(
      () => {
        this.pendingCheck = undefined;
      },
    );
    return this.pendingCheck;
  }

  install(): Promise<void> {
    if (this.pendingInstall) return this.pendingInstall;
    if (this.value.state === "installing") return Promise.resolve();
    this.pendingInstall = this.downloadAndInstall().finally(() => {
      this.pendingInstall = undefined;
    });
    return this.pendingInstall;
  }

  private async downloadAndInstall(): Promise<void> {
    if (!this.updater || !this.value.availableVersion)
      throw new Error("No in-app update is available");
    try {
      if (this.pendingCheck) await this.pendingCheck;
      if (this.value.state !== "downloaded") {
        // Recheck the native feed on retry. Never download a renderer-supplied URL.
        await this.updater.checkForUpdates();
        if (this.value.state !== "available")
          throw new Error("The update feed is not ready");
        this.set({
          ...this.value,
          state: "downloading",
          progress: 0,
          message: undefined,
          restartDeferred: false,
        });
        await this.updater.downloadUpdate();
        if (this.status.state !== "downloaded")
          throw new Error("The update download did not complete");
      }
      // Work may have started during the download. Fail closed and keep the
      // verified installer cached until the user explicitly tries again.
      if (this.options.beforeInstall && !(await this.options.beforeInstall())) {
        this.set({ ...this.value, state: "downloaded", restartDeferred: true });
        return;
      }
      this.set({ ...this.value, state: "installing", restartDeferred: false });
      this.updater.quitAndInstall(true, true);
    } catch {
      this.updateError();
    }
  }

  static readonly releasePage = releasePage;

  private async checkRelease(silent: boolean): Promise<UpdateStatus> {
    if (!silent)
      this.set({
        state: "checking",
        currentVersion: this.options.currentVersion,
      });
    let discovered = false;
    try {
      const response = await this.fetcher(releaseUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 404) {
        return this.set({
          state: "no-release",
          currentVersion: this.options.currentVersion,
          checkedAt: new Date().toISOString(),
        });
      }
      if (!response.ok) throw new Error("Release check failed");
      const release = readRelease(await response.json());
      const latestVersion = release.tag_name.replace(/^v/, "");
      if (compareVersions(latestVersion, this.options.currentVersion) <= 0) {
        return this.set({
          state: "current",
          currentVersion: this.options.currentVersion,
          checkedAt: new Date().toISOString(),
        });
      }
      discovered = true;
      this.set({
        state: "available",
        currentVersion: this.options.currentVersion,
        availableVersion: latestVersion,
        releaseName: release.name || `Irwin ${latestVersion}`,
        releaseNotes: release.body || "",
        delivery: this.updater ? "automatic" : "manual",
        checkedAt: new Date().toISOString(),
      });
      // Check the metadata now so a missing/broken feed is actionable, even on
      // startup. autoDownload remains false until the user presses Update.
      if (this.updater) await this.updater.checkForUpdates();
      return this.status;
    } catch {
      if (discovered) return this.updateError();
      if (silent) return this.status;
      return this.set({
        state: "error",
        currentVersion: this.options.currentVersion,
        checkedAt: new Date().toISOString(),
        message: errorMessage,
      });
    }
  }

  private listenForUpdaterEvents() {
    const updater = this.updater!;
    updater.on(
      "update-available",
      (info: { version?: string; releaseNotes?: unknown }) => {
        if (
          !info.version ||
          !versionParts(info.version) ||
          compareVersions(info.version, this.options.currentVersion) <= 0 ||
          (this.value.availableVersion &&
            compareVersions(info.version, this.value.availableVersion) < 0)
        ) {
          this.updateError();
          return;
        }
        this.set({
          ...this.value,
          state: "available",
          availableVersion: info.version,
          releaseNotes:
            typeof info.releaseNotes === "string"
              ? info.releaseNotes.slice(0, 12000)
              : this.value.releaseNotes,
          delivery: "automatic",
          message: undefined,
          progress: undefined,
        });
      },
    );
    updater.on("update-not-available", () => {
      // GitHub has a newer release but its native metadata may not be uploaded
      // yet. Don't erase the known update or strand the UI in a busy state.
      this.updateError();
    });
    updater.on("download-progress", (progress: { percent?: number }) => {
      if (this.value.state !== "downloading") return;
      const percent = Number(progress?.percent);
      this.set({
        ...this.value,
        progress: Number.isFinite(percent)
          ? Math.max(0, Math.min(100, Math.round(percent)))
          : 0,
      });
    });
    updater.on(
      "update-downloaded",
      (info: { version?: string; releaseNotes?: unknown }) => {
        if (this.value.state !== "downloading") return;
        this.set({
          ...this.value,
          state: "downloaded",
          availableVersion: info.version ?? this.value.availableVersion,
          releaseNotes:
            typeof info.releaseNotes === "string"
              ? info.releaseNotes.slice(0, 12000)
              : this.value.releaseNotes,
          delivery: "automatic",
          progress: 100,
        });
      },
    );
    updater.on("error", () => this.updateError());
  }

  private updateError(): UpdateStatus {
    return this.set({
      ...this.value,
      state: "error",
      progress: undefined,
      checkedAt: new Date().toISOString(),
      message:
        "The update could not be completed. Retry the update or use GitHub Releases.",
    });
  }

  private set(value: UpdateStatus): UpdateStatus {
    this.value = value;
    this.onStatus(this.status);
    return this.status;
  }
}
