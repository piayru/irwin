import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Parse with the same YAML implementation as our pinned updater, including under
// pnpm's isolated dependency layout. No separate parser version can drift here.
const require = createRequire(import.meta.url);
const updaterRequire = createRequire(
  require.resolve("electron-updater/package.json"),
);
const { load, JSON_SCHEMA } = updaterRequire("js-yaml");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}`);
  return value;
}

const root = resolve(
  argument("--root", fileURLToPath(new URL("..", import.meta.url))),
);
const directory = resolve(argument("--directory", join(root, "release")));
const platform = argument("--platform", process.platform);
const targets = {
  win32: { metadata: "latest.yml", suffix: "win-x64.exe" },
  linux: { metadata: "latest-linux.yml", suffix: "linux-x64.deb" },
  darwin: { metadata: "latest-mac.yml" },
};
const platforms = platform === "all" ? Object.keys(targets) : [platform];
if (platforms.some((name) => !targets[name]))
  throw new Error("--platform must be win32, linux, darwin, or all");
const { version } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);

for (const name of platforms) {
  const { metadata, suffix } = targets[name];
  const expectedFile = `Irwin-${version}-${suffix}`;
  const info = load(await readFile(join(directory, metadata), "utf8"), {
    schema: JSON_SCHEMA,
  });
  if (!info || typeof info !== "object" || info.version !== version)
    throw new Error(
      `${metadata}: version must match package.json (${version})`,
    );
  // Fail closed when packaging targets change. macOS requires both native
  // architectures and ZIP payloads for Squirrel; DMGs remain manual installers.
  const expectedFiles =
    name === "darwin"
      ? ["x64", "arm64"].flatMap((arch) =>
          ["zip", "dmg"].map((ext) => `Irwin-${version}-mac-${arch}.${ext}`),
        )
      : [expectedFile];
  if (!Array.isArray(info.files) || info.files.length !== expectedFiles.length)
    throw new Error(
      `${metadata}: expected ${name === "darwin" ? "both macOS ZIPs and DMGs" : "exactly one x64 installer entry"}`,
    );
  const urls = info.files.map((entry) => entry?.url);
  if (
    new Set(urls).size !== urls.length ||
    expectedFiles.some((file) => !urls.includes(file)) ||
    !expectedFiles.includes(info.path) ||
    (name === "darwin" && !info.path.endsWith(".zip"))
  )
    throw new Error(
      `${metadata}: url and path must reference ${expectedFiles.join(", ")}`,
    );
  const primary = info.files.find((entry) => entry.url === info.path);
  if (info.sha512 !== primary.sha512)
    throw new Error(`${metadata}: missing or inconsistent base64 SHA512`);
  for (const entry of info.files) {
    if (
      typeof entry.sha512 !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512)
    )
      throw new Error(`${metadata}: missing or inconsistent base64 SHA512`);
    const installerPath = join(directory, entry.url);
    const details = await stat(installerPath);
    if (
      !details.isFile() ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      entry.size !== details.size
    )
      throw new Error(
        `${metadata}: installer byte size does not match: ${entry.url}`,
      );
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(installerPath))
      hash.update(chunk);
    if (hash.digest("base64") !== entry.sha512)
      throw new Error(
        `${metadata}: SHA512 does not match exact installer bytes: ${entry.url}`,
      );
    process.stdout.write(
      `Verified ${metadata} -> ${entry.url} (${details.size} bytes, SHA512 matched)\n`,
    );
  }
}
