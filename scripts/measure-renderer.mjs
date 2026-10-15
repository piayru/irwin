// Repeatable renderer benchmark against a production build and disposable IPC
// fixtures. It never connects to MongoDB or reads application user data.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, extname, relative } from "node:path";
import { createRequire } from "node:module";
import { chromium, expect as baseExpect } from "@playwright/test";
import { build } from "esbuild";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
// This is a measurement tool, so cold loading is recorded rather than rejected
// by Playwright's short default assertion deadline.
const expect = baseExpect.configure({ timeout: 60000 });
const directory = resolve(arg("--directory", "dist/renderer"));
const output = resolve(arg("--output", ".runtime/renderer-performance.json"));
const samples = Number(arg("--samples", 3));
if (!Number.isInteger(samples) || samples < 1 || samples > 10)
  throw new Error("Use 1–10 benchmark samples");
const fixtures = resolve(".runtime/renderer-performance");
await mkdir(fixtures, { recursive: true });
const fixtureModule = join(fixtures, "settings.cjs");
await build({
  stdin: {
    contents: `import {settingsSchema,profileSchema} from './src/shared/contracts'; export const settings=settingsSchema.parse({language:'en',autoRunOnOpen:true}); export const profile=profileSchema.parse({id:'benchmark',name:'Benchmark connection',uri:'mongodb://127.0.0.1:1',database:'benchmark'});`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: fixtureModule,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
});
const { settings, profile } = createRequire(import.meta.url)(fixtureModule);
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    const path = resolve(
      directory,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    const rel = relative(directory, path);
    if (rel.startsWith("..") || rel.includes(":")) {
      res.writeHead(403);
      res.end();
      return;
    }
    const content = await readFile(path);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".ttf": "font/ttf",
      }[extname(path)] || "application/octet-stream",
    );
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
let browserServer;
const measurements = [];
try {
  browserServer = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  for (let i = 0; i < samples; i++) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Renderer error:", error.message);
    });
    await page.addInitScript(
      ({ settings, profile }) => {
        const listeners = new Set();
        window.workbench = {
          subscribe(callback) {
            listeners.add(callback);
            return () => listeners.delete(callback);
          },
          async request(command, payload) {
            switch (command) {
              case "settings.get":
                return settings;
              case "workspace.get":
                return {
                  version: 1,
                  sidebarWidth: 268,
                  jobsHeight: 220,
                  historyHeight: 260,
                };
              case "app.status":
                return {
                  version: "benchmark",
                  platform: "win32",
                  secureStorage: true,
                  connections: [],
                };
              case "connections.list":
                return [profile];
              case "connections.open":
                for (const callback of listeners)
                  callback({
                    type: "connection",
                    data: { id: profile.id, connected: true },
                  });
                return {};
              case "metadata.databases":
                return { names: ["benchmark"] };
              case "metadata.collections":
                return Array.from({ length: 3000 }, (_, n) => ({
                  name: `collection_${String(n).padStart(5, "0")}`,
                  type: "collection",
                }));
              case "queries.run":
                return {
                  cursorId: "benchmark",
                  hasMore: false,
                  rows: Array.from({ length: 1000 }, (_, n) => ({
                    id: String(n),
                    ejson: JSON.stringify({
                      _id: n,
                      title: "Benchmark",
                      data: "x".repeat(512),
                    }),
                    source: {
                      connectionId: profile.id,
                      database: "benchmark",
                      collection: "collection_00000",
                    },
                  })),
                };
              case "shellDrafts.list":
              case "history.list":
              case "savedQueries.list":
                return [];
              default:
                return undefined;
            }
          },
        };
      },
      { settings, profile },
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".brand strong")).toHaveText("Irwin");
    const startup = await page.evaluate(async () => {
      await new Promise((ok) =>
        requestAnimationFrame(() => requestAnimationFrame(ok)),
      );
      return {
        readyMS: performance.now(),
        resources: performance
          .getEntriesByType("resource")
          .filter((r) => r.name.endsWith(".js"))
          .map((r) => ({
            name: new URL(r.name).pathname,
            bytes: r.decodedBodySize,
          })),
      };
    });
    await page
      .getByRole("button", { name: "Open saved connection", exact: true })
      .click();
    await page
      .locator(".connection-picker-item")
      .filter({ hasText: "Benchmark connection" })
      .click();
    const beforeCollections = await page.evaluate(() => performance.now());
    await page
      .locator(".sidebar .tree-main")
      .filter({ hasText: /^benchmark$/ })
      .click();
    await expect(page.locator(".collection-row")).toHaveCount(3000);
    const collectionsReadyMS =
      (await page.evaluate(() => performance.now())) - beforeCollections;
    const beforeQuery = await page.evaluate(() => performance.now());
    await page.locator(".collection-row .tree-main").first().dblclick();
    await expect(page.locator(".results-wrapper")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator(".result-toolbar")).toContainText("1,000");
    const tableReadyMS =
      (await page.evaluate(() => performance.now())) - beforeQuery;
    const beforeJson = await page.evaluate(() => performance.now());
    await page
      .locator(".result-toolbar")
      .getByRole("button", { name: "JSON", exact: true })
      .click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible({
      timeout: 60000,
    });
    const jsonEditorReadyMS =
      (await page.evaluate(() => performance.now())) - beforeJson;
    const jsonResources = await page.evaluate(
      (started) =>
        performance
          .getEntriesByType("resource")
          .filter((resource) => resource.startTime >= started)
          .map((resource) => ({
            name: new URL(resource.name).pathname,
            durationMS: resource.duration,
            bytes: resource.decodedBodySize,
          })),
      beforeJson,
    );
    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    const metrics = (await session.send("Performance.getMetrics")).metrics;
    assert.deepEqual(errors, []);
    measurements.push({
      sample: i + 1,
      startup,
      collectionsReadyMS,
      tableReadyMS,
      jsonEditorReadyMS,
      jsonResources,
      jsHeapUsedBytes: metrics.find((m) => m.name === "JSHeapUsedSize")?.value,
    });
    await context.close();
  }
  const report = {
    format: "irwin-renderer-performance",
    version: 1,
    capturedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      chromium: browser.version(),
    },
    fixture: { collections: 3000, rows: 1000, rowTextBytes: 512 },
    measurements,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browserServer?.kill();
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
}
