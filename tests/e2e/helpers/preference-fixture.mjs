import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
export async function preferenceFixture({ settingsWriteDelayMS = 0 } = {}) {
  const server = await createServer({
    server: {
      host: "127.0.0.1",
      port: 0,
      watch: { ignored: ["**/.runtime/**"] },
    },
  });
  await server.listen();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((settingsWriteDelayMS) => {
      window.settingsWrites = [];
      window.documentWrites = [];
      window.workbench = {
        subscribe() {
          return () => {};
        },
        async request(command, payload) {
          if (command.startsWith("documents."))
            window.documentWrites.push({ command, payload });
          const { settingsSchema, profileSchema } =
            await import("/src/shared/contracts.ts");
          switch (command) {
            case "settings.get":
              return settingsSchema.parse(
                JSON.parse(localStorage.getItem("qa-settings")) || {
                  language: "en",
                  theme: "dark",
                  bsonTypeLabels: "always",
                },
              );
            case "settings.set":
              await new Promise((resolve) =>
                setTimeout(resolve, settingsWriteDelayMS),
              );
              window.settingsWrites.push(payload);
              localStorage.setItem("qa-settings", JSON.stringify(payload));
              return settingsSchema.parse(payload);
            case "workspace.get":
              return {
                version: 1,
                sidebarWidth: 235,
                jobsHeight: 180,
                historyHeight: 180,
              };
            case "app.status":
              return {
                version: "0.1.3",
                platform: "win32",
                secureStorage: true,
                connections: ["qa"],
              };
            case "connections.list":
              return [
                profileSchema.parse({
                  id: "qa",
                  name: "Theme QA",
                  uri: "mongodb://127.0.0.1:27017",
                  database: "theme_qa",
                }),
              ];
            case "metadata.databases":
              return { names: ["theme_qa"] };
            case "metadata.collections":
              return [{ name: "documents", type: "collection" }];
            case "queries.run":
              return {
                cursorId: payload.cursorId,
                hasMore: false,
                rows: Array.from({ length: 40 }, (_, index) => ({
                  ejson: JSON.stringify({
                    _id: { $oid: "507f1f77bcf86cd799439011" },
                    name: `Document ${index + 1}`,
                    count: { $numberInt: String(index + 1) },
                    active: index % 2 === 0,
                    date: { $date: { $numberLong: "1735689600000" } },
                    optional: null,
                    details: { nested: { value: "example" } },
                  }),
                  editable: false,
                })),
              };
            case "shellDrafts.list":
            case "history.list":
            case "savedQueries.list":
            case "operationReceipts.list":
              return [];
            default:
              return {};
          }
        },
      };
    }, settingsWriteDelayMS);
    await page.goto(server.resolvedUrls.local[0], {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page
      .locator(".connection-row")
      .filter({ hasText: "Theme QA" })
      .locator(".tree-main")
      .click();
    await page.getByText("theme_qa", { exact: true }).first().click();
    await page.getByText("documents", { exact: true }).first().click();
    await expect(page.locator(".grid-cell.type-string").first()).toBeVisible();

    return { server, browser, page, errors };
  } catch (error) {
    await browser.close();
    server.httpServer?.closeAllConnections();
    await server.close();
    throw error;
  }
}
