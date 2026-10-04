import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const script = resolve(
  import.meta.dirname,
  "../scripts/verify-update-metadata.mjs",
);
const roots: string[] = [];
const sha512 = createHash("sha512").update("abc").digest("base64");
function fixture(platform = "win32") {
  const root = mkdtempSync(join(tmpdir(), "irwin-update-metadata-"));
  roots.push(root);
  mkdirSync(join(root, "release"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "0.1.1" }),
  );
  const file = `Irwin-0.1.1-${platform === "win32" ? "win-x64.exe" : "linux-x64.deb"}`;
  const metadata = platform === "win32" ? "latest.yml" : "latest-linux.yml";
  writeFileSync(join(root, "release", file), "abc");
  const content = `version: 0.1.1\nfiles:\n  - url: ${file}\n    sha512: ${sha512}\n    size: 3\npath: ${file}\nsha512: ${sha512}\nreleaseDate: '2026-09-30T00:00:00.000Z'\n`;
  const write = (text: string) =>
    writeFileSync(join(root, "release", metadata), text);
  write(content);
  return { root, file, metadata, content, write };
}
function run(root: string, platform = "win32") {
  return spawnSync(
    process.execPath,
    [script, "--root", root, "--platform", platform],
    { encoding: "utf8" },
  );
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
test.each(["win32", "linux"])(
  "verifies exact %s installer bytes",
  (platform) => {
    const { root } = fixture(platform);
    const result = run(root, platform);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SHA512 matched");
  },
);
test.each([
  [
    "wrong version",
    (s: string) => s.replace("version: 0.1.1", "version: 0.1.0"),
    "version must match",
  ],
  [
    "wrong filename",
    (s: string) => s.replaceAll("win-x64.exe", "win-arm64.exe"),
    "url and path must reference",
  ],
  [
    "remote URL",
    (s: string) => s.replace("url: Irwin", "url: https://example.com/Irwin"),
    "url and path must reference",
  ],
  [
    "traversal",
    (s: string) => s.replace("url: Irwin", "url: ../Irwin"),
    "url and path must reference",
  ],
  [
    "wrong size",
    (s: string) => s.replace("size: 3", "size: 4"),
    "byte size does not match",
  ],
  [
    "missing size",
    (s: string) => s.replace("    size: 3\n", ""),
    "byte size does not match",
  ],
  [
    "missing digest",
    (s: string) => s.replaceAll(`sha512: ${sha512}`, "sha512: null"),
    "base64 SHA512",
  ],
  [
    "conflicting digest",
    (s: string) => s.replace(`sha512: ${sha512}`, "sha512: invalid"),
    "base64 SHA512",
  ],
  [
    "extra installer",
    (s: string) => s.replace("path:", "  - url: other.exe\npath:"),
    "exactly one",
  ],
  [
    "duplicate YAML key",
    (s: string) => `${s}version: 0.1.1\n`,
    "duplicated mapping key",
  ],
] as const)("rejects %s", (_label, mutate, error) => {
  const f = fixture();
  f.write(mutate(f.content));
  const result = run(f.root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(error);
});
test("rejects same-size tampered installer", () => {
  const f = fixture();
  writeFileSync(join(f.root, "release", f.file), "abd");
  const result = run(f.root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "SHA512 does not match exact installer bytes",
  );
});
test.each(["metadata", "installer"])("rejects missing %s", (kind) => {
  const f = fixture();
  rmSync(join(f.root, "release", kind === "metadata" ? f.metadata : f.file));
  expect(run(f.root).status).toBe(1);
});
test("combined verification requires both platform feeds", () => {
  const f = fixture();
  const result = run(f.root, "all");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("latest-linux.yml");
});

function macFixture() {
  const f = fixture();
  const files = ["x64", "arm64"].flatMap((arch) =>
    ["zip", "dmg"].map((ext) => ({
      url: `Irwin-0.1.1-mac-${arch}.${ext}`,
      sha512,
      size: 3,
    })),
  );
  for (const entry of files)
    writeFileSync(join(f.root, "release", entry.url), "abc");
  const info = { version: "0.1.1", files, path: files[0].url, sha512 };
  const write = () =>
    writeFileSync(join(f.root, "release/latest-mac.yml"), JSON.stringify(info));
  write();
  return { ...f, info, write };
}
test("verifies combined macOS ZIP and DMG payloads for both architectures", () => {
  const f = macFixture();
  expect(run(f.root, "darwin").status).toBe(0);
  // Either architecture can be the primary ZIP; list ordering is not guaranteed.
  f.info.path = f.info.files[2].url;
  f.info.files.reverse();
  f.write();
  expect(run(f.root, "darwin").status).toBe(0);
});
test.each(["zip", "dmg"])(
  "checks the exact bytes of each macOS %s",
  (extension) => {
    const f = macFixture();
    const entry = f.info.files.find((item) =>
      item.url.endsWith(`arm64.${extension}`),
    )!;
    writeFileSync(join(f.root, "release", entry.url), "bad");
    const result = run(f.root, "darwin");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "SHA512 does not match exact installer bytes",
    );
  },
);
test.each([
  "missing architecture",
  "duplicate entry",
  "wrong version",
  "DMG primary",
  "wrong size",
])("rejects macOS feed with %s", (scenario) => {
  const f = macFixture();
  if (scenario === "missing architecture") f.info.files.splice(2);
  if (scenario === "duplicate entry") f.info.files[2] = f.info.files[0];
  if (scenario === "wrong version") f.info.version = "0.1.0";
  if (scenario === "DMG primary") f.info.path = f.info.files[1].url;
  if (scenario === "wrong size") f.info.files[2].size = 4;
  f.write();
  expect(run(f.root, "darwin").status).toBe(1);
});
