const { execFileSync, spawnSync } = require("node:child_process");
const { join } = require("node:path");

// Builder 26.15.3 calls afterSign after its notarization/stapling and before
// generating ZIP/DMG artifacts. Any failure aborts packaging, not just upload.
module.exports = async function verifySignedMac(context) {
  if (context.electronPlatformName !== "darwin")
    throw new Error("Expected macOS signing context");
  const app = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  execFileSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
    { stdio: "inherit" },
  );
  const signature = spawnSync("codesign", ["--display", "--verbose=4", app], {
    encoding: "utf8",
  });
  if (
    signature.error ||
    signature.status !== 0 ||
    !/^Authority=Developer ID Application:/m.test(signature.stderr) ||
    !signature.stderr
      .split("\n")
      .includes(`TeamIdentifier=${process.env.APPLE_TEAM_ID}`)
  ) {
    throw new Error(
      "Release must be signed by the configured Developer ID team",
    );
  }
  execFileSync("spctl", ["--assess", "--type", "execute", "--verbose=2", app], {
    stdio: "inherit",
  });
  execFileSync("xcrun", ["stapler", "validate", app], { stdio: "inherit" });
};
