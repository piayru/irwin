const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { join } = require("node:path");

// Experimental continuity verification, NOT Gatekeeper trust or notarization.
// Never apply a shared main-app DR to helpers: builder's mac.requirements option
// applies globally. Preserve per-bundle requirements and pin the main app's DR.
module.exports = async function verifySelfSignedMac(context) {
  if (context.electronPlatformName !== "darwin")
    throw new Error("Expected macOS signing context");
  const fingerprint = process.env.IRWIN_MAC_CERT_SHA1 || "";
  const expectedDR = process.env.IRWIN_MAC_DR_SHA256 || "";
  if (
    !/^[a-fA-F0-9]{40}$/.test(fingerprint) ||
    !/^[a-fA-F0-9]{64}$/.test(expectedDR)
  ) {
    throw new Error("Missing pinned certificate and designated requirement");
  }
  const app = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  execFileSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
    { stdio: "inherit" },
  );
  // Evaluating the exact leaf pin also rejects ad-hoc signatures. Do not relax
  // this to a bundle identifier alone, which another signer could impersonate.
  execFileSync(
    "codesign",
    [
      "--verify",
      "--strict",
      "-R",
      `identifier "dev.mongoworkbench.desktop" and certificate leaf = H"${fingerprint.toLowerCase()}"`,
      app,
    ],
    { stdio: "inherit" },
  );
  const result = spawnSync("codesign", ["--display", "-r-", app], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0)
    throw new Error("Cannot inspect designated requirement");
  const lines = `${result.stdout}\n${result.stderr}`.split("\n");
  const requirements = lines.filter((line) =>
    line.startsWith("designated => "),
  );
  if (requirements.length !== 1)
    throw new Error("Expected exactly one designated requirement");
  validateDesignatedRequirement(
    requirements[0].trim(),
    fingerprint,
    expectedDR,
  );
};

function validateDesignatedRequirement(requirement, fingerprint, expectedDR) {
  if (
    !/^[a-fA-F0-9]{40}$/.test(fingerprint) ||
    !/^[a-fA-F0-9]{64}$/.test(expectedDR)
  ) {
    throw new Error("Invalid continuity pins");
  }
  const certificatePin = new RegExp(
    `(?:certificate (?:leaf|0)|anchor(?: root)?)\\s*(?:=\\s*)?H"${fingerprint}"`,
    "i",
  );
  if (
    !certificatePin.test(requirement) ||
    /\bor\b|\bcdhash\b/i.test(requirement) ||
    !requirement.includes('identifier "dev.mongoworkbench.desktop"')
  ) {
    throw new Error(
      "Designated requirement must bind the app identifier and pinned certificate without alternate signers or cdhash",
    );
  }
  const digest = createHash("sha256").update(requirement.trim()).digest("hex");
  if (digest !== expectedDR.toLowerCase())
    throw new Error(
      "Designated requirement changed; manual migration/review required",
    );
}
module.exports.validateDesignatedRequirement = validateDesignatedRequirement;
