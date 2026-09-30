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
it("makes in-app update the primary action for an available automatic update", () => {
  const html = render({});
  expect(html).toContain('class="primary">更新並重新啟動</button>');
  expect(html).not.toContain("開啟 GitHub Releases");
  expect(html).not.toContain("disabled");
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
  expect(html).toContain("請先儲存並關閉工作分頁");
  expect(html).toContain('class="primary">重新啟動並安裝</button>');
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
