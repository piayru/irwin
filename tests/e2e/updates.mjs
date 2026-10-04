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
    window.setStatus({state:'available'});
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
  await page
    .getByRole("button", { name: "更新並重新啟動", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.actions), ["install"]);
  assert.equal(
    await page.getByRole("button", { name: "開啟 GitHub Releases" }).count(),
    0,
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
