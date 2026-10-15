import { criticalRendererChecks } from "./renderer-check-policy.mjs";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const required = criticalRendererChecks;
const selectedIndex = process.argv.indexOf("--only");
const selected =
  selectedIndex < 0 ? required : [process.argv[selectedIndex + 1]];
if (selected.some((name) => !required.includes(name)))
  throw new Error("Unknown renderer check");
const output = resolve(".runtime/renderer-checks");
await mkdir(output, { recursive: true });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const readGit = (args) =>
  spawnSync("git", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
const cleanSource = () => {
  const status = readGit(["status", "--porcelain", "--untracked-files=normal"]);
  return status.status === 0 && status.stdout.trim() === "";
};
const git = readGit(["rev-parse", "HEAD"]);
if (!/^[a-f0-9]{40}$/.test(git.stdout?.trim() || ""))
  throw new Error("Cannot identify renderer test commit");
const startedClean = cleanSource();
const checks = [];
for (const name of selected) {
  const started = performance.now();
  const log = [];
  const child = spawn(process.execPath, [resolve(`tests/e2e/${name}.mjs`)], {
    windowsHide: true,
    env: process.env,
    detached: process.platform !== "win32",
  });
  let timedOut = false;
  let finish;
  const timer = setTimeout(() => {
    timedOut = true;
    // The PID belongs to the child created immediately above. Stop its browser
    // descendants too, so one stalled fixture cannot pollute subsequent checks.
    if (process.platform === "win32") {
      const stopped = spawnSync(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          windowsHide: true,
          timeout: 10000,
        },
      );
      if (stopped.error || stopped.status !== 0) child.kill("SIGKILL");
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill();
      }
    }
    // A broken browser transport can retain inherited pipes after termination.
    // Do not let those handles turn a failed check into an unbounded release job.
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    finish(-1);
  }, 360000);
  const capture = (data) => {
    log.push(data.toString());
    process.stdout.write(data);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const exitCode = await new Promise((ok) => {
    finish = ok;
    child.once("error", () => ok(-1));
    child.once("exit", (code) => ok(code ?? -1));
  });
  clearTimeout(timer);
  await writeFile(join(output, `${name}.log`), log.join(""));
  const status = exitCode === 0 && !timedOut ? "passed" : "failed";
  checks.push({
    name,
    status,
    exitCode,
    timedOut,
    durationMS: Math.round(performance.now() - started),
  });
  console.log(`${status.toUpperCase()} ${name}`);
  if (timedOut) console.error(`${name} exceeded its 6-minute deadline`);
}
await writeFile(
  resolve(".runtime/renderer-checks.json"),
  JSON.stringify(
    {
      format: "irwin-renderer-checks",
      version,
      commit: git.stdout.trim(),
      sourceClean:
        startedClean &&
        cleanSource() &&
        readGit(["rev-parse", "HEAD"]).stdout?.trim() === git.stdout.trim(),
      capturedAt: new Date().toISOString(),
      platform: process.platform,
      checks,
    },
    null,
    2,
  ) + "\n",
);
if (checks.some((check) => check.status !== "passed")) process.exitCode = 1;
