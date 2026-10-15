import { expect, test } from "vitest";
import { installationVersions } from "../scripts/installation-plan.mjs";
test("distinguishes a real older-version upgrade from same-version reinstall", () => {
  expect(
    installationVersions("Irwin-0.2.0-win-x64.exe", "Irwin-0.1.3-win-x64.exe"),
  ).toEqual({ current: "0.2.0", previous: "0.1.3" });
  expect(installationVersions("Irwin-0.2.0-win-x64.exe")).toEqual({
    current: "0.2.0",
    previous: undefined,
  });
  for (const previous of [
    "Irwin-0.2.0-win-x64.exe",
    "Irwin-0.3.0-win-x64.exe",
    "unknown.exe",
    "Irwin-0.1.3-mac-x64.dmg",
  ])
    expect(() =>
      installationVersions("Irwin-0.2.0-win-x64.exe", previous),
    ).toThrow();
});
