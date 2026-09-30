# Auto-update release contract

Irwin uses `electron-updater` 6.8.9 and the lockfile-resolved `electron-builder`
26.15.3. Keep the app ID (`dev.mongoworkbench.desktop`), installed application
identity, publisher/team identity, and GitHub repository stable across upgrades.
The runtime checks for releases; downloading and installing require user action.

## Platform payloads

- Windows: NSIS `.exe`, its `.blockmap`, and `latest.yml` for x64.
- Linux: `.deb` and `latest-linux.yml` for x64. The native Debian package updater
  may require administrative authentication. Only compatible installed Debian
  packages are eligible; unsupported distribution/installation modes use manual
  release links. Test the actual privilege prompt and replacement on Debian/Ubuntu.
- macOS: consistently signed `.zip` update payloads for both x64 and arm64,
  `.dmg` bootstrap installers, blockmaps emitted by the builder, and the combined
  `latest-mac.yml`. The recommended Developer ID path is notarized; the separate
  self-signed experimental path below is not. A DMG alone is insufficient for
  Squirrel.Mac updates.

Upload the exact generated binaries and metadata together to the matching GitHub
release. Do not rename payloads, edit their hashes, or regenerate metadata from
another build. Run `scripts/verify-update-metadata.mjs` and the release manifest
checks before publication. The candidate workflows only upload Actions artifacts;
publication remains a separate maintainer decision. Do not publish unsigned
macOS candidates over a signed release's feed.

## Unsigned macOS candidates remain manual

Normal packaging and `Desktop packages` embed `irwinMacAutoUpdates: false` in the
packaged package.json. Unsigned/ad-hoc macOS builds show manual release guidance,
even if an update ZIP happens to exist. Installing the first updater-enabled,
signed release manually is required for existing unsigned installations. A
metadata flag cannot retrofit trusted identity onto an already-installed app.

## Opt-in signed macOS candidate

The manually dispatched `Signed macOS update candidate` workflow uses the
`macos-release` environment. A maintainer must configure that environment and
its approvals separately; this implementation does not create credentials or
secrets. Use an Apple Developer Program account and a **Developer ID Application**
certificate, not an Apple Development or Mac App Store distribution certificate.
The workflow expects these environment secrets:

| Secret                        | Purpose                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `MAC_CSC_LINK`                | Base64-encoded exported `.p12` signing certificate/private key, provided as builder's `CSC_LINK` |
| `MAC_CSC_KEY_PASSWORD`        | Password for that `.p12`, provided as `CSC_KEY_PASSWORD`                                         |
| `APPLE_ID`                    | Apple account used for notarization                                                              |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password used by Apple's notary service                                             |
| `APPLE_TEAM_ID`               | Developer team owning the signing certificate                                                    |

Never commit these values or enter them into chat. Configure secrets through the
repository's secure settings yourself. Protect the release environment, restrict
workflow/ref execution to reviewed code, and rotate credentials through your
normal security process. Running the workflow submits the application to Apple's
notarization service. Only authorize that run when ready for this submission.

`IRWIN_SIGNED_MAC_RELEASE=1 pnpm package --publish never` on macOS is the local
entry point, with the corresponding environment variables already securely
supplied. This restricted entry point rejects arbitrary builder arguments and
requires all signing/notarization credentials. It forces code signing, hardened
runtime, notarization and the verification hook. The hook checks the Developer ID
team, strict nested signatures, Gatekeeper assessment and a valid stapled ticket
before the ZIP/DMG packaging completes. Signing or notarization failure fails the
build; the workflow uploads no candidate on failure.

The signed app embeds `irwinMacAutoUpdates: true` before signing so the metadata
itself is signed. It is considered release-ready only after these native checks
succeed. Do not distribute partial build directories left after failed builds.
The runtime uses the installed app's packaged flag, not an environment variable
or a remote release claim. Keep the Developer ID/team stable across updates.

## Release validation and bootstrap

1. Build a higher semantic version from reviewed code. Verify installer hashes
   and updater metadata before publication. Keep both mac architectures together.
2. Install the signed bootstrap DMG into `/Applications` on both Intel and Apple
   Silicon macOS 14+ systems. Do not test replacement while running from the DMG.
3. Publish the next signed version and matching feed as a controlled test release.
   From the previous installed signed version, check, download, install/restart,
   and confirm the installed version changed and saved settings remain intact.
4. Verify cancellation, offline/check/download failure, a failed hash, an invalid
   signature, and retry behavior. Confirm unsigned candidates stay manual.
