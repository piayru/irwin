import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { startTestMongo } from "./helpers/test-mongo.mjs";
import { MongoClient } from "mongodb";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";

const output = resolve(`.runtime/ui-ux-qa-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = await startTestMongo();
const client = await new MongoClient(server.getUri()).connect();
await client
  .db("ui_ux_qa")
  .collection("orders")
  .insertMany([
    { name: "First", score: 1 },
    { name: "Second", score: 2 },
  ]);
const failures = [],
  passed = [];
let app, page;
const active = () => page.locator(".workspace-panel.visible");
async function check(name, action) {
  try {
    await action();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error: error.stack });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
async function shot(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(resolve(output, `${name}.png`), Buffer.from(png, "base64"));
}
try {
  const env = {
    ...process.env,
    WORKBENCH_USER_DATA: resolve(output, "user-data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [".", "--disable-gpu"],
    cwd: process.env.WORKBENCH_PROJECT_DIR || process.cwd(),
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  await page.evaluate(async (uri) => {
    const settings = await window.workbench.request("settings.get", {});
    await window.workbench.request("settings.set", {
      ...settings,
      language: "zh",
      theme: "light",
      autoCheckUpdates: false,
    });
    await window.workbench.request("ai.providers.save", {
      provider: {
        id: "ui-model",
        name: "原本的模型",
        kind: "openai-compatible",
        baseUrl: "http://127.0.0.1:19876/v1",
        model: "ui-model",
      },
    });
    for (const [id, name, environment, readOnly] of [
      ["ui-qa", "介面測試", "development", false],
      ["ui-readonly", "正式環境", "production", true],
    ])
      await window.workbench.request("connections.save", {
        profile: {
          id,
          name,
          environment,
          readOnly,
          database: "ui_ux_qa",
          uri: `${uri}?directConnection=true&readPreference=secondaryPreferred`,
        },
      });
  }, server.getUri());
  await page.reload();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await check("compact safety badges", async () => {
    const badges = page.locator(".home-connection-badges .read-only-badge");
    await expect(badges).toBeVisible();
    assert.ok((await badges.boundingBox()).width < 120);
  });
  await page
    .getByRole("button", { name: "編輯 介面測試", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "進階設定", exact: true })
    .click();
  await check("connection form shows URI values", async () => {
    await expect(
      page.getByRole("checkbox", { name: "directConnection", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Read preference", { exact: true }),
    ).toHaveValue("secondaryPreferred");
    await expect(page.locator(".connection-effective-settings")).toContainText(
      "來自 URI",
    );
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "關閉", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "偏好設定", exact: true }).click();
  await page.locator('[data-preference-section="ai"]').click();
  await check("model drafts have their own cancel and save scope", async () => {
    await page
      .getByRole("button", { name: "管理模型服務", exact: true })
      .click();
    const manager = page.getByRole("dialog", {
      name: "管理模型服務",
      exact: true,
    });
    await manager
      .locator('select[name="ai-configured-provider"]')
      .selectOption("ui-model");
    await manager
      .locator('input[name="ai-provider-name"]')
      .fill("未儲存的名稱");
    await expect(manager.getByRole("status")).toContainText("尚未儲存");
    await manager.getByRole("button", { name: "取消", exact: true }).click();
    const discard = page.getByRole("dialog", {
      name: "捨棄模型變更？",
      exact: true,
    });
    await discard
      .getByRole("button", { name: "捨棄變更", exact: true })
      .click();
    const providers = await page.evaluate(() =>
      window.workbench.request("ai.providers.list", {}),
    );
    assert.equal(providers.find((p) => p.id === "ui-model").name, "原本的模型");
  });
  await check(
    "saved models survive cancelling global preferences",
    async () => {
      await page
        .getByRole("button", { name: "管理模型服務", exact: true })
        .click();
      const manager = page.getByRole("dialog", {
        name: "管理模型服務",
        exact: true,
      });
      await manager
        .locator('input[name="ai-provider-name"]')
        .fill("已儲存的模型");
      await manager
        .getByRole("button", { name: "儲存模型", exact: true })
        .click();
      await expect(manager.locator(".model-save-status")).toContainText(
        "設定已同步",
      );
      await manager.getByRole("button", { name: "取消", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      const providers = await page.evaluate(() =>
        window.workbench.request("ai.providers.list", {}),
      );
      assert.equal(
        providers.find((p) => p.id === "ui-model").name,
        "已儲存的模型",
      );
    },
  );
  await page.getByRole("button", { name: "偏好設定", exact: true }).click();
  await page.locator('[data-preference-section="ai"]').click();
  await page.getByRole("button", { name: "管理模型服務", exact: true }).click();
  await check("model manager fits a compact window at 125% zoom", async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(1100, 720);
      win.webContents.setZoomFactor(1.25);
    });
    const manager = page.getByRole("dialog", {
      name: "管理模型服務",
      exact: true,
    });
    await expect
      .poll(() =>
        manager.evaluate((el) => {
          const box = el.getBoundingClientRect(),
            footer = el.querySelector(".modal-footer").getBoundingClientRect();
          return (
            box.left >= 0 &&
            box.right <= window.innerWidth + 1 &&
            box.top >= 0 &&
            box.bottom <= window.innerHeight + 1 &&
            footer.bottom <= window.innerHeight + 1 &&
            footer.height > 0
          );
        }),
      )
      .toBe(true);
    const layout = await manager.evaluate((el) => {
      const hint = el.querySelector(".hint").getBoundingClientRect();
      const fields = el.querySelector("fieldset").getBoundingClientRect();
      const toggle = el
        .querySelector(".ai-insecure-toggle input")
        .getBoundingClientRect();
      const label = el
        .querySelector(".ai-insecure-toggle span")
        .getBoundingClientRect();
      return {
        hintBottom: hint.bottom,
        fieldsTop: fields.top,
        fieldsWidth: fields.width,
        bodyWidth: el.querySelector(".modal-body").clientWidth,
        checkboxWidth: toggle.width,
        checkboxGap: label.left - toggle.right,
      };
    });
    assert.ok(
      layout.hintBottom <= layout.fieldsTop,
      "Model form must follow its explanation",
    );
    assert.ok(
      layout.fieldsWidth > layout.bodyWidth * 0.85,
      "Model form must use the dialog width",
    );
    assert.ok(
      layout.checkboxWidth <= 24 && layout.checkboxGap <= 16,
      "Checkbox must stay beside its label",
    );
    await shot("model-manager-125");
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setZoomFactor(1);
    win.setContentSize(1440, 900);
  });
  // Close any remaining modal after a failed check before entering the workspace.
  await page.keyboard.press("Escape");
  if (await page.locator("dialog[open]").count())
    await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const profile = (
      await window.workbench.request("connections.list", {})
    ).find((p) => p.id === "ui-qa");
    await window.workbench.request("connections.save", {
      profile: {
        ...profile,
        uri: profile.uri.replace("secondaryPreferred", "primary"),
      },
    });
  });
  await page.reload();
  await page
    .locator(".home-connection")
    .filter({ hasText: "介面測試" })
    .getByRole("button", { name: "連線", exact: true })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "ui_ux_qa", exact: true })
    .click({ timeout: 120000 });
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "orders", exact: true })
    .click();
  await expect(active().locator(".grid-cell").first()).toBeVisible({
    timeout: 30000,
  });
  await check("More actions are labelled and close with Escape", async () => {
    const more = active().locator(".toolbar-more");
    await more.locator("summary").click();
    await expect(
      more.getByRole("button", { name: "儲存查詢", exact: true }),
    ).toBeVisible();
    await expect(
      more.getByRole("button", { name: "計算筆數", exact: true }),
    ).toBeVisible();
    await more.locator("summary").press("Escape");
    await expect(more).not.toHaveAttribute("open", "");
    await expect(more.locator("summary")).toBeFocused();
  });
  await check("suggestion selection is linked to the combobox", async () => {
    const filter = active().getByLabel("FILTER", { exact: true });
    await filter.fill("{$");
    await filter.press("ArrowDown");
    const id = await filter.getAttribute("aria-activedescendant");
    assert.ok(id);
    const selected = page.locator(`[id="${id}"]`);
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await filter.press("Enter");
    await expect(active().getByRole("listbox")).toHaveCount(0);
  });
  await active().getByLabel("FILTER", { exact: true }).fill("{}");
  await active().getByLabel("SORT", { exact: true }).fill("{score:-1}");
  await active().getByLabel("PROJECTION", { exact: true }).fill("{name:1}");
  await active().getByRole("button", { name: "查詢選項", exact: true }).click();
  await check(
    "collapsed query options remain visible and can be cleared",
    async () => {
      await expect(active().locator(".query-option-summary")).toContainText(
        "排序",
      );
      await active()
        .getByRole("button", { name: "清除排序", exact: true })
        .click();
      await expect(
        active().getByRole("button", { name: "清除排序", exact: true }),
      ).toHaveCount(0);
      await active()
        .getByRole("button", { name: "清除投影", exact: true })
        .click();
    },
  );
  await check(
    "AI dock allows concurrent query editing and keyboard resizing",
    async () => {
      await active()
        .getByRole("button", { name: "AI 助理", exact: true })
        .click();
      await expect(active().locator(".ai-assistant-panel")).toHaveAttribute(
        "role",
        "complementary",
      );
      const enableButton = active().getByRole("button", {
        name: "為此連線啟用",
        exact: true,
      });
      await expect(enableButton).toBeDisabled();
      await active()
        .locator(".ai-assistant-setup select")
        .selectOption("ui-model");
      await enableButton.click();
      const prompt = active().getByRole("textbox", {
        name: "描述查詢需求",
        exact: true,
      });
      await prompt.fill("保留這段未送出的提問");
      const send = active()
        .locator(".ai-assistant-panel")
        .getByRole("button", { name: "送出", exact: true });
      await expect(send).toHaveText("送出");
      await expect(send).toBeEnabled();
      assert.notEqual(
        await send.evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
      await active().getByLabel("FILTER", { exact: true }).fill("{score:1}");
      const notice = await active()
        .locator(".result-state-notice")
        .boundingBox();
      const heading = await active().locator(".grid-head").boundingBox();
      assert.ok(
        notice && heading && notice.y + notice.height <= heading.y + 1,
        "Stale results notice must not cover table headings",
      );
      const separator = active().getByRole("separator", {
        name: "調整 AI 側欄寬度",
        exact: true,
      });
      const before = await separator.getAttribute("aria-valuenow");
      await separator.focus();
      await separator.press("ArrowLeft");
      assert.notEqual(await separator.getAttribute("aria-valuenow"), before);
      await shot("wide-ai-dock");
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1100, 720),
      );
      await active()
        .getByRole("button", { name: "查詢與結果", exact: true })
        .click();
      await expect(
        active().getByLabel("FILTER", { exact: true }),
      ).toBeVisible();
      await active()
        .getByRole("button", { name: "AI 助理", exact: true })
        .first()
        .click();
      await expect(active().locator(".ai-assistant-panel")).toBeVisible();
      await expect(prompt).toHaveValue("保留這段未送出的提問");
      await shot("narrow-ai-dock");
    },
  );
  if (await page.locator(".ai-assistant-panel").count())
    await page
      .locator(".ai-assistant-panel")
      .getByRole("button", { name: "關閉", exact: true })
      .click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await expect(
    active().getByRole("button", { name: "AI 助理", exact: true }),
  ).toBeFocused();
  await active().getByRole("button", { name: "新增文件", exact: true }).click();
  await check("document context and parser error navigation", async () => {
    const dialog = page.getByRole("dialog", { name: "新增文件", exact: true });
    await expect(dialog.locator(".document-context")).toContainText(
      "ui_ux_qa.orders",
    );
    await dialog.locator(".monaco-editor").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText("{\n  broken: ,\n}");
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    const error = dialog.getByRole("alert");
    await expect(error).toContainText("文件語法無法解析");
    await error.getByRole("button", { name: /跳到第 2 行/ }).click();
    await expect
      .poll(() =>
        dialog
          .locator(".monaco-editor")
          .evaluate((el) => el.contains(document.activeElement)),
      )
      .toBe(true);
    await shot("document-error-location");
    assert.equal(
      await client.db("ui_ux_qa").collection("orders").countDocuments(),
      2,
    );
  });
} catch (error) {
  failures.push({ name: "test setup or navigation", error: error.stack });
  console.error(error.stack);
  if (page && !page.isClosed()) {
    await shot("navigation-failure").catch(() => {});
    await writeFile(
      resolve(output, "failure-screen.txt"),
      await page.locator("body").innerText(),
    ).catch(() => {});
  }
} finally {
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify({ passed, failures }, null, 2),
  );
  if (app) {
    await closeElectronWindowNormally(app).catch(() => app.process().kill());
  }
  await client.close();
  await server.stop();
}
if (failures.length)
  throw new Error(`${failures.length} UI/UX checks failed; see ${output}`);
console.log(`PASS ${passed.length} UI/UX checks; artifacts: ${output}`);
