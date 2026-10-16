import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { ignored: ["**/.runtime/**"] },
  },
  plugins: [
    {
      name: "shell-outcome-fixture",
      configureServer(server) {
        server.middlewares.use("/__shell", async (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(
            await server.transformIndexHtml(
              "/__shell",
              `<!doctype html><html><body><div id="root" style="height:100vh;display:flex"></div><script type="module">
          import React from '/node_modules/.vite/deps/react.js';
          import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
          import CollectionTab from '/src/renderer/CollectionTab.tsx';
          import {UiContext} from '/src/renderer/ui.tsx';
          import {settingsSchema,profileSchema} from '/src/shared/contracts.ts';
          import '/src/renderer/styles.css';
          const settings=settingsSchema.parse({language:'en',autoRunOnOpen:false});
          const profile=profileSchema.parse({id:'qa',name:'QA',database:'original_db',uri:'mongodb://127.0.0.1',readOnly:false});
          ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(UiContext.Provider,{value:{...settings,settings,t:(zh,en)=>en}},React.createElement(CollectionTab,{
            tab:{id:'shell-qa',kind:'collection',connectionId:'qa',connectionName:'QA',database:'original_db',collection:'probe',state:{freeMode:true}},
            active:true,profile,transfer:()=>{},notify:(text,error)=>window.notices.push({text,error})
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
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  });
  const errors = [];
  // Monaco emits these optional-service diagnostics in the component harness;
  // the native desktop scenario tracks the same upstream diagnostics separately.
  page.on("pageerror", (error) => {
    if (
      !/UNKNOWN service (ICodeLensCache|treeViewsDndService)/.test(
        error.message,
      )
    )
      errors.push(error.message);
  });
  await page.addInitScript(() => {
    window.executions = [];
    window.historyWrites = [];
    window.savedQueries = [];
    window.notices = [];
    window.failHistory = false;
    window.failExecution = false;
    window.errorDatabase = undefined;
    window.holdExecution = false;
    window.response = {
      kind: "value",
      value: '{"$numberInt":"3"}',
      rows: [],
      output: ['{"$numberInt":"3"}'],
      hasMore: false,
      database: "original_db",
    };
    window.workbench = {
      subscribe(listener) {
        window.listener = listener;
        return () => {};
      },
      async request(command, payload) {
        if (command === "shellSessions.execute") {
          window.executions.push(payload);
          if (window.holdExecution)
            return new Promise((_resolve, reject) => {
              window.rejectExecution = reject;
            });
          if (window.failExecution) {
            if (window.errorDatabase)
              window.listener({
                type: "shell",
                data: {
                  sessionId: payload.sessionId,
                  database: window.errorDatabase,
                },
              });
            throw new Error("QA script failed after switching");
          }
          return window.response;
        }
        if (command === "shellSessions.cancel")
          return new Promise((resolve) => {
            window.finishCancel = () => {
              window.rejectExecution(new Error("cancelled"));
              resolve({ reset: true });
            };
          });
        if (command === "history.save") {
          window.historyWrites.push(payload);
          if (window.failHistory) throw new Error("QA history unavailable");
        }
        if (command === "savedQueries.save") {
          window.savedQueries.push(payload);
          return payload;
        }
        if (command === "savedQueries.list") return [];
        if (command === "queries.run") {
          window.executions.push(payload);
          return {
            rows: [{ ejson: '{"_id":"one"}', editable: false }],
            hasMore: false,
            cursorId: payload.cursorId,
          };
        }
        return undefined;
      },
    };
  });
  await page.goto(server.resolvedUrls.local[0] + "__shell", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await expect(page.locator(".shell-editor .monaco-editor")).toBeVisible({
    timeout: 60000,
  });
  const run = async () => {
    const before = await page.evaluate(() => window.executions.length);
    await page.keyboard.press("F5");
    await expect
      .poll(() => page.evaluate(() => window.executions.length))
      .toBe(before + 1);
    await expect(page.locator(".results-wrapper")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  };
  await run();
  await expect(page.locator(".shell-command-result")).toContainText("3");
  await expect(
    page.getByText("No matching documents", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("details.output")).not.toHaveAttribute("open", "");
  await page.evaluate(() => {
    window.response = {
      kind: "command",
      rows: [],
      output: ["finished"],
      hasMore: false,
      database: "original_db",
    };
  });
  await run();
  await expect(page.locator(".shell-command-result")).toContainText("finished");
  await page.evaluate(() => {
    window.response.output = [];
  });
  await run();
  await expect(page.locator(".shell-command-result")).toContainText(
    "Command completed",
  );
  await page.evaluate(() => {
    window.response.kind = "documents";
  });
  await run();
  await expect(
    page.getByText("No matching documents", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.response = {
      kind: "write",
      rows: [
        {
          ejson: '{"acknowledged":true,"matchedCount":1,"modifiedCount":1}',
          editable: false,
        },
      ],
      output: [],
      hasMore: false,
      database: "original_db",
    };
    window.failHistory = true;
    window.notices = [];
  });
  await run();
  await expect(page.locator(".grid-row")).toHaveCount(1);
  await expect(page.locator(".result-state-notice")).toHaveCount(0);
  assert.match(
    (await page.evaluate(() => window.notices)).at(-1).text,
    /completed.*history/i,
  );
  assert.equal(await page.evaluate(() => window.executions.length), 5);
  await page.evaluate(() => {
    window.failHistory = false;
    window.response = {
      kind: "command",
      rows: [],
      output: ["switched"],
      hasMore: false,
      database: "other_db",
    };
  });
  await run();
  await expect(page.locator(".breadcrumb")).toContainText("other_db");
  await expect(page.locator(".breadcrumb strong")).toHaveCount(0);
  await run();
  assert.equal(
    (await page.evaluate(() => window.historyWrites)).at(-1).database,
    "other_db",
  );
  await page.locator(".toolbar-more > summary").click();
  await page.getByRole("button", { name: "Save query", exact: true }).click();
  const saveDialog = page.getByRole("dialog", {
    name: "Save / edit query",
    exact: true,
  });
  await expect(saveDialog).toBeVisible();
  await saveDialog
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.savedQueries)).at(-1).source.database,
    "other_db",
  );
  await page.evaluate(() => {
    window.failExecution = true;
    window.errorDatabase = "error_db";
  });
  await run();
  await expect(page.locator(".breadcrumb")).toContainText("error_db");
  await expect(page.locator(".result-empty")).toContainText(
    "Query did not complete",
  );
  await page.evaluate(() => {
    window.failExecution = false;
    window.response.database = "error_db";
  });
  await run();
  assert.equal(
    (await page.evaluate(() => window.historyWrites)).at(-1).database,
    "error_db",
  );
  await page.getByRole("button", { name: "Free command", exact: true }).click();
  await expect(page.locator(".breadcrumb")).toContainText("original_db");
  await page.evaluate(() => {
    window.failHistory = true;
    window.notices = [];
  });
  await run();
  await expect(page.locator(".grid-row")).toHaveCount(1);
  await expect(page.locator(".result-state-notice")).toHaveCount(0);
  assert.match(
    (await page.evaluate(() => window.notices)).at(-1).text,
    /completed.*history/i,
  );
  await page.getByRole("button", { name: "Free command", exact: true }).click();
  await page.evaluate(() => {
    window.holdExecution = true;
    window.failHistory = false;
  });
  await page.keyboard.press("F5");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.finishCancel());
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  assert.deepEqual(errors, []);
  console.log(
    "PASS Shell values/commands/documents, nonfatal history failures without retries, database changes including errors, saved query context, and normal Find isolation",
  );
} finally {
  await browser.close();
  server.httpServer?.closeAllConnections();
  await server.close();
}