5. Repeat install/restart verification on Windows NSIS and a supported installed
   Linux Debian package, including elevation and persistence of user data.

**Evidence boundary:** unit tests and source inspection verify policy/configuration
only. They do not establish native signing, notarization, Gatekeeper acceptance,
privilege prompts, Squirrel replacement, or successful cross-version installation.
Those require real credentials, native machines and two published versions. Until
that smoke matrix is recorded, describe this as implemented but native-unverified.
See [release checklist](RELEASE_CHECKLIST.md) for recording results.

## References

- [Electron autoUpdater platform requirements](https://www.electronjs.org/docs/latest/api/auto-updater)
- [electron-builder auto-update guide](https://www.electron.build/v26/docs/features/auto-update/)
- [electron-builder v26 macOS options](https://www.electron.build/v26/docs/mac/)
- [Apple notarization overview](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

Implementation was checked against installed builder 26.15.3's
`MacTargetHelper.getNotarizeOptions`, `notarizeIfProvided`, and `afterSign` event
ordering. In that version `notarize: true` alone can skip notarization when
credentials are missing, which is why the wrapper requires credentials and the
hook independently validates the stapled ticket.

## Experimental self-signed continuity (no Apple account)

A separate opt-in scaffold accepts an **existing, persistent maintainer signing
certificate**. It does not require an App Store release or Apple Developer
membership. It is not equivalent to Developer ID trust and is **not yet proven to
update successfully on a Mac**. Ad-hoc signatures are unsuitable: their identity
changes with the binary. Keep unsigned normal candidates manual.

Set `IRWIN_SELF_SIGNED_MAC_RELEASE=1` instead of `IRWIN_SIGNED_MAC_RELEASE=1`, supply
existing `CSC_LINK`/`CSC_KEY_PASSWORD`, and run `pnpm package --publish never` on
macOS. No workflow is provided for this experimental path until the native
bootstrap and two-version smoke test have passed. The wrapper also requires:

- `IRWIN_MAC_CERT_SHA1`: exactly 40 hexadecimal characters identifying the existing
  certificate's SHA-1 fingerprint. This is Apple's certificate-identity pin, not
  an artifact integrity hash; update artifacts still use SHA-512.
- `IRWIN_MAC_DR_SHA256`: SHA-256 of the exact trimmed `designated => ...` line
  printed by `codesign --display -r-` for a maintainer-prepared reference Irwin app
  signed with that same persistent certificate. Hash the UTF-8 line with **no
  trailing newline**. Preparing that reference is a separate native prerequisite;
  do not invent a digest, use the unsigned app's requirement, or derive a new
  accepted value on every build merely to make a failed check pass.

The hook verifies the full signature, evaluates a requirement binding the Irwin
bundle identifier to the exact certificate leaf, and compares the main app's
requirement digest. The embedded requirement must itself include the pinned
certificate hash with no alternate-signer `or` clause. Rotation/loss of the key or
any requirement change needs a deliberate manual migration. The scaffold does
not generate, install, trust or configure a certificate, persistent credentials,
or keychain settings. It deliberately does not pass `mac.requirements`: builder
26.15.3 applies that option to every nested helper, whose bundle IDs differ.
Builder's default per-bundle requirements remain intact.

The pinned builder explicitly supports non-Apple identities as a fallback in
`findIdentity`; the wrapper selects the fingerprint. Native keychain discovery,
helper signing, hardened-runtime loading and Squirrel replacement still need
verification and can fail. Packaging must fail rather than silently falling back
to ad-hoc signing or removing continuity checks.

This mode disables notarization and does **not** claim Gatekeeper acceptance.
macOS may block the initial download or later launches; users must make their
own trust decisions through supported macOS UI. Do not remove quarantine, disable
Gatekeeper or change trust/security settings as part of this flow. First install
the maintainer's reference/bootstrap manually, then validate an actual update
between two versions with the same certificate and requirement on Intel and Apple
Silicon. Record the download/install/restart and OS security-prompt outcomes before
calling this supported. Never mix Developer ID and self-signed candidates on a
production feed without reviewing migration compatibility.

The rationale is Squirrel's use of the installed app's designated requirement to
validate the replacement, rather than a bundle ID alone. This is a source-based
possibility, not proof for this packaged Electron build:
[Squirrel code-signature implementation](https://github.com/Squirrel/Squirrel.Mac/blob/main/Squirrel/SQRLCodeSignature.m),
[Apple signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
[Apple code-signing technical note](https://developer.apple.com/library/archive/technotes/tn2206/).
