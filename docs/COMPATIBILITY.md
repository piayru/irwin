# Compatibility and validation status

Last reviewed: 2026-10-15. A configured build target is not a promise of native desktop support. The maintainer will complete the manual acceptance checklist before changing a platform to **Validated**.

The release tooling now provides a repeatable two-version Windows installer
check and a cross-platform native evidence recorder. See
[native desktop evidence](TESTING.md#native-desktop-evidence). Adding these
commands does not change the validation status below: exact downloaded-artifact
macOS/Ubuntu acceptance and live Cosmos DB acceptance still require actual
target environments. Packaging/CI results must be recorded for the exact
release commit and installer hashes, separately from earlier local candidates.

The earlier 2026-10-15 baseline passed 470 automated tests across 78 files, all 8
required renderer scenarios in Linux Chromium, and all 59 Windows Electron
desktop checks against a production build. These use disposable application and
database fixtures. They do not establish exact downloaded-installer installation,
older-release upgrade, signing prompts or native macOS/Ubuntu acceptance.

The subsequent six-feature recheck fixed long-collection Explain record naming
and strict calendar validation for typed date parameters. It passed 476 tests
across 78 files, 10 Electron developer workflow checks, all 59 Windows desktop
checks, and 27 WSL Docker deployment checks with three verified cleanups.
The real renderer notification scenario also passed manual dismissal and
five-second expiry for success and errors. These checks used a fresh source
build and isolated data; exact native installer and cloud-account acceptance
remain separate requirements.

## Desktop operating systems

| Platform / architecture         | Packaging target      | Native install and launch                                                                                                                                                                                                                                                | Current status                               |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Windows 11 x64                  | NSIS installer        | The 2026-10-06 candidate passes package verification, 59 desktop checks and 9 developer workflow checks. Isolated native install/reinstall passed; uninstall was manually verified. Clean-machine automation, download prompts and older-release upgrade remain pending. | Preview candidate; partial native acceptance |
| Ubuntu 24.04 x64                | Debian package        | No native Ubuntu Desktop acceptance recorded. WSL or container checks do not count as desktop validation.                                                                                                                                                                | Pending maintainer validation                |
| Ubuntu 22.04 x64                | Debian package target | No native desktop acceptance recorded.                                                                                                                                                                                                                                   | Not validated                                |
| macOS 14+ x64 (Intel)           | DMG target            | No DMG installation or native desktop acceptance recorded.                                                                                                                                                                                                               | Not validated                                |
| macOS 14+ arm64 (Apple Silicon) | DMG target            | Maintainer reports DMG installation and launch on an M3 MacBook Air; exact macOS version, DMG architecture/hash, Gatekeeper steps, and remaining workflows were not recorded.                                                                                            | Partial native acceptance                    |

The configured package targets are Windows x64, Linux x64 `.deb`, and macOS x64/arm64 `.dmg`, distributed as direct GitHub downloads. Preview releases do not require paid signing or store enrollment. Linux packaging metadata alone does not establish compatibility with every Ubuntu release or desktop environment. macOS release readiness requires recording signature/notarization status and checking Gatekeeper behavior for the exact downloaded artifact, including the per-app launch exception when appropriate.

On 2026-09-29 the maintainer confirmed successful DMG installation and launch on an M3 MacBook Air (Apple Silicon). The exact macOS version, DMG filename and hash, running process architecture, and first-launch Gatekeeper steps were not provided. This records native DMG installation and launch on that hardware; it does not establish validation of both DMG architectures or the remaining database, upgrade, uninstall, and desktop workflows.

On 2026-09-29 a local Windows candidate passed package verification and all 59 packaged desktop checks, with no reported errors or unverified checks. The installer and bundled executable are unsigned. The automated suite at that build passed 234 tests across 58 files, including XLSX read-back, mongosh SRV/TXT resolution, production-license inventory, and normal GUI shutdown. These checks use disposable MongoDB data and do not establish clean-machine installation or downloaded-installer prompt behavior.

### Local candidate evidence

The newer **2026-10-06 / 0.1.2** candidate, checksum, deployment results and
native installation limitations are recorded in
[the developer workflow acceptance record](acceptance/2026-10-06-developer-workflows.md).
The table below retains the older 0.1.0 candidate as historical evidence.

This candidate is retained locally and has not been published. It predates subsequent repository metadata, build-tool, UI, and source organization changes. Build a new candidate from the source to be released and record its Git commit and checksums before distributing it.

| Item              | Recorded value                                                                 |
| ----------------- | ------------------------------------------------------------------------------ |
| Date / build host | 2026-09-29; Windows x64, OS build `10.0.26200.0`                               |
| Installer         | `Irwin-0.1.0-win-x64.exe`; 251,715,485 bytes                                   |
| SHA-256           | `0098a31ea0928a7ac48a2bc50561f5b2a4fdc6ec4b2c38e0bb83f0bc348bcbd5`             |
| Runtime / tools   | Node 24.14.0; Electron 44.3.0; MongoDB Database Tools 100.18.0                 |
| Signing           | Installer and bundled executable: `NotSigned`                                  |
| Package checks    | No package verification diagnostics or unresolved installed dependency notices |
| Desktop checks    | 59 passed; no reported errors or unverified checks                             |

Installer commands, architecture selection, upgrades, and uninstall behavior are documented in the [installation guide](INSTALLATION.md). Download Preview installers from [GitHub Releases](https://github.com/piayru/irwin/releases); each release records automated package verification separately from pending native desktop acceptance.

## MongoDB and service compatibility

On 2026-10-06, WSL Docker deployments using local `mongo:8.0` reported server
version **8.0.29**. Standalone, password-authenticated and single-node replica-set
scenarios each passed nine checks (27 total), followed by three verified cleanup
checks. This covers disposable BSON fixtures, paging/cancellation, read-only
aggregation, Explain/index metadata, nested write-stage rejection, production
write protection, conditional field updates and reconnect. It does not establish
cross-host failover, sharded-cluster, Atlas or Cosmos acceptance. See
[the acceptance record](acceptance/2026-10-06-developer-workflows.md) and
[repeatable test commands](TESTING.md#developer-workflow-and-deployment-acceptance).

| Service / feature     | Evidence and limits                                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB 8.0.18        | Local MongoDB integration and desktop tests recorded.                                                                                                                                                                                         |
| MongoDB 6.0 / 7.0     | Compatibility is a goal; full integration suite not run against these versions.                                                                                                                                                               |
| Atlas / `mongodb+srv` | URI and driver paths are implemented; no dedicated Atlas account acceptance recorded. Atlas user and role management is not provided by this application.                                                                                     |
| Replica set           | Single-node discovery and reconnect checked; cross-host elections not checked.                                                                                                                                                                |
| `mongos`              | Standard driver connection path; no real sharded cluster acceptance recorded.                                                                                                                                                                 |
| TLS / SSH             | Local checks cover trusted and invalid TLS cases, SSH passwords and encrypted keys, host-key fingerprints, and SSH plus TLS hostname validation. X.509 client certificate login is not fully validated.                                       |
| Cosmos DB for MongoDB | Provider, partition-key mapping, and documented capability restrictions are implemented; no live account acceptance recorded. User and role management uses Azure administration. BSON restore and SSH+TLS Database Tools paths are disabled. |

For detailed service constraints, see the [user guide](USER_GUIDE.md) and the [MongoDB compatibility references](https://www.mongodb.com/docs/database-tools/mongorestore/mongorestore-compatibility-and-installation/) and [Cosmos API support matrix](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-70).

## What counts as validation

Mark a desktop target **Validated** only after the maintainer records the native OS version and architecture, installer name and SHA-256, installation and first launch, core database workflow against disposable test data, upgrade behavior, uninstall behavior, and signing/Gatekeeper results where applicable. Use [the release checklist](RELEASE_CHECKLIST.md) and keep the evidence with the release.

Application-level tests and CI builds are useful checks, but do not replace installation and GUI acceptance on the target operating system.
