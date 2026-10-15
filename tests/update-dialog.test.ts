import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi, afterAll } from "vitest";
import { UpdateDialog } from "../src/renderer/UpdateDialog";
import type { UpdateStatus } from "../src/main/update-service";
vi.hoisted(() => {
  vi.stubGlobal("window", {});
});
afterAll(() => vi.unstubAllGlobals());
function render(status: Partial<UpdateStatus>, platform = "win32") {
  return renderToStaticMarkup(
    createElement(UpdateDialog, {
      currentVersion: "0.1.1",
      platform,
      status: {
        currentVersion: "0.1.1",
        state: "available",
        availableVersion: "0.2.0",
        delivery: "automatic",
        ...status,
      },
      onCheck() {},
      onInstall() {},
      onOpenRelease() {},
      onClose() {},
    }),
  );
}
it("shows release notes with a separate, explicit download confirmation", () => {
  const html = render({ releaseNotes: "Fixes and improvements" });
  expect(html).toContain('class="primary">確認下載並更新</button>');
  expect(html).toContain('aria-label="版本說明"');
  expect(html).toContain("Fixes and improvements");
  expect(html).toContain("靜默安裝");
  expect(html).toContain("開啟 GitHub Releases");
  expect(html).not.toContain("disabled");
});
it("explains missing notes and lets users inspect the release before downloading", () => {
  const html = render({});
  expect(html).toContain("此版本未提供版本說明");
  expect(html).toContain("開啟 GitHub Releases");
  expect(html).toContain('class="primary">確認下載並更新</button>');
});
it("keeps release notes visible while downloading and after a retryable failure", () => {
  for (const state of ["downloading", "error"] as const) {
    const html = render({ state, releaseNotes: "Reviewed before downloading" });
    expect(html).toContain("Reviewed before downloading");
  }
});
it("offers retry in the app after failure, with a secondary manual escape hatch", () => {
  const html = render({ state: "error" });
  expect(html).toContain('class="primary">重試更新並重新啟動</button>');
  expect(html).toContain("開啟 GitHub Releases");
});
it("shows progress and disables rechecking while downloading", () => {
  const html = render({ state: "downloading", progress: 42 });
  expect(html).toContain('aria-valuenow="42"');
  expect(html).toContain("disabled");
  expect(html).not.toContain('class="primary"');
});
it("explains a deferred restart and preserves the install button", () => {
  const html = render({ state: "downloaded", restartDeferred: true });
  expect(html).toContain("確認關閉目前連線與分頁");
  expect(html).toContain('class="primary">重新啟動並安裝</button>');
});
it("distinguishes download recovery and verification without replaying percentages", () => {
  for (const [downloadPhase, text] of [
    ["recovering", "正在重試下載更新檔"],
    ["verifying", "正在驗證更新檔"],
  ] as const) {
    const html = render({ state: "downloading", downloadPhase });
    expect(html).toContain(text);
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("undefined%");
    expect(html).not.toContain("重新啟動並安裝</button>");
  }
});
it("keeps unsigned macOS builds manual instead of bypassing signature checks", () => {
  const html = render({ delivery: "manual" }, "darwin");
  expect(html).toContain("尚未啟用經驗證的更新簽章");
  expect(html).toContain("開啟 GitHub Releases");
  expect(html).not.toContain("更新並重新啟動</button>");
});
it("shows Linux authorization information before updating", () => {
  expect(render({}, "linux")).toContain("系統可能會要求你輸入密碼授權");
});
