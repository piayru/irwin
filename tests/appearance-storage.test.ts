import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => false },
}));
import { Storage } from "../src/main/storage";
let directory: string | undefined, storage: Storage | undefined;
afterEach(async () => {
  storage?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test("custom appearance survives reopening storage and invalid updates leave saved settings intact", async () => {
  directory = await mkdtemp(join(resolve(".runtime"), "appearance-storage-"));
  const path = join(directory, "settings.sqlite");
  storage = new Storage(path);
  storage.setSettings({
    ...storage.settings(),
    themeOverrides: { forest: { sidebar: "#123456", number: "#abcdef" } },
    viewSettings: {
      table: { fontSize: 18, lineHeight: 28 },
      tree: { indent: 30 },
      json: { tabWidth: 8 },
    },
  });
  storage.close();
  storage = new Storage(path);
  expect(storage.settings().themeOverrides).toEqual({
    forest: { sidebar: "#123456", number: "#abcdef" },
  });
  expect(storage.settings().viewSettings).toEqual({
    table: { fontSize: 18, lineHeight: 28 },
    tree: { indent: 30 },
    json: { tabWidth: 8 },
  });
  expect(() =>
    storage!.setSettings({
      ...storage!.settings(),
      themeOverrides: { forest: { sidebar: "invalid" } },
    }),
  ).toThrow();
  expect(storage.settings().themeOverrides.forest?.sidebar).toBe("#123456");
});
