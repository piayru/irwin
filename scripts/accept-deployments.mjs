import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const directory = resolve(".runtime/deployment-acceptance");
await mkdir(directory, { recursive: true });
const outfile = resolve(directory, "runner.mjs");
await build({
  entryPoints: ["scripts/deployment-runner.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node24",
});
const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});
child.once("error", () => {
  process.stderr.write("Unable to start deployment acceptance\n");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
