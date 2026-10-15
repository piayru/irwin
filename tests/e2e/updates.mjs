// Browser component regression only: never invokes an installer or claims native
// update acceptance. Set CHROMIUM_PATH to use a locally installed Chromium.
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

await mkdir(".runtime/updates-ui", { recursive: true });
const bundle = await build({
  stdin: {
    contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { UpdateDialog } from './src/renderer/UpdateDialog';
    import { setUpdateRestartLock } from './src/renderer/update-restart';
    const root = createRoot(document.getElementById('root'));
    window.actions = [];
    window.setStatus = (status) => root.render(<UpdateDialog currentVersion="0.1.1" platform="win32"
      status={{currentVersion:'0.1.1',availableVersion:'0.2.0',delivery:'automatic', ...status}}
      onCheck={() => window.actions.push('check')}
      onInstall={() => window.actions.push('install')}
      onOpenRelease={() => window.actions.push('external')}
      onClose={() => window.actions.push('close')} />);
    window.lockRestart = setUpdateRestartLock;
    window.shortcutCount = 0;
    window.addEventListener('keydown', () => window.shortcutCount++);
    window.setStatus({state:'available',releaseNotes:'Fixes and improvements'});
  `,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 760 },
  });
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({
    content: await readFile("src/renderer/styles.css", "utf8"),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const dialog = page.locator("dialog.update-modal");
  await dialog.getByRole("button", { name: "放大視窗", exact: true }).click();
  assert.ok((await dialog.boundingBox()).width > 1000);
  await dialog.getByRole("button", { name: "還原視窗", exact: true }).click();
  assert.equal(
    await dialog.evaluate((el) => getComputedStyle(el).resize),
    "both",
  );
  const initialBounds = await dialog.boundingBox();
  await page.mouse.move(
    initialBounds.x + initialBounds.width - 3,
    initialBounds.y + initialBounds.height - 3,
  );
  await page.mouse.down();
  await page.mouse.move(
    initialBounds.x + initialBounds.width + 70,
    initialBounds.y + initialBounds.height + 15,
    { steps: 10 },
  );
  await page.mouse.up();
  assert.ok(
    (await dialog.boundingBox()).width > initialBounds.width + 40,
    "Dragging the resize grip must enlarge the dialog",
  );
  await page.evaluate(() =>
    window.setStatus({
      state: "available",
      releaseNotes:
        '<h2>HTML release</h2><p>Readable <strong>improvement</strong></p>\n\n## Markdown heading\n\n- Fixed update\n\n<script>window.compromised=true</script><img src="https://example.invalid/tracker" onerror="window.compromised=true"><iframe src="https://example.invalid"></iframe><a href="javascript:window.compromised=true">Bad link</a><style>body{display:none}</style>',
    }),
  );
  await dialog
    .locator(".release-notes-content h2")
    .filter({ hasText: "HTML release" })
    .waitFor();
  assert.ok(
    await dialog
      .locator("strong")
      .filter({ hasText: "improvement" })
      .isVisible(),
  );
  assert.ok(
    await dialog
      .locator(".release-notes-content h2")
      .filter({ hasText: "Markdown heading" })
      .isVisible(),
  );
  assert.ok(
    await dialog.locator("li").filter({ hasText: "Fixed update" }).isVisible(),
  );
  assert.equal(
    await dialog
      .locator(
        '.release-notes-content script, .release-notes-content img, .release-notes-content iframe, .release-notes-content style, .release-notes-content [onclick], .release-notes-content [href^="javascript:"]',
      )
      .count(),
    0,
  );
  assert.equal(await page.evaluate(() => Boolean(window.compromised)), false);
  await page
    .getByRole("button", { name: "確認下載並更新", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.actions), ["install"]);
  assert.equal(
    await page.getByRole("button", { name: "開啟 GitHub Releases" }).count(),
    1,
  );
  await page.screenshot({ path: ".runtime/updates-ui/available.png" });
  await page.evaluate(() =>
    window.setStatus({ state: "downloading", progress: 42 }),
  );
  await page.getByRole("progressbar").waitFor();
  assert.equal(
    await page.getByRole("progressbar").getAttribute("aria-valuenow"),
    "42",
  );
  assert.equal(
    await page.getByRole("button", { name: "檢查更新" }).isDisabled(),
    true,
  );
  for (const [downloadPhase, text] of [
    ["recovering", "正在重試下載更新檔…"],
    ["verifying", "正在驗證更新檔…"],
  ]) {
    await page.evaluate((downloadPhase) =>
      window.setStatus({ state: "downloading", downloadPhase }), downloadPhase);
    await dialog.getByText(text, { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("progressbar").getAttribute("aria-valuenow"), null);
    assert.equal(await dialog.getByRole("button", { name: "重新啟動並安裝" }).count(), 0);
    await page.screenshot({ path: `.runtime/updates-ui/${downloadPhase}.png` });
  }
  await page.evaluate(() =>
    window.setStatus({ state: "downloaded", restartDeferred: true }),
  );
  await page.getByRole("button", { name: "重新啟動並安裝" }).waitFor();
  await page.screenshot({ path: ".runtime/updates-ui/deferred.png" });
  await page.evaluate(() => {
    window.setStatus({ state: "installing" });
    window.lockRestart(true);
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+p");
  assert.equal(await page.evaluate(() => window.shortcutCount), 0);
  assert.deepEqual(await page.evaluate(() => window.actions), ["install"]);
  assert.equal(await page.evaluate(() => document.body.inert), true);
  await page.evaluate(() => {
    window.setStatus({ state: "error" });
    window.lockRestart(false);
  });
  await page.getByRole("button", { name: "重試更新並重新啟動" }).click();
  assert.deepEqual(await page.evaluate(() => window.actions), [
    "install",
    "install",
  ]);
  console.log(
    "Update UI: action, progress, deferment, restart lock, and failure unlock passed",
  );
} finally {
  await browser.close();
}
