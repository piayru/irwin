import { criticalRendererChecks } from "./renderer-check-policy.mjs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readdir,
  readFile,
  stat,
  lstat,
  mkdir,
  mkdtemp,
  copyFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const arg = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? fallback : process.argv[i + 1];
};
const root = resolve(
  arg("--root", fileURLToPath(new URL("..", import.meta.url))),
);
const candidates = resolve(arg("--candidates", ".runtime/release-candidates"));
const output = resolve(arg("--output", ".runtime/release-draft"));
const commit = arg("--commit", process.env.GITHUB_SHA);
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!/^[a-f0-9]{40}$/.test(commit || ""))
  throw new Error("A full release commit is required");
if (arg("--tag") !== `v${pkg.version}`)
  throw new Error("Release tag must match package version");
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Candidate symlinks are not permitted");
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(candidates);
const manifests = files.filter(
  (path) => basename(path) === "release-manifest.json",
);
if (manifests.length !== 3)
  throw new Error("Exactly three platform manifests are required");
const hash = async (path) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
};
const assets = new Map(),
  artifacts = [],
  builds = [];
function add(name, path) {
  if (assets.has(name)) throw new Error(`Duplicate release artifact: ${name}`);
  assets.set(name, path);
}
for (const path of manifests) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest.commit !== commit) throw new Error("Candidate commit mismatch");
  if (manifest.version !== pkg.version)
    throw new Error("Candidate version mismatch");
  if (manifest.sourceClean !== true)
    throw new Error("Release candidates must be built from clean source");
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length)
    throw new Error("Empty candidate manifest");
  builds.push({
    nodeVersion: manifest.nodeVersion,
    databaseToolsVersion: manifest.databaseToolsVersion,
  });
  for (const artifact of manifest.artifacts) {
    const match =
      /^Irwin-([\d.]+)-(win|linux|mac)-(x64|arm64)\.(exe|deb|dmg|zip)$/.exec(
        artifact.file || "",
      );
    if (
      !match ||
      match[1] !== pkg.version ||
      artifact.platform !== match[2] ||
      artifact.arch !== match[3] ||
      !{ win: ["exe"], linux: ["deb"], mac: ["dmg", "zip"] }[match[2]].includes(
        match[4],
      )
    )
      throw new Error("Unexpected candidate artifact identity");
    const source = join(dirname(path), artifact.file),
      info = await lstat(source);
    if (
      !info.isFile() ||
      info.size !== artifact.bytes ||
      (await hash(source)) !== artifact.sha256
    )
      throw new Error(`Candidate integrity mismatch: ${artifact.file}`);
    add(artifact.file, source);
    artifacts.push(artifact);
  }
}
if (new Set(builds.map((build) => build.databaseToolsVersion)).size !== 1)
  throw new Error("Database Tools version differs between candidates");
for (const suffix of [
  "win-x64.exe",
  "linux-x64.deb",
  "mac-x64.dmg",
  "mac-arm64.dmg",
])
  if (!assets.has(`Irwin-${pkg.version}-${suffix}`))
    throw new Error(`Missing target ${suffix}`);
const requiredChecks = criticalRendererChecks;
const evidence = [];
for (const path of files.filter(
  (path) => basename(path) === "renderer-checks.json",
)) {
  const report = JSON.parse(await readFile(path, "utf8"));
  if (
    report.format === "irwin-renderer-checks" &&
    report.commit === commit &&
    report.sourceClean === true &&
    report.version === pkg.version &&
    requiredChecks.every((name) =>
      report.checks?.some(
        (check) => check.name === name && check.status === "passed",
      ),
    ) &&
    report.checks.every((check) => check.status === "passed")
  )
    evidence.push(path);
}
if (!evidence.length)
  throw new Error(
    "Missing complete renderer acceptance for this version and commit",
  );
add("renderer-checks.json", evidence[0]);
const metadata = ["latest.yml", "latest-linux.yml"];
if (pkg.build?.extraMetadata?.irwinMacAutoUpdates === true)
  metadata.push("latest-mac.yml");
for (const name of [...metadata, `Irwin-${pkg.version}-win-x64.exe.blockmap`]) {
  const matches = files.filter((path) => basename(path) === name);
  if (matches.length !== 1) throw new Error(`Missing or duplicate ${name}`);
  add(name, matches[0]);
}
const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
const escapedVersion = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^## \\[?${escapedVersion}\\]?(?:\\s|$)`, "m").exec(
  changelog,
);
if (!heading)
  throw new Error(
    "Versioned release notes missing; move reviewed Unreleased entries before tagging",
  );
const start = heading.index;
const end = changelog.indexOf("\n## ", start + heading[0].length);
const notes = changelog.slice(start, end < 0 ? undefined : end).trim();
const parent = dirname(output);
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(join(parent, ".irwin-draft-"));
try {
  for (const [name, source] of assets)
    await copyFile(source, join(temporary, name));
  for (const platform of pkg.build?.extraMetadata?.irwinMacAutoUpdates
    ? ["win32", "linux", "darwin"]
    : ["win32", "linux"]) {
    const verified = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("verify-update-metadata.mjs", import.meta.url)),
        "--root",
        root,
        "--directory",
        temporary,
        "--platform",
        platform,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (verified.status !== 0)
      throw new Error(
        `Update metadata verification failed: ${verified.stderr}`,
      );
  }
  artifacts.sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(
    join(temporary, "release-manifest.json"),
    JSON.stringify(
      {
        version: pkg.version,
        commit,
        sourceClean: true,
        databaseToolsVersion: builds[0].databaseToolsVersion,
        builds,
        artifacts,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(temporary, "release-notes.md"),
    `${notes}\n\nUnsigned Preview distributed through GitHub downloads. macOS updates are manual unless a signed updater-enabled release is explicitly configured.\n\nAutomated packaging and renderer checks do not establish clean-machine, Gatekeeper, live Cosmos DB or complete native macOS/Ubuntu acceptance. See docs/COMPATIBILITY.md for the recorded limits.\n`,
  );
  const sums = [];
  for (const name of (await readdir(temporary)).sort())
    sums.push(`${await hash(join(temporary, name))}  ${name}`);
  await writeFile(join(temporary, "SHA256SUMS.txt"), sums.join("\n") + "\n");
  // rename fails if output already contains a prior draft; never overwrite it.
  await rename(temporary, output);
  console.log(
    `Staged verified draft ${pkg.version}: ${artifacts.length} installers. Not published.`,
  );
} finally {
  if (resolve(temporary).startsWith(join(parent, ".irwin-draft-")))
    await rm(temporary, { recursive: true, force: true });
}
