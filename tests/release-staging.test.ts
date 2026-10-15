import { afterEach, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const roots: string[] = [];
const commit = "a".repeat(40),
  version = "0.2.0";
const script = resolve("scripts/stage-release.mjs");
const sha = (
  value: string,
  algorithm = "sha256",
  encoding: "hex" | "base64" = "hex",
) => createHash(algorithm).update(value).digest(encoding);
function fixture() {
  const root =
    (mkdirSync(resolve(".runtime/test-fixtures"), { recursive: true }),
    mkdtempSync(join(resolve(".runtime/test-fixtures"), "irwin-stage-")));
  roots.push(root);
  mkdirSync(join(root, "candidates"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      version,
      build: { extraMetadata: { irwinMacAutoUpdates: false } },
    }),
  );
  writeFileSync(
    join(root, "CHANGELOG.md"),
    "# Changelog\n\n## [0.2.0] - 2026-10-15\n\n- Count improvements\n\n## [0.1.3]\n\n- Older\n",
  );
  for (const [platform, files, metadata] of [
    ["win", ["win-x64.exe"], "latest.yml"],
    ["linux", ["linux-x64.deb"], "latest-linux.yml"],
    ["mac", ["mac-x64.dmg", "mac-arm64.dmg"], null],
  ] as const) {
    const dir = join(root, "candidates", platform);
    mkdirSync(dir);
    const artifacts = files.map((suffix) => {
      const file = `Irwin-${version}-${suffix}`;
      writeFileSync(join(dir, file), "abc");
      return {
        file,
        platform,
        arch: suffix.includes("arm64") ? "arm64" : "x64",
        bytes: 3,
        sha256: sha("abc"),
      };
    });
    writeFileSync(
      join(dir, "release-manifest.json"),
      JSON.stringify({
        version,
        commit,
        sourceClean: true,
        databaseToolsVersion: "100.18.0",
        artifacts,
      }),
    );
    if (metadata)
      writeFileSync(
        join(dir, metadata),
        JSON.stringify({
          version,
          path: artifacts[0].file,
          sha512: sha("abc", "sha512", "base64"),
          files: [
            {
              url: artifacts[0].file,
              size: 3,
              sha512: sha("abc", "sha512", "base64"),
            },
          ],
        }),
      );
    if (platform === "win") {
      writeFileSync(join(dir, artifacts[0].file + ".blockmap"), "blockmap");
      writeFileSync(
        join(dir, "renderer-checks.json"),
        JSON.stringify({
          format: "irwin-renderer-checks",
          version,
          commit,
          sourceClean: true,
          checks: [
            "updates",
            "updates-entry",
            "update-restart-confirmation",
            "query-count",
            "collection-tabs",
            "import-collection-refresh",
            "cell-update-notices",
            "bson-document-input",
          ].map((name) => ({ name, status: "passed" })),
        }),
      );
    }
  }
  return root;
}
function stage(root: string) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--root",
      root,
      "--candidates",
      join(root, "candidates"),
      "--output",
      join(root, "draft"),
      "--commit",
      commit,
      "--tag",
      "v0.2.0",
    ],
    { encoding: "utf8" },
  );
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
test("stages exact installers, checksum inventory and release notes without enabling unsigned Mac updates", () => {
  const root = fixture(),
    result = stage(root);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const report = JSON.parse(
    readFileSync(join(root, "draft/release-manifest.json"), "utf8"),
  );
  expect(report).toMatchObject({
    version,
    commit,
    artifacts: expect.any(Array),
  });
  expect(report.artifacts).toHaveLength(4);
  expect(readFileSync(join(root, "draft/SHA256SUMS.txt"), "utf8")).toContain(
    `${sha("abc")}  Irwin-0.2.0-win-x64.exe`,
  );
  expect(readFileSync(join(root, "draft/release-notes.md"), "utf8")).toContain(
    "Count improvements",
  );
  expect(
    readFileSync(join(root, "draft/release-notes.md"), "utf8"),
  ).not.toContain("Older");
  expect(existsSync(join(root, "draft/latest-mac.yml"))).toBe(false);
});
test("refuses changed installer bytes and leaves no partial draft", () => {
  const root = fixture();
  writeFileSync(
    join(root, "candidates/win/Irwin-0.2.0-win-x64.exe"),
    "tampered",
  );
  const result = stage(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("integrity");
  expect(existsSync(join(root, "draft"))).toBe(false);
});
test("refuses a mixed commit or tag instead of publishing stale artifacts", () => {
  const root = fixture(),
    path = join(root, "candidates/mac/release-manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.commit = "b".repeat(40);
  writeFileSync(path, JSON.stringify(manifest));
  const result = stage(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("commit");
});
test("refuses incomplete renderer acceptance and missing update feed", () => {
  const root = fixture();
  rmSync(join(root, "candidates/win/renderer-checks.json"));
  let result = stage(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("renderer");
  const other = fixture();
  rmSync(join(other, "candidates/linux/latest-linux.yml"));
  result = stage(other);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("latest-linux.yml");
});
test("accepts existing unbracketed changelog headings and excludes adjacent releases", () => {
  const root = fixture();
  writeFileSync(
    join(root, "CHANGELOG.md"),
    "# Changelog\n\n## Unreleased\n\n- Not shipping\n\n## 0.2.0 — 2026-10-15\n\n- Current release\n\n## 0.1.3 — 2026-10-14\n\n- Old release\n",
  );
  const result = stage(root);
  expect(result.status).toBe(0);
  const notes = readFileSync(join(root, "draft/release-notes.md"), "utf8");
  expect(notes).toContain("Current release");
  expect(notes).not.toContain("Old release");
  expect(notes).not.toContain("Not shipping");
});
test("refuses a dirty-source build even when its commit and version match", () => {
  const root = fixture(),
    path = join(root, "candidates/win/release-manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.sourceClean = false;
  writeFileSync(path, JSON.stringify(manifest));
  const result = stage(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("clean source");
});

test("requires real BSON document editing acceptance before staging", () => {
  const root = fixture(),
    path = join(root, "candidates/win/renderer-checks.json");
  const report = JSON.parse(readFileSync(path, "utf8"));
  report.checks = report.checks.filter(
    (check: { name: string }) => check.name !== "bson-document-input",
  );
  writeFileSync(path, JSON.stringify(report));
  const result = stage(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("renderer acceptance");
});

test("refuses renderer evidence from dirty or unrecorded source even when all checks pass", () => {
  for (const sourceClean of [false, undefined]) {
    const root = fixture(),
      path = join(root, "candidates/win/renderer-checks.json");
    const report = JSON.parse(readFileSync(path, "utf8"));
    report.sourceClean = sourceClean;
    writeFileSync(path, JSON.stringify(report));
    const result = stage(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("renderer acceptance");
    expect(existsSync(join(root, "draft"))).toBe(false);
  }
});
