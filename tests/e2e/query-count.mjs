// Real CollectionTab, including its query inputs and result table. Only IPC is
// replaced so delayed count responses and connection failures are repeatable.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

await mkdir(".runtime/query-count", { recursive: true });
const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { ignored: ["**/.runtime/**"] },
  },
  plugins: [
    {
      name: "query-count-fixture",
      configureServer(server) {
        server.middlewares.use("/__count", async (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(
            await server.transformIndexHtml(
              "/__count",
              `<!doctype html><html><head><style>#root{height:100vh;display:flex;overflow:hidden}</style></head><body><div id="root"></div><script type="module">
          import React from '/node_modules/.vite/deps/react.js';
          import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
          import CollectionTab from '/src/renderer/CollectionTab.tsx';
          import {UiContext} from '/src/renderer/ui.tsx';
          import {settingsSchema, profileSchema} from '/src/shared/contracts.ts';
          import '/src/renderer/styles.css';
          const language = new URL(location.href).searchParams.get('language') || 'en';
          const settings = settingsSchema.parse({language,autoRunOnOpen:false});
          const context = {...settings,settings,t:(zh,en)=>language==='zh'?zh:en};
          const profile = profileSchema.parse({id:'qa',name:'QA',uri:'mongodb://127.0.0.1',database:'qa'});
          window.unmount = () => root.unmount();
          const root = ReactDOM.createRoot(document.getElementById('root'));
          root.render(React.createElement(UiContext.Provider,{value:context},React.createElement(CollectionTab,{
            tab:{id:'qa-tab',connectionId:'qa',connectionName:'QA',database:'qa',collection:'documents',kind:'collection'},
            active:true,profile,transfer:()=>{},notify:(text)=>window.notices.push(text)
          })));
        </script></body></html>`,
            ),
          );
        });
      },
    },
  ],
});
await server.listen();
let browserServer;
try {
  browserServer = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  for (const language of ["en", "zh"]) {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.counts = [];
      window.notices = [];
      window.reads = [];
      window.queryResult = { rows: [], hasMore: false };
      window.workbench = {
        subscribe() {
          return () => {};
        },
        async request(command, payload) {
          if (command === "queries.count")
            return new Promise((resolve, reject) =>
              window.counts.push({ payload, resolve, reject }),
            );
          if (command === "queries.run") {
            window.reads.push(payload);
            return { ...window.queryResult, cursorId: payload.cursorId };
          }
          return undefined;
        },
      };
    });
    await page.goto(
      `${server.resolvedUrls.local[0]}__count?language=${language}`,
      { waitUntil: "domcontentloaded", timeout: 120000 },
    );
    await expect(page.getByLabel("FILTER", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    assert.deepEqual(errors, []);
    const status = page.getByRole("group", {
      name: language === "en" ? "Query result status" : "查詢結果狀態",
    });
    await expect(status).toBeVisible();
    const count = status.getByRole("button", {
      name: language === "en" ? "Count documents" : "計算筆數",
      exact: true,
    });
    await expect(count).toBeVisible();
    assert.equal(await page.evaluate(() => window.counts.length), 0);
    await count.click();
    await expect(count).toBeDisabled();
    await page.getByLabel("FILTER", { exact: true }).fill("{ active: true }");
    await expect(count).toBeEnabled();
    await count.click();
    await page.evaluate(() => window.counts[0].resolve(999));
    await expect(status).not.toContainText("999");
    await expect(count).toBeDisabled();
    await page.evaluate(() => window.counts[1].resolve(42));
    await expect(status).toContainText("42");
    const requests = await page.evaluate(() =>
      window.counts.map(({ payload }) => payload),
    );
    assert.deepEqual(
      requests.map((q) => q.filter),
      ["{}", "{ active: true }"],
    );
    assert.equal(requests[1].maxTimeMS, 30000);
    assert.equal(await page.evaluate(() => window.reads.length), 0);
    await page.getByLabel("FILTER", { exact: true }).fill("{ active: false }");
    await count.click();
    await page.evaluate(() =>
      window.counts[2].reject(new Error("QA count timeout")),
    );
    await expect(status.getByRole("alert")).toContainText("QA count timeout");
    await expect(count).toBeEnabled();
    await count.click();
    await page.getByLabel("FILTER", { exact: true }).fill("{}");
    await page.evaluate(() =>
      window.counts[3].reject(new Error("stale failure")),
    );
    await expect(status.getByRole("alert")).toHaveCount(0);
    await count.click();
    await page.evaluate(() => window.counts[4].resolve(0));
    await expect(status).toContainText(
      language === "en" ? "Matching 0" : "符合 0",
    );
    await page
      .getByRole("button", {
        name: language === "en" ? "Focus results" : "專注結果",
        exact: true,
      })
      .click();
    await expect(status).toBeVisible();
    const batchLabelLines = await page
      .locator(".footer-batch > span")
      .evaluate((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        return range.getClientRects().length;
      });
    assert.equal(batchLabelLines, 1, "Rows per batch must remain on one line");
    await page.screenshot({ path: `.runtime/query-count/${language}.png` });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    // Counts are snapshots: Last page must refresh after additions or deletions.
    await page.evaluate(() => {
      window.queryResult = {
        rows: [{ ejson: '{"_id":"last-page-qa"}', editable: false }],
        hasMore: true,
      };
    });
    await page.keyboard.press("F5");
    await expect(page.locator(".grid-row").first()).toBeVisible();
    await count.click();
    await page.evaluate(() => window.counts[5].resolve(200));
    await expect(status).toContainText(
      language === "en" ? "Matching 200" : "符合 200",
    );
    const last = page.getByRole("button", {
      name: language === "en" ? "Last page" : "最後一頁",
      exact: true,
    });
    await last.click();
    await expect.poll(() => page.evaluate(() => window.counts.length)).toBe(7);
    await page.evaluate(() => window.counts[6].resolve(201));
    await expect
      .poll(() => page.evaluate(() => window.reads.at(-1).skip))
      .toBe(200);
    await expect(status).toContainText(
      language === "en" ? "Matching 201" : "符合 201",
    );
    await last.click();
    await expect.poll(() => page.evaluate(() => window.counts.length)).toBe(8);
    await page.evaluate(() => window.counts[7].resolve(99));
    await expect
      .poll(() => page.evaluate(() => window.reads.at(-1).skip))
      .toBe(0);
    await expect(status).toContainText(
      language === "en" ? "Matching 99" : "符合 99",
    );
    const readsBeforeStaleCount = await page.evaluate(
      () => window.reads.length,
    );
    await last.click();
    await expect(last).toBeDisabled();
    await page
      .getByRole("button", {
        name: language === "en" ? "Show query" : "返回查詢",
        exact: true,
      })
      .click();
    await page.getByLabel("FILTER", { exact: true }).fill("{ changed: true }");
    await page.evaluate(() => window.counts[8].resolve(12345));
    await expect(count).toBeEnabled();
    await expect(status).not.toContainText("12345");
    assert.equal(
      await page.evaluate(() => window.reads.length),
      readsBeforeStaleCount,
    );
    await last.click();
    await expect.poll(() => page.evaluate(() => window.counts.length)).toBe(10);
    await page.evaluate(() =>
      window.counts[9].reject(new Error("Last page count failed")),
    );
    await expect(status.getByRole("alert")).toContainText(
      "Last page count failed",
    );
    assert.equal(
      await page.evaluate(() => window.reads.length),
      readsBeforeStaleCount,
    );
    await count.click();
    await page.evaluate(() => {
      window.unmount();
      window.counts.at(-1).resolve(17);
    });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS count visibility, manual execution, stale completion/error, zero, retry, last page after additions/deletions, focus, narrow layout and languages",
  );
} finally {
  await browserServer?.kill();
  server.httpServer?.closeAllConnections();
  await server.close();
}
