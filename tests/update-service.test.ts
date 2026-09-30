import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  shouldAutoCheckForUpdates,
  UpdateService,
  type UpdateStatus,
} from "../src/main/update-service";

function release(tag_name: string, body = "Release notes") {
  return new Response(
    JSON.stringify({
      tag_name,
      name: `Irwin ${tag_name}`,
      body,
    }),
    { status: 200 },
  );
}

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  checkForUpdates = vi.fn(async () => {
    this.emit("update-available", { version: "0.2.0" });
    return { updateInfo: { version: "0.2.0" } };
  });
  downloadUpdate = vi.fn(async () => {
    this.emit("download-progress", { percent: 37.4 });
    this.emit("update-downloaded", { version: "0.2.0", releaseNotes: "Notes" });
  });
  quitAndInstall = vi.fn();
}

function createService(
  options: {
    currentVersion?: string;
    platform?: NodeJS.Platform;
    packaged?: boolean;
    macAutoUpdates?: boolean;
    linuxPackageType?: string;
    beforeInstall?: () => Promise<boolean>;
    fetcher?: typeof fetch;
    updater?: FakeUpdater;
    onStatus?: (status: UpdateStatus) => void;
  } = {},
) {
  return new UpdateService({
    currentVersion: options.currentVersion ?? "0.1.0",
    platform: options.platform ?? "darwin",
    packaged: options.packaged ?? true,
    fetcher:
      options.fetcher ?? ((async () => release("v0.1.0")) as typeof fetch),
    updater: options.updater,
    macAutoUpdates: options.macAutoUpdates,
    linuxPackageType: options.linuxPackageType ?? "deb",
    beforeInstall: options.beforeInstall,
    onStatus: options.onStatus ?? (() => {}),
  });
}

