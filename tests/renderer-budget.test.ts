import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureRendererBundle } from "../scripts/renderer-budget.mjs";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(manifest: object) {
  const directory = await mkdtemp(join(tmpdir(), "irwin-budget-"));
  directories.push(directory);
  await mkdir(join(directory, ".vite"));
  await writeFile(
    join(directory, ".vite/manifest.json"),
    JSON.stringify(manifest),
  );
  for (const [name, content] of Object.entries({
    "entry.js": "12345",
    "shared.js": "123",
    "editor.js": "monaco",
    "entry.css": "css",
  }))
    await writeFile(join(directory, name), content);
  return directory;
}
test("counts each static dependency once without charging deferred editor bytes to startup", async () => {
  const directory = await fixture({
    "index.html": {
      file: "entry.js",
      isEntry: true,
      imports: ["shared", "shared"],
      dynamicImports: ["editor"],
      css: ["entry.css"],
    },
    shared: { file: "shared.js", imports: ["index.html"] },
    editor: { file: "editor.js" },
  });
  expect(await measureRendererBundle(directory, 8)).toMatchObject({
    initialJavaScriptBytes: 8,
    initialCssBytes: 3,
    initialJavaScriptFiles: ["entry.js", "shared.js"],
    withinBudget: true,
  });
  expect((await measureRendererBundle(directory, 7)).withinBudget).toBe(false);
});
test("fails closed for missing entry, missing static chunk or unsafe artifact path", async () => {
  for (const manifest of [
    {},
    { "index.html": { file: "entry.js", isEntry: true, imports: ["missing"] } },
    { "index.html": { file: "../private.js", isEntry: true } },
  ]) {
    await expect(
      measureRendererBundle(await fixture(manifest), 100),
    ).rejects.toThrow();
  }
});
