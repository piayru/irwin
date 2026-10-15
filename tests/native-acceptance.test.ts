import { afterEach, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function run(answers?: object, output = "report.json") {
  const root =
    (mkdirSync(resolve(".runtime/test-fixtures"), { recursive: true }),
    mkdtempSync(join(resolve(".runtime/test-fixtures"), "irwin-native-")));
  roots.push(root);
  writeFileSync(join(root, "Irwin-0.2.0-win-x64.exe"), "abc");
  if (answers)
    writeFileSync(join(root, "answers.json"), JSON.stringify(answers));
  const result = spawnSync(
    process.execPath,
    [
      resolve("scripts/native-acceptance.mjs"),
      "--artifact",
      join(root, "Irwin-0.2.0-win-x64.exe"),
      "--output",
      join(root, output),
      ...(answers ? ["--answers", join(root, "answers.json")] : []),
    ],
    { encoding: "utf8" },
  );
  return { root, result };
}
test("native evidence records exact artifact bytes and defaults all manual checks to pending", () => {
  const { root, result } = run();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const report = JSON.parse(readFileSync(join(root, "report.json"), "utf8"));
  expect(report.artifact).toMatchObject({
    version: "0.2.0",
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    bytes: 3,
  });
  expect(report.status).toBe("pending");
  expect(report.checks.every((c: any) => c.status === "pending")).toBe(true);
});
test("rejects unknown or unsubstantiated manual passes", () => {
  for (const answers of [
    { checks: { install: { status: "passed", evidence: "" } } },
    { checks: { madeUp: { status: "passed", evidence: "checked" } } },
  ]) {
    const { result } = run(answers);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/evidence|Unknown/);
  }
});
test("creates the evidence output directory on a fresh checkout", () => {
  const { root, result } = run(undefined, "reports/native.json");
  expect(result.status).toBe(0);
  expect(
    JSON.parse(readFileSync(join(root, "reports/native.json"), "utf8")).status,
  ).toBe("pending");
});
