// Windows-only, opt-in acceptance test. Builds and installs a separate QA app;
// never runs a production Irwin installer or uses its identity/user-data paths.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join, relative, isAbsolute, basename } from "node:path";
import { randomBytes } from "node:crypto";

assert.equal(
  process.platform,
  "win32",
  "This acceptance test requires Windows",
);
delete process.env.ELECTRON_RUN_AS_NODE;
const root = resolve(
  process.env.UPDATE_QA_ROOT || `.runtime/update-native-${Date.now()}`,
);
const runtime = resolve(".runtime");
assert.equal(relative(runtime, root).startsWith(".."), false);
assert.equal(isAbsolute(relative(runtime, root)), false);
assert.match(basename(root), /^update-native-\d+$/);
await mkdir(root, { recursive: true });
const ownerFile = join(root, "owner.json");
let identity;
try {
  identity = JSON.parse(await readFile(ownerFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const suffix = randomBytes(5).toString("hex");
  identity = {
    name: `irwin-updater-qa-${suffix}`,
    appId: `dev.irwin.updater.qa.${suffix}`,
  };
  await writeFile(ownerFile, JSON.stringify(identity));
}
assert.match(identity.name, /^irwin-updater-qa-[a-f0-9]{10}$/);
assert.match(identity.appId, /^dev\.irwin\.updater\.qa\.[a-f0-9]{10}$/);
function owned(path) {
  const result = resolve(path);
  const child = relative(root, result);
  assert.ok(
    child && !child.startsWith("..") && !isAbsolute(child),
    `Unowned path: ${result}`,
  );
  return result;
}
function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: "inherit",
      env,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${basename(executable)} exited ${code}`)),
    );
  });
}
async function waitFor(label, check, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
async function records(path) {
  const text = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line.replace(/^\uFEFF/, "")));
}
const production = JSON.parse(await readFile("package.json", "utf8"));
const fixture = owned(join(root, "fixture"));
await mkdir(fixture, { recursive: true });
await build({
  stdin: {
    contents: `
      import { app } from 'electron';
      import { NsisUpdater } from 'electron-updater';
      import { UpdateService } from './src/main/update-service';
      import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
      import { join } from 'node:path';
      const root = ${JSON.stringify(root)};
      const config = () => JSON.parse(readFileSync(join(root, 'control.json'), 'utf8'));
      const initial = config();
      const phase = join(root, initial.phase);
      mkdirSync(join(phase, 'user-data'), {recursive:true});
      app.setPath('userData', join(phase, 'user-data'));
      const record = (event) => appendFileSync(join(phase, 'events.jsonl'), JSON.stringify(event)+'\\n');
      app.once('quit', (_event, exitCode) => record({exited:app.getVersion(),exitCode}));
      process.on('uncaughtException', error => { record({error:error.stack}); app.exit(1); });
      app.whenReady().then(async () => {
        const version = app.getVersion();
        record({started:version, pid:process.pid, updated:process.argv.includes('--updated'), exe:process.execPath,
          marker:readFileSync(join(app.getPath('userData'),'saved-setting.txt'),'utf8')});
        if (version === initial.target) { setTimeout(() => app.quit(), 300); return; }
        const updater = new NsisUpdater({provider:'generic',url:initial.feed});
        Object.defineProperty(updater.app, 'baseCachePath', {get:() => join(phase,'cache')});
        updater.disableDifferentialDownload = true;
        updater.logger = Object.fromEntries(['info','warn','error','debug'].map(level =>
          [level,(message) => record({level,message:String(message)})]));
        if (initial.legacy) {
          const install = updater.quitAndInstall.bind(updater);
          updater.quitAndInstall = () => install(false,true);
        }
        const service = new UpdateService({currentVersion:version,platform:'win32',packaged:app.isPackaged,
          updater,fetcher:() => fetch(initial.feed+'release.json'),beforeInstall:async () => true,
          onStatus:status => record({status})});
        await service.check();
        record({discovered:true,autoDownload:updater.autoDownload});
        const timer = setInterval(() => {
          let next; try { next = config(); } catch { return; }
          if (next.install) { clearInterval(timer); void service.install(); }
        },100);
      });
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: join(fixture, "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
});
for (const version of ["0.1.0", "0.2.0"]) {
  const output = owned(join(root, version));
  const metadata = {
    name: identity.name,
    version,
    packageManager: "npm@11.6.1",
    dependencies: {},
    description: "Isolated Irwin updater acceptance fixture",
    author: production.author,
    main: "main.cjs",
  };
  await writeFile(join(fixture, "package.json"), JSON.stringify(metadata));
  await mkdir(join(fixture, "node_modules"), { recursive: true });
  await writeFile(
    join(fixture, "package-lock.json"),
    JSON.stringify({
      name: identity.name,
      version,
      lockfileVersion: 3,
      packages: { "": { name: identity.name, version } },
    }),
  );
  const config = {
    appId: identity.appId,
    productName: identity.name,
    npmRebuild: false,
    compression: "store",
    electronVersion: production.devDependencies.electron,
    electronDist: resolve("node_modules/electron/dist"),
    directories: { app: fixture, output },
    files: ["main.cjs", "package.json"],
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
      artifactName: `${identity.name}-\${version}.exe`,
    },
    nsis: {
      ...production.build.nsis,
      ...(production.build.nsis.include
        ? { include: resolve(production.build.nsis.include) }
        : {}),
      createDesktopShortcut: false,
      createStartMenuShortcut: false,
    },
    publish: [{ provider: "generic", url: "http://127.0.0.1/" }],
  };
  const configPath = owned(join(root, `builder-${version}.json`));
  await writeFile(configPath, JSON.stringify(config));
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "CSC_LINK", "WIN_CSC_LINK"])
    delete env[key];
  await run(
    process.execPath,
    [
      resolve("node_modules/electron-builder/cli.js"),
      "--projectDir",
      fixture,
      "--config",
      configPath,
      "--win",
      "--publish",
      "never",
    ],
    { env },
  );
}
const requests = [];
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname.slice(1),
    );
    requests.push(name);
    if (name === "release.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          tag_name: "v0.2.0",
          name: "QA release",
          body: "Isolated native update acceptance",
        }),
      );
    } else if (name === "latest.yml") {
      response.end(await readFile(join(root, "0.2.0", name)));
    } else if (name === `${identity.name}-0.2.0.exe`) {
      createReadStream(join(root, "0.2.0", name)).pipe(response);
    } else {
      response.writeHead(404).end();
    }
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const feed = `http://127.0.0.1:${server.address().port}/`;
const watcherPath = owned(join(root, "watch-windows.ps1"));
await writeFile(
  watcherPath,
  `
param([string]$TaskPrefix,[string]$TaskOutput,[string]$TaskStop)
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class UpdateQaWindows {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h,Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder b,int n);
 public static object[] Snapshot(int pid) {
  var result=new List<object>(); EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);
   if(id==pid && IsWindowVisible(h)) {
    var title=new StringBuilder(256);GetWindowText(h,title,256); bool progress=false,buttons=false;
    EnumChildWindows(h,(ch,cp)=>{var name=new StringBuilder(128);GetClassName(ch,name,128);
     if(IsWindowVisible(ch)){ if(name.ToString()=="msctls_progress32")progress=true; if(name.ToString()=="Button")buttons=true;} return true;},IntPtr.Zero);
    result.Add(new {pid,title=title.ToString(),progress,buttons});
   } return true;},IntPtr.Zero); return result.ToArray();
 }
}
'@
$ErrorActionPreference = 'Stop'
$taskStream = [System.IO.FileStream]::new($TaskOutput, [System.IO.FileMode]::Append,
  [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
$taskWriter = [System.IO.StreamWriter]::new($taskStream, [System.Text.UTF8Encoding]::new($false))
$taskWriter.AutoFlush = $true
try { while (!(Test-Path -LiteralPath $TaskStop)) {
  Get-Process -Name "$TaskPrefix*" -ErrorAction SilentlyContinue | ForEach-Object {
    foreach ($taskWindow in [UpdateQaWindows]::Snapshot($_.Id)) {
      $taskWriter.WriteLine(($taskWindow | ConvertTo-Json -Compress))
    }
  }
  Start-Sleep -Milliseconds 50
} } finally { $taskWriter.Dispose(); $taskStream.Dispose() }
`,
);
const installPath = owned(join(root, "installation"));
async function uninstallQa(executable) {
  const path = owned(executable).replaceAll("'", "''");
  const directory = installPath.replaceAll("'", "''");
  // NSIS requires its trailing _?=directory argument without path quoting.
  // Start-Process preserves that protocol and waits for this exact uninstaller.
  await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `
    $taskUninstaller = '${path}';
    $taskDirectory = '${directory}';
    $taskProcess = Start-Process -FilePath $taskUninstaller -ArgumentList "/S /KEEP_APP_DATA _?=$taskDirectory" -WindowStyle Hidden -Wait -PassThru;
    exit $taskProcess.ExitCode;
  `,
  ]);
}
async function waitForInstallerCleanup() {
  // NSIS can relaunch the new app before finishing its own cleanup. Starting
  // the next installer at that point hits NSIS's single-installer mutex.
  await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `
    $taskRoot = '${root.replaceAll("'", "''")}\\';
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(90);
    do {
      $taskRemaining = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -notin @('node.exe','powershell.exe','pwsh.exe') -and
        (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRoot, [StringComparison]::OrdinalIgnoreCase)) -or
         ($_.CommandLine -and $_.CommandLine.Contains($taskRoot)))
      });
      if ($taskRemaining.Count -eq 0) { exit 0 }
      if ([DateTime]::UtcNow -gt $taskDeadline) { throw 'QA installer did not finish cleanup' }
      Start-Sleep -Milliseconds 250;
    } while ($true)
  `,
  ]);
}
let watcher;
try {
  // Legacy call omits /S, exactly as v0.1.1 did. Both scenarios must restart
  // with a progress indicator, no installer wizard, and preserved settings.
  for (const legacy of [true, false]) {
    const phase = `${legacy ? "legacy" : "current"}-${Date.now()}`;
    const phasePath = owned(join(root, phase));
    await mkdir(join(phasePath, "user-data"), { recursive: true });
    await writeFile(
      join(phasePath, "user-data", "saved-setting.txt"),
      "preserved-setting",
    );
    const control = { phase, legacy, feed, target: "0.2.0", install: false };
    await writeFile(join(root, "control.json"), JSON.stringify(control));
    await run(join(root, "0.1.0", `${identity.name}-0.1.0.exe`), [
      "/S",
      `/D=${installPath}`,
    ]);
    const windowLog = owned(join(phasePath, "windows.jsonl"));
    const stopWatcher = owned(join(phasePath, "stop-watching"));
    watcher = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        watcherPath,
        "-TaskPrefix",
        identity.name,
        "-TaskOutput",
        windowLog,
        "-TaskStop",
        stopWatcher,
      ],
      { windowsHide: true, stdio: "inherit" },
    );
    requests.length = 0;
    const launched = spawn(
      owned(join(installPath, `${identity.name}.exe`)),
      [],
      { windowsHide: true, stdio: "ignore" },
    );
    const journal = owned(join(phasePath, "events.jsonl"));
    await waitFor("release discovery", async () =>
      (await records(journal)).some((event) => event.discovered),
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(
      requests.filter((name) => name.endsWith(".exe")).length,
      0,
      "Discovery must not download",
    );
    assert.ok(
      (await records(journal)).some(
        (event) => event.discovered && event.autoDownload === false,
      ),
    );
    await writeFile(
      join(root, "control.json"),
      JSON.stringify({ ...control, install: true }),
    );
    await waitFor("silent replacement and automatic restart", async () => {
      assert.ok(
        (await records(windowLog)).every((window) => !window.buttons),
        "Only a progress indicator may appear, never installer navigation",
      );
      const events = await records(journal);
      const error = events.find(
        (event) => event.error || event.status?.state === "error",
      );
      assert.equal(error, undefined, JSON.stringify(error));
      return events.some((event) => event.started === "0.2.0");
    });
    const events = await records(journal);
    assert.ok(events.some((event) => event.status?.state === "downloaded"));
    assert.ok(
      events.some(
        (event) =>
          event.started === "0.2.0" &&
          event.updated &&
          event.marker === "preserved-setting",
      ),
    );
    assert.ok(
      events.some((event) =>
        event.message?.includes(`isSilent: ${!legacy}, isForceRunAfter: true`),
      ),
    );
    assert.equal(requests.filter((name) => name.endsWith(".exe")).length, 1);
    await waitFor("old application exit", async () => launched.exitCode === 0);
    const restarted = events.find((event) => event.started === "0.2.0");
    await waitFor("new application clean exit", async () =>
      (await records(journal)).some(
        (event) => event.exited === "0.2.0" && event.exitCode === 0,
      ),
    );
    await waitFor("new application process exit", async () => {
      try {
        process.kill(restarted.pid, 0);
        return false;
      } catch (error) {
        if (error.code === "ESRCH") return true;
        throw error;
      }
    });
    await waitForInstallerCleanup();
    const visibleWindows = await records(windowLog);
    assert.ok(
      visibleWindows.some((window) => window.progress && !window.buttons),
      "Silent installation must display a progress indicator",
    );
    assert.ok(
      visibleWindows.every((window) => !window.buttons),
      "No installation wizard or confirmation buttons may appear",
    );
    await writeFile(stopWatcher, "stop");
    const watcherExit =
      watcher.exitCode ??
      (await new Promise((resolve) => watcher.once("exit", resolve)));
    assert.equal(
      watcherExit,
      0,
      "Native window observer must complete without errors",
    );
    watcher = undefined;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const uninstaller = (await readdir(installPath)).find((name) =>
      /^Uninstall .*\.exe$/i.test(name),
    );
    assert.ok(uninstaller, "QA uninstaller missing");
    await uninstallQa(join(installPath, uninstaller));
    await waitForInstallerCleanup();
    await waitFor(
      "QA uninstall",
      async () =>
        !(await access(join(installPath, `${identity.name}.exe`)).then(
          () => true,
          () => false,
        )),
    );
    console.log(
      `PASS ${phase}: explicit download, progress indicator without wizard, unattended install, restart to 0.2.0, setting preserved`,
    );
  }
  console.log(`Native acceptance artifacts: ${root}`);
} finally {
  watcher?.kill();
  await new Promise((resolve) => server.close(resolve));
  // Only terminate test processes whose actual executable is inside this owned
  // workspace directory. Never target Irwin by its production process name.
  await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `
    $taskRoot = '${root.replaceAll("'", "''")}\\';
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRoot, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `,
  ]);
  // Use only the isolated QA app's uninstaller; preserve diagnostic artifacts.
  const names = await readdir(installPath).catch(() => []);
  const uninstall = names.find((name) => /^Uninstall .*\.exe$/i.test(name));
  if (uninstall)
    await uninstallQa(join(installPath, uninstall)).catch(() => {});
}
