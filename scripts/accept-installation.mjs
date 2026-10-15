import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installationVersions } from "./installation-plan.mjs";
if (process.platform !== "win32")
  throw new Error(
    "Native installer acceptance currently requires Windows; see docs/INSTALLATION.md for macOS and Ubuntu checks",
  );
const index = process.argv.indexOf("--installer"),
  metadata = JSON.parse(await readFile("package.json", "utf8"));
const installer = resolve(
  index >= 0
    ? process.argv[index + 1]
    : `release/Irwin-${metadata.version}-win-x64.exe`,
);
const previousIndex = process.argv.indexOf("--previous-installer");
if (previousIndex >= 0 && !process.argv[previousIndex + 1])
  throw new Error("Missing --previous-installer path");
const previous =
  previousIndex >= 0 ? resolve(process.argv[previousIndex + 1]) : undefined;
const versions = installationVersions(installer, previous);
const child = spawn(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    resolve("scripts/accept-installation.ps1"),
    "-Installer",
    installer,
    "-Workspace",
    process.cwd(),
    "-NodeExecutable",
    process.execPath,
    "-ExpectedVersion",
    versions.current,
    ...(previous
      ? ["-PreviousInstaller", previous, "-PreviousVersion", versions.previous]
      : []),
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    // Windows PowerShell must resolve its own modules, not inherited PS7 modules.
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "psmodulepath",
      ),
    ),
  },
);
child.once("error", () => {
  process.stderr.write("Unable to start native installation acceptance\n");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
