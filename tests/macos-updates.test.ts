import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error packaging policy is a Node ESM build script
import { packagingArgs } from "../scripts/package.mjs";

const env = {
  IRWIN_SIGNED_MAC_RELEASE: "1",
  CSC_LINK: "test-certificate",
  CSC_KEY_PASSWORD: "test-password",
  APPLE_ID: "test@example.invalid",
  APPLE_APP_SPECIFIC_PASSWORD: "test-only",
  APPLE_TEAM_ID: "TESTTEAM",
};
const text = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

describe("macOS updater release gate", () => {
  it("keeps ordinary builds manual and includes both update ZIP architectures", () => {
    const config = JSON.parse(text("package.json")).build;
    expect(config.extraMetadata.irwinMacAutoUpdates).toBe(false);
    expect(config.mac.target).toEqual(
      expect.arrayContaining([
        { target: "dmg", arch: ["arm64", "x64"] },
        { target: "zip", arch: ["arm64", "x64"] },
      ]),
    );
    expect(packagingArgs([], "darwin", {}).at(-1)).toBe(
      "--config.extraMetadata.irwinMacAutoUpdates=false",
    );
  });
  it("requires macOS and every signing/notarization prerequisite", () => {
    expect(() => packagingArgs([], "linux", env)).toThrow("require macOS");
    for (const key of [
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "APPLE_ID",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ]) {
      expect(() => packagingArgs([], "darwin", { ...env, [key]: "" })).toThrow(
        key,
      );
    }
    expect(() =>
      packagingArgs([], "darwin", {
        ...env,
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
      }),
    ).toThrow("cannot disable");
  });
  it("rejects overrides and forces signing, notarization, verification and no publication", () => {
    expect(() =>
      packagingArgs(["--config.mac.notarize=false"], "darwin", env),
    ).toThrow("accepts only");
    const args = packagingArgs(["--publish", "never"], "darwin", env);
    expect(args).toEqual(
      expect.arrayContaining([
        "--publish",
        "never",
        "--config.forceCodeSigning=true",
        "--config.mac.notarize=true",
        "--config.mac.hardenedRuntime=true",
        "--config.afterSign=scripts/verify-signed-mac.cjs",
        "--config.extraMetadata.irwinMacAutoUpdates=true",
      ]),
    );
  });
  it("retains the pinned Windows Electron copy workaround", () => {
    expect(packagingArgs([], "win32", {})).toContain(
      "--config.electronDist=node_modules/electron/dist",
    );
  });
});

describe("experimental existing-certificate macOS release", () => {
  const self = {
    IRWIN_SELF_SIGNED_MAC_RELEASE: "1",
    CSC_LINK: "existing-p12",
    CSC_KEY_PASSWORD: "test-password",
    IRWIN_MAC_CERT_SHA1: "a".repeat(40),
    IRWIN_MAC_DR_SHA256: "b".repeat(64),
  };
  it("requires certificate and requirement continuity pins and rejects mixed modes", () => {
    for (const key of Object.keys(self).filter(
      (key) => key !== "IRWIN_SELF_SIGNED_MAC_RELEASE",
    )) {
      expect(() =>
        packagingArgs([], "darwin", { ...self, [key]: "" }),
      ).toThrow();
    }
    expect(() => packagingArgs([], "linux", self)).toThrow("require macOS");
    expect(() =>
      packagingArgs([], "darwin", { ...self, IRWIN_SIGNED_MAC_RELEASE: "1" }),
    ).toThrow("exactly one");
    expect(() =>
      packagingArgs(["--config.mac.identity=-"], "darwin", self),
    ).toThrow("accepts only");
  });
  it("uses existing pinned identity without Apple credentials or notarization", () => {
    const args = packagingArgs([], "darwin", self);
    expect(args).toContain(`--config.mac.identity=${"A".repeat(40)}`);
    expect(args).toContain("--config.mac.notarize=false");
    expect(args).toContain("--config.forceCodeSigning=true");
    expect(args).toContain(
      "--config.afterSign=scripts/verify-self-signed-mac.cjs",
    );
    expect(args).toContain("--config.extraMetadata.irwinMacAutoUpdates=true");
    expect(args.join(" ")).not.toContain("requirements=");
  });
});

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const { validateDesignatedRequirement } = createRequire(import.meta.url)(
  "../scripts/verify-self-signed-mac.cjs",
);

describe("self-signed designated requirement validation", () => {
  const fingerprint = "a".repeat(40);
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const strong = `designated => identifier "dev.mongoworkbench.desktop" and anchor H"${fingerprint}"`;
  it("accepts exactly pinned persistent certificate identity and stable requirement", () => {
    expect(() =>
      validateDesignatedRequirement(strong, fingerprint, digest(strong)),
    ).not.toThrow();
    expect(() =>
      validateDesignatedRequirement(strong, fingerprint, "b".repeat(64)),
    ).toThrow("changed");
  });
  it("rejects identifier-only, alternate signers, ad-hoc and other certificates even when their digest is pinned", () => {
    for (const weak of [
      'designated => identifier "dev.mongoworkbench.desktop"',
      `${strong} or true`,
      `${strong} and cdhash H"${"c".repeat(40)}"`,
      strong.replace(fingerprint, "b".repeat(40)),
      strong.replace("dev.mongoworkbench.desktop", "other.app"),
    ]) {
      expect(() =>
        validateDesignatedRequirement(weak, fingerprint, digest(weak)),
      ).toThrow();
    }
  });
});
