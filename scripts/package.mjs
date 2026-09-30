import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Exported for platform-independent policy tests; importing never starts a build.
export function packagingArgs(argv, platform, env) {
  const signedMac = env.IRWIN_SIGNED_MAC_RELEASE === "1";
  const selfSignedMac = env.IRWIN_SELF_SIGNED_MAC_RELEASE === "1";
  if (signedMac && selfSignedMac)
    throw new Error("Choose exactly one macOS signing mode");
  if (selfSignedMac) {
    if (platform !== "darwin")
      throw new Error("Self-signed macOS releases require macOS");
    if (argv.length && argv.join(" ") !== "--publish never") {
      throw new Error("Self-signed macOS release accepts only --publish never");
    }
    for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD"]) {
      if (!env[key]?.trim())
        throw new Error(`Self-signed macOS release requires ${key}`);
    }
    if (!/^[a-fA-F0-9]{40}$/.test(env.IRWIN_MAC_CERT_SHA1 || "")) {
      throw new Error(
        "IRWIN_MAC_CERT_SHA1 must pin the existing certificate's 40-character SHA-1 fingerprint",
      );
    }
    if (!/^[a-fA-F0-9]{64}$/.test(env.IRWIN_MAC_DR_SHA256 || "")) {
      throw new Error(
        "IRWIN_MAC_DR_SHA256 must pin the stable designated requirement's SHA-256 digest",
      );
    }
    return [
      resolve("node_modules/electron-builder/cli.js"),
      "--mac",
      "--publish",
      "never",
      "--config.forceCodeSigning=true",
      "--config.mac.notarize=false",
      "--config.mac.hardenedRuntime=true",
      `--config.mac.identity=${env.IRWIN_MAC_CERT_SHA1.toUpperCase()}`,
      "--config.afterSign=scripts/verify-self-signed-mac.cjs",
      "--config.extraMetadata.irwinMacAutoUpdates=true",
    ];
  }
  if (signedMac) {
    if (platform !== "darwin")
      throw new Error("Signed macOS releases require macOS");
    // Keep this release path closed to arbitrary overrides of the signing policy.
    if (argv.length && argv.join(" ") !== "--publish never") {
      throw new Error("Signed macOS release accepts only --publish never");
    }
    for (const key of [
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "APPLE_ID",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ]) {
      if (!env[key]?.trim())
        throw new Error(`Signed macOS release requires ${key}`);
    }
    if (env.CSC_IDENTITY_AUTO_DISCOVERY === "false") {
      throw new Error(
        "Signed macOS release cannot disable signing identity discovery",
      );
    }
    return [
      resolve("node_modules/electron-builder/cli.js"),
      "--mac",
      "--publish",
      "never",
      "--config.forceCodeSigning=true",
      "--config.mac.notarize=true",
      "--config.mac.hardenedRuntime=true",
      "--config.afterSign=scripts/verify-signed-mac.cjs",
      "--config.extraMetadata.irwinMacAutoUpdates=true",
    ];
  }
  // Even when a developer happens to have a signing identity, normal candidates
  // must not advertise updater eligibility without the verified release path.
  return [
    resolve("node_modules/electron-builder/cli.js"),
    ...argv,
    ...(platform === "win32"
      ? ["--config.electronDist=node_modules/electron/dist"]
      : []),
    "--config.extraMetadata.irwinMacAutoUpdates=false",
  ];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const child = spawn(
      process.execPath,
      packagingArgs(process.argv.slice(2), process.platform, process.env),
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.once("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
    child.once("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
