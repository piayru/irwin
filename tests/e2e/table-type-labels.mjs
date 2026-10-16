// Exercise the real virtualized Results table; no database connection is used.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const cases = [
  ["hello", "Str", "String"],
  [42, "Num", "Number"],
  [false, "Bool", "Boolean"],
  [null, "Null", "Null"],
  [{}, "Obj", "Object"],
  [[], "Arr", "Array"],
  [{ $numberInt: "7" }, "Int", "Int32"],
  [{ $numberLong: "9007199254740993" }, "Long", "Int64"],
  [{ $numberDouble: "1.5" }, "Dbl", "Double"],
  [{ $numberDecimal: "1.20" }, "Dec", "Decimal128"],
  [{ $oid: "507f1f77bcf86cd799439011" }, "ObjId", "ObjectId"],
  [{ $date: { $numberLong: "0" } }, "Date", "Date"],
  [{ $binary: { base64: "AQI=", subType: "00" } }, "Bin", "Binary"],
  [
    { $binary: { base64: "AAAAAAAAAAAAAAAAAAAAAA==", subType: "04" } },
    "UUID",
    "UUID",
  ],
  [{ $timestamp: { t: 1, i: 2 } }, "TS", "Timestamp"],
  [
    { $regularExpression: { pattern: "hello", options: "i" } },
    "Regex",
    "Regular expression",
  ],
  [{ $minKey: 1 }, "Min", "MinKey"],
  [{ $maxKey: 1 }, "Max", "MaxKey"],
  [{ $undefined: true }, "Undef", "Undefined"],
  [{ $symbol: "hello" }, "Sym", "Symbol"],
  [{ $code: "return 1" }, "Code", "JavaScript code"],
  [
    { $code: "return x", $scope: { x: 1 } },
    "Code",
    "JavaScript code with scope",
  ],
  [
    {
      $dbPointer: { $ref: "other", $id: { $oid: "507f1f77bcf86cd799439011" } },
    },
    "Ref",
    "DBPointer",
  ],
  [{ $date: "ordinary field", note: true }, "Obj", "Object"],
  [{ $custom: 1 }, "Obj", "Object"],
  [
    "A long string that requires the selected-cell preview to expand beyond the column without covering its type badge. ".repeat(
      2,
    ),
    "Str",
    "String",
  ],
];

const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { ignored: ["**/.runtime/**"] },
  },
  plugins: [
    {
      name: "table-type-label-fixture",
      configureServer(server) {
        server.middlewares.use("/__types", async (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(
            await server.transformIndexHtml(
              "/__types",
              `<!doctype html>
          <html><head><style>#root{height:100vh;display:flex;overflow:hidden}</style></head>
          <body><div id="root"></div><script type="module">
          import React from 'react';
          import ReactDOM from 'react-dom/client';
          import {Results} from '/src/renderer/Results.tsx';
          import {UiContext} from '/src/renderer/ui.tsx';
          import {settingsSchema} from '/src/shared/contracts.ts';
          import '/src/renderer/styles.css';
          const cases = ${JSON.stringify(cases)};
          function Fixture() {
            const [index, setIndex] = React.useState(0);
            const [mode, setMode] = React.useState('selected');
            window.setCase = setIndex;
            window.setMode = setMode;
            const settings = settingsSchema.parse({language:'en',bsonTypeLabels:mode});
            const t = (zh,en) => en;
            const rows = [{value:cases[index][0]},{value:'second'},{other:true}]
              .map(doc => ({ejson:JSON.stringify(doc),editable:true}));
            return React.createElement(UiContext.Provider,{value:{...settings,settings,t}},
              React.createElement(Results,{rows,view:'table',theme:'dark',t,
                showColumns:false,onCloseColumns:()=>{},onEdit:()=>{},onSelect:()=>{},
                onCommit:async(row,field,value)=>window.committed.push({row,field,value})}));
          }
          ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
          </script></body></html>`,
            ),
          );
        });
      },
    },
  ],
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.addInitScript(() => {
    window.copied = [];
    window.committed = [];
    window.workbench = {
      request: async (command, payload) => {
        if (command === "clipboard.write") window.copied.push(payload.text);
      },
    };
  });
  await page.goto(`${server.resolvedUrls.local[0]}__types`, {
    waitUntil: "networkidle",
  });
  const rows = page.locator(".grid-row");
  const value = rows.nth(0).locator(".grid-cell").first();
  const badge = value.locator(".cell-type-badge");
  await expect(value).toBeVisible({ timeout: 30000 });
  assert.deepEqual(errors, []);
  await expect(page.locator(".cell-type-badge")).toHaveCount(0);
  for (const [index, [, short, full]] of cases.entries()) {
    await page.evaluate((index) => window.setCase(index), index);
    await value.click();
    await expect(badge).toHaveText(short);
    await expect(badge).toHaveAttribute("title", full);
    await expect(page.locator(".cell-type-badge")).toHaveCount(1);
    await expect
      .poll(() =>
        badge.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            ),
          );
        }),
      )
      .toBe(true);
  }
  const missing = rows.nth(2).locator(".grid-cell").first();
  await missing.click();
  await expect(missing.locator(".cell-type-badge")).toHaveText("Missing");
  // Keyboard selection uses the same labels as pointer selection.
  await page.getByRole("grid").press("ArrowUp");
  await expect(rows.nth(1).locator(".cell-type-badge")).toHaveText("Str");
  await expect(missing.locator(".cell-type-badge")).toHaveCount(0);
  await page.evaluate(() => window.setMode("always"));
  await expect(page.locator(".cell-type-badge")).toHaveCount(6);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    const bounds = await badge.evaluate((el) => ({
      badge: el.getBoundingClientRect().right,
      preview: el.nextElementSibling.getBoundingClientRect().left,
    }));
    assert.ok(
      bounds.badge < bounds.preview,
      "Badge must not overlap the value",
    );
    await mkdir(".runtime/table-type-labels", { recursive: true });
    await page.screenshot({ path: `.runtime/table-type-labels/${theme}.png` });
  }
  // Labels are presentation only: copying and editing retain the original values.
  await page.evaluate(() => window.setCase(10));
  await value.click();
  await page.getByRole("grid").press("ControlOrMeta+c");
  await expect
    .poll(() => page.evaluate(() => window.copied.at(-1)))
    .toBe('ObjectId("507f1f77bcf86cd799439011")');
  await page.evaluate(() => window.setCase(0));
  await value.dblclick();
  await expect(badge).toHaveCount(0);
  await page.getByLabel("Edit cell").fill("updated");
  await page.getByLabel("Edit cell").press("Enter");
  await expect(badge).toHaveText("Str");
  assert.deepEqual(await page.evaluate(() => window.committed), [
    { row: 0, field: "value", value: '"updated"' },
  ]);
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${cases.length + 1} types, selection, keyboard, preferences, layout, copy and edit`,
  );
} finally {
  await browser?.close();
  server.httpServer?.closeAllConnections();
  await server.close();
}