describe("version update checks", () => {
  it("only permits startup checks when enabled and online", () => {
    expect(shouldAutoCheckForUpdates(true, true)).toBe(true);
    expect(shouldAutoCheckForUpdates(false, true)).toBe(false);
    expect(shouldAutoCheckForUpdates(true, false)).toBe(false);
  });

  it("orders semantic prereleases before their stable release", () => {
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.10")).toBe(-1);
    expect(compareVersions("1.2.0-rc.1", "1.2.0")).toBe(-1);
  });

  it("treats the same release version as current after removing a v prefix", async () => {
    const service = createService({ fetcher: async () => release("v0.1.0") });

    const result = await service.check();
    expect(result).toMatchObject({
      state: "current",
      currentVersion: "0.1.0",
    });
    expect(result).not.toHaveProperty("availableVersion");
  });

  it("offers newer macOS releases as manual downloads when the app is unsigned", async () => {
    const service = createService({
      fetcher: async () => release("v0.2.0", "Fixes and improvements"),
    });

    await expect(service.check()).resolves.toMatchObject({
      state: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      delivery: "manual",
      releaseNotes: "Fixes and improvements",
    });
  });

  it("discovers packaged Windows updates without downloading or quitting", async () => {
    const updater = new FakeUpdater();
    const service = createService({
      platform: "win32",
      updater,
      fetcher: async () => release("0.2.0"),
    });

    await service.check();

    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.autoDownload).toBe(false);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
  });

  it("downloads and silently installs with one explicit action", async () => {
    const updater = new FakeUpdater();
    const statuses: UpdateStatus[] = [];
    const beforeInstall = vi.fn(async () => true);
    const service = createService({
      platform: "linux",
      updater,
      beforeInstall,
      fetcher: async () => release("0.2.0"),
      onStatus: (status) => statuses.push(status),
    });
    await service.check();
    await service.install();
    expect(statuses).toContainEqual(
      expect.objectContaining({ state: "downloading", progress: 37 }),
    );
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
    expect(service.status.state).toBe("installing");
    await service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("keeps a verified download when work prevents restart, then installs without redownloading", async () => {
    const updater = new FakeUpdater();
    const beforeInstall = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const service = createService({
      platform: "win32",
      updater,
      beforeInstall,
      fetcher: async () => release("0.2.0"),
    });
    await service.check();
    await service.install();
    expect(service.status).toMatchObject({
      state: "downloaded",
      restartDeferred: true,
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    const calls = updater.checkForUpdates.mock.calls.length;
    await service.check();
    expect(service.status.state).toBe("downloaded");
    expect(updater.checkForUpdates.mock.calls.length).toBe(calls);
    await service.install();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("deduplicates clicks and protects downloading state from rechecks", async () => {
    const updater = new FakeUpdater();
    let finish!: () => void;
    updater.downloadUpdate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            updater.emit("update-downloaded", { version: "0.2.0" });
            resolve();
          };
        }),
    );
    const service = createService({
      platform: "win32",
      updater,
      fetcher: async () => release("0.2.0"),
    });
    await service.check();
    const first = service.install();
    expect(service.install()).toBe(first);
    await Promise.resolve();
    expect((await service.check()).state).toBe("downloading");
    finish();
    await first;
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("shows retryable download errors and never installs unverified bytes", async () => {
    const updater = new FakeUpdater();
    updater.downloadUpdate.mockRejectedValueOnce(
      new Error("checksum mismatch"),
    );
    const service = createService({
      platform: "win32",
      updater,
      fetcher: async () => release("0.2.0"),
    });
    await service.check();
    await service.install();
    expect(service.status).toMatchObject({
      state: "error",
      availableVersion: "0.2.0",
      delivery: "automatic",
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("only enables macOS installation for explicitly signed release builds", async () => {
    for (const macAutoUpdates of [false, true]) {
      const updater = new FakeUpdater();
      const service = createService({
        platform: "darwin",
        updater,
        macAutoUpdates,
        fetcher: async () => release("0.2.0"),
      });
      await service.check();
      expect(service.status.delivery).toBe(
        macAutoUpdates ? "automatic" : "manual",
      );
      if (macAutoUpdates) {
        await service.install();
        expect(updater.quitAndInstall).toHaveBeenCalledOnce();
      } else {
        await expect(service.install()).rejects.toThrow("No in-app update");
        expect(updater.quitAndInstall).not.toHaveBeenCalled();
      }
    }
  });

  it("reports a missing first public release without trying an installer", async () => {
    const updater = new FakeUpdater();
    const service = createService({
      platform: "win32",
      updater,
      fetcher: async () => new Response("Not Found", { status: 404 }),
    });

    await expect(service.check()).resolves.toMatchObject({
      state: "no-release",
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("rejects malformed release versions and reports network failure safely", async () => {
    const malformed = createService({
      fetcher: async () => release("latest"),
    });
    await expect(malformed.check()).resolves.toMatchObject({ state: "error" });

    const unavailable = createService({
      fetcher: async () => {
        throw new Error("socket failure");
      },
    });
    await expect(unavailable.check()).resolves.toMatchObject({
      state: "error",
      message: expect.not.stringContaining("socket failure"),
    });
  });

  it("keeps silent startup failures from changing visible update state", async () => {
    const onStatus = vi.fn();
    const service = createService({
      fetcher: async () => {
        throw new Error("offline");
      },
      onStatus,
    });
    const initialStatus = service.status;

    await expect(service.check({ silent: true })).resolves.toEqual(
      initialStatus,
    );
    expect(service.status).toEqual(initialStatus);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("shows a new release found by a silent startup check without showing a spinner", async () => {
    const onStatus = vi.fn();
    const service = createService({
      fetcher: async () => release("0.2.0"),
      onStatus,
    });

    await service.check({ silent: true });

    expect(service.status).toMatchObject({
      state: "available",
      availableVersion: "0.2.0",
    });
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "available" }),
    );
  });

  it("makes a broken native feed retryable even during a silent startup check", async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates = vi.fn(async () => {
      updater.emit("checking-for-update");
      updater.emit("error");
      throw new Error("offline during installer check");
    });
    const onStatus = vi.fn();
    const service = createService({
      platform: "win32",
      updater,
      fetcher: async () => release("0.2.0"),
      onStatus,
    });

    await service.check({ silent: true });

    expect(service.status).toMatchObject({
      state: "error",
      availableVersion: "0.2.0",
    });
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "error" }),
    );
  });
});

it("does not advertise native updates for unsupported Linux installation formats", async () => {
  const updater = new FakeUpdater();
  const service = createService({
    platform: "linux",
    linuxPackageType: "AppImage",
    updater,
    fetcher: async () => release("0.2.0"),
  });
  expect((await service.check()).delivery).toBe("manual");
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
});

it("does not install a stale native feed older than the public release", async () => {
  const updater = new FakeUpdater();
  const service = createService({
    platform: "win32",
    updater,
    fetcher: async () => release("0.3.0"),
  });
  expect((await service.check()).state).toBe("error");
  await service.install();
  expect(updater.downloadUpdate).not.toHaveBeenCalled();
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
});
