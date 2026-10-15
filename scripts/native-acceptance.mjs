import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat, access, mkdir } from "node:fs/promises";
import { platform, arch, release } from "node:os";
import { resolve, basename, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
if (!arg("--artifact") || !arg("--output"))
  throw new Error(
    "Use --artifact <downloaded installer> --output <report.json> [--answers <answers.json>]",
  );
const path = resolve(arg("--artifact"));
if (
  [arg("--output"), arg("--answers")]
    .filter(Boolean)
    .some((value) => resolve(value) === path)
)
  throw new Error("Evidence paths must not overwrite the installer");
const match =
  /^Irwin-([\d.]+)-(win|linux|mac)-(x64|arm64)\.(exe|deb|dmg)$/.exec(
    basename(path),
  );
if (!match) throw new Error("Use an exact Irwin installer filename");
const required = [
  "install",
  "first-launch",
  "launcher-shortcuts",
  "core-database-workflow",
  "clipboard-file-dialogs",
  "credential-storage",
  "upgrade-preserves-settings",
  "uninstall",
  "download-prompts-signing",
];
if (match[2] === "mac")
  required.push("gatekeeper", "native-process-architecture");
const answers = arg("--answers")
  ? JSON.parse(await readFile(resolve(arg("--answers")), "utf8"))
  : {};
for (const name of Object.keys(answers.checks || {}))
  if (!required.includes(name))
    throw new Error(`Unknown native check: ${name}`);
const checks = required.map((name) => {
  const answer = answers.checks?.[name] || { status: "pending", evidence: "" };
  if (!["pending", "passed", "failed"].includes(answer.status))
    throw new Error(`Invalid status: ${name}`);
  if (
    typeof answer.evidence !== "string" ||
    (answer.status !== "pending" && !answer.evidence.trim())
  )
    throw new Error(`Manual ${name} requires evidence notes`);
  return { name, status: answer.status, evidence: answer.evidence };
});
const hostMatches =
  { win: "win32", mac: "darwin", linux: "linux" }[match[2]] === platform() &&
  match[3] === arch();
const virtualLinux = platform() === "linux" && /microsoft/i.test(release());
const containerLinux =
  platform() === "linux" &&
  (
    await Promise.all(
      ["/.dockerenv", "/run/.containerenv"].map((file) =>
        access(file).then(
          () => true,
          () => false,
        ),
      ),
    )
  ).some(Boolean);
const environment = virtualLinux
  ? "wsl"
  : containerLinux
    ? "container"
    : "native";
const hash = createHash("sha256");
for await (const chunk of createReadStream(path)) hash.update(chunk);
const git = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
});
const report = {
  format: "irwin-native-acceptance",
  version: 1,
  capturedAt: new Date().toISOString(),
  recordingCommit: /^[a-f0-9]{40}$/.test(git.stdout?.trim() || "")
    ? git.stdout.trim()
    : undefined,
  artifact: {
    file: basename(path),
    version: match[1],
    platform: match[2],
    arch: match[3],
    bytes: (await stat(path)).size,
    sha256: hash.digest("hex"),
  },
  host: {
    platform: platform(),
    arch: arch(),
    osVersion: release(),
    environment,
  },
  status: checks.some((c) => c.status === "failed")
    ? "failed"
    : hostMatches &&
        environment === "native" &&
        checks.every((c) => c.status === "passed")
      ? "passed"
      : "pending",
  checks,
};
await mkdir(dirname(resolve(arg("--output"))), { recursive: true });
await writeFile(
  resolve(arg("--output")),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Native acceptance ${report.status}: ${basename(path)}. This records manual evidence; it does not install or validate the application automatically.`,
);
if (report.status === "failed") process.exitCode = 1;
