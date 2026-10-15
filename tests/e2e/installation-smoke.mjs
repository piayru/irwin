import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
const executable = process.env.WORKBENCH_EXECUTABLE,
  userData = process.env.WORKBENCH_USER_DATA;
if (!executable || !userData)
  throw new Error("Use the isolated installation acceptance runner");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: executable,
  args: ["--disable-gpu"],
  env,
});
try {
  const page = await app.firstWindow();
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  const status = await page.evaluate(() =>
    window.workbench.request("app.status", {}),
  );
  if (process.env.IRWIN_EXPECTED_VERSION)
    assert.equal(status.version, process.env.IRWIN_EXPECTED_VERSION);
  assert.equal(status.toolsAvailable, true);
  if (process.env.IRWIN_INSTALLATION_PHASE === "upgrade") {
    const settings = await page.evaluate(() =>
      window.workbench.request("settings.get", {}),
    );
    assert.equal(settings.language, "en");
    const saved = await page.evaluate(() =>
      window.workbench.request("savedQueries.list", {}),
    );
    assert.equal(saved[0].name, "Installation preservation marker");
  } else
    await page.evaluate(async () => {
      const settings = await window.workbench.request("settings.get", {});
      await window.workbench.request("settings.set", {
        ...settings,
        language: "en",
        autoCheckUpdates: false,
      });
      await window.workbench.request("savedQueries.save", {
        id: "installation-marker",
        name: "Installation preservation marker",
        query: {
          mode: "find",
          filter: "{}",
          sort: "{}",
          projection: "{}",
          code: "",
          batchSize: 100,
        },
      });
    });
  console.log(
    `PASS installed application ${process.env.IRWIN_INSTALLATION_PHASE}: launch, tools and persisted settings`,
  );
} finally {
  await app.close();
}
