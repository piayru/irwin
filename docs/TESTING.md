# Testing Irwin

Run commands from the repository root after completing the development setup in [CONTRIBUTING.md](../CONTRIBUTING.md). Tests use disposable MongoDB instances and isolated application profiles. Do not substitute real database URIs, credentials, or your normal application data directory.

## Automated regression suite

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm perf:bundle
```

Vitest runs `tests/**/*.test.ts`, including database integration, BSON and CSV round trips, JSON/JSONL parsing after desktop compilation, read-only enforcement, AI context redaction and output validation, connection safety, application state, and release tooling. MongoDB 8.0.18 test binaries are downloaded into the ignored `.runtime/mongodb/` cache when needed. Network access is required for the first download.

The certificates and private key in `tests/fixtures/` are intentionally public, localhost-only test fixtures. `scripts/create-test-certificates.py` regenerates them using Python's `cryptography` package; do not use them for any real service.

## Electron scenarios

Build first with `pnpm build`, then run the scenario relevant to your change on a native desktop with a graphical session. These are standalone Playwright Electron scripts, separate from `pnpm test`; run them sequentially to avoid clipboard and window-focus interference.

| Command                                | Coverage                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/e2e/desktop.mjs`           | Connections, query/results workflow, export/import, mongosh cancellation and drafts, destructive-action confirmations, layout, preferences, and normal shutdown |
| `node tests/e2e/aggregation.mjs`       | Pipeline editing, stage preview, resizing, Explain display, export, and empty results                                                                           |
| `node tests/e2e/query-controls.mjs`    | Sort cycles, resizable query fields, formatting without execution, projection, and narrow-window layout                                                         |
| `node tests/e2e/initial-table-fit.mjs` | Legacy workspace state, initial column sizing, and sizing stability when querying again                                                                         |
| `node tests/e2e/table-workspace.mjs`   | Single-cell selection/copy, frozen-column alignment, long field names, nested fields, independent tabs, and remembered layout                                   |
| `node tests/e2e/saved-queries.mjs`     | Saving/editing, cross-connection application without execution, paging, restart persistence, and deletion confirmation                                          |
| `node tests/e2e/preferences.mjs`       | Live preview and cancel rollback, settings persistence, reset scope, notifications, query timeout, and compact layout                                           |
| `node tests/e2e/users-roles.mjs`       | Authentication, user/role changes, permission restrictions, read-only controls, redacted receipts, and both UI languages                                        |

The Windows packaging workflow runs the desktop scenario against its unpacked candidate using `WORKBENCH_EXECUTABLE`. For local source checks, leave that variable unset. Reports and screenshots are written only to ignored `.runtime/` storage. A nonzero exit indicates a failed scenario; review any `unverified` entries before recording acceptance, especially when the native clipboard is unavailable.

Native scenarios close the actual BrowserWindow and require both window closure
within 10 seconds and process exit with code 0 within another 30 seconds.
The shared close helper lets Playwright detach its debugger through the normal
quit lifecycle; it does not issue another quit RPC during teardown. Blocked
window closure, a surviving process, and nonzero or signalled exits still fail
acceptance. `tests/close-electron.test.ts` covers these boundaries and a closing
inspector that never replies to its final RPC.

`pnpm exec playwright install chromium` followed by `pnpm test:e2e:critical`
runs the required renderer checks sequentially: release notes/download consent,
progress and verification, restart confirmation and draft failure, Count state,
independent collection tabs, import refresh, five-second cell notices and BSON
constructor document saves. Each
check has a six-minute deadline, bounded process cleanup and its own log. The
combined `.runtime/renderer-checks.json` records the product version, source
commit, whether the source stayed clean and unchanged, and individual outcomes. This is required by draft-release staging; a selected
single check (`--only query-count`) is useful locally but is insufficient for
a release. Reports from dirty or changed source remain useful locally but cannot
be staged for release. These fixtures do not install software or access a live database.

These scenarios do not validate every cloud service, AI provider, operating system, or installation path. Complete [native release acceptance](RELEASE_CHECKLIST.md) using the exact installer to be distributed.

## Update workflow regression

`pnpm test` covers update discovery, single-click download/install, duplicate
clicks, cached/deferred installation, failed feeds/downloads, restart handshakes,
renderer input locking, platform eligibility, and release metadata integrity.

`node tests/e2e/updates.mjs` exercises the actual update dialog in a headless
Chromium component harness. Install Playwright's Chromium or set `CHROMIUM_PATH`
to an existing Chromium executable. It checks the in-app primary action,
progress, deferred restart, keyboard/input lock and retry; screenshots remain in
`.runtime/updates-ui/`. It never invokes a real installer and is not a native
Windows/Linux/macOS update acceptance test.

`node tests/e2e/updates-entry.mjs` runs the actual application renderer with an
isolated IPC fixture in Chromium. It verifies the sidebar entry and release notes,
closing without downloading, the explicit confirmation button, and retained notes
during download, in Traditional Chinese and English. Screenshots remain in
`.runtime/updates-entry/`. Install Playwright's Chromium or set `CHROMIUM_PATH`.

On Windows, `node tests/e2e/updates-native.mjs` builds two real NSIS versions of a
separate QA application using the production update service and installer settings.
It uses its own app ID, installation directory, user data, cache, and localhost
update feed under `.runtime/update-native-*/`; it never installs the production
Irwin executable. It verifies no download before confirmation, silent replacement,
automatic restart to the new version, preserved settings, and the legacy updater
call that omits `/S`. A native window watcher requires a progress indicator and
fails if installer navigation buttons or a wizard appear. The QA application is
uninstalled afterward; diagnostics remain local.
This is also run by the Windows Desktop packages job. It does not verify Linux or
macOS update installation or Windows system policies that block unsigned apps.

`node tests/e2e/cell-update-notices.mjs` runs the real App/CollectionTab/Results
renderer with an isolated database IPC fixture. It verifies successful writes
and rejected writes use five-second notices, do not open Output, and retain failed
cell edits for retry. It also checks prior query output stays collapsed and manual
expansion survives a cell save. No real database is connected.

`node tests/e2e/table-type-labels.mjs` covers compact labels for ordinary values
and BSON scalar types, missing fields, pointer/keyboard selection, both display
preferences, light/dark layouts, and unchanged ObjectId copy/string edit behavior.
It uses the real Results component without a database connection.

`node tests/e2e/themes.mjs` verifies the four additional palettes through the real
workspace and settings dialog: preview/save/cancel, persisted System settings,
dark/light Monaco modes, small-window footer access and text contrast on normal
and selected table backgrounds. The database/settings IPC fixture is isolated.

`node tests/e2e/custom-appearance.mjs` verifies per-theme picker/HEX customization,
live preview, cancel/restore, saved reload, invalid input, dark/light column text,
and independent Table/Tree/JSON typography. It checks virtual row alignment during
keyboard navigation, actual Tree padding/indentation, JSON font/line spacing and
indentation, small-window footer access, and that display changes send no document
writes. It uses the real renderer with isolated settings/database IPC.
`tests/appearance.test.ts` covers settings validation, safe CSS values, legacy
defaults and row geometry; `tests/appearance-storage.test.ts` checks SQLite
persistence and rejection of invalid updates. The native preferences suite also
checks preview/cancel/save through Electron's real settings IPC.

`tests/database-cancellation.test.ts` holds server-version detection pending and
checks Find/Aggregation/preview cancellation, disconnection, and duplicate cursor
identities without issuing database operations. `tests/transfers.test.ts` also
checks that an invalid BSON export filter creates no partial archive and a
corrected filter can export and restore the selected documents at the same path.
`node tests/e2e/query-count.mjs` covers refreshing Count before Last page after
additions/deletions, and prevents navigation on failed or stale count responses.

The Shell cases in `tests/integration.test.ts` exercise real nested `$set` and
`$addToSet` writes, repeated no-op updates, zero matches, and insert/replace/delete/
bulk result rows. The native desktop suite verifies update counts appear in the
main result grid, the empty-query message is absent, and Output stays closed.
The integration cases also verify collection/legacy/client bulk counters against
real writes while document reads retain Int32/Double/Long types, and check
database switching before successful and failing commands.

`node tests/e2e/shell-outcomes.mjs` uses isolated renderer IPC to verify scalar,
print-only and empty-document results, successful operations with failed local
history persistence, current database context and saved-query targets, normal
Find isolation, and input locking during Shell cancellation. It is a required
renderer release check. The native desktop suite additionally verifies actual
database targets, history and database retention after a Shell reset.

`updates.mjs` also exercises
drag resizing/maximize/restore and HTML/Markdown notes with hostile scripts,
event handlers and remote-resource tags.

`node tests/e2e/collection-tabs.mjs` verifies the real sidebar opens exactly one
tab on the first double-click and another on each subsequent double-click.
It checks independent filters and query cursors, single-click/keyboard reuse,
Ctrl/Cmd-click, and the same collection name in a different database. It uses an
isolated database IPC fixture; no real database is connected.

`node tests/e2e/bson-document-input.mjs` verifies BSON constructor literals in
the real Add/Edit document editor, including format-before-save, exact numeric
types in outgoing IPC payloads, date constructors and blocked integer overflow.
It uses an isolated IPC fixture; `tests/integration.test.ts` separately verifies
the same numeric constructors persist their BSON types in a temporary MongoDB
instance and remain usable in queries. Parser boundary and precision cases are
covered by `tests/bson-constructors.test.ts`.

`node tests/e2e/update-restart-confirmation.mjs` exercises the real App and
query/Shell editors with isolated IPC. It verifies explicit connection/tab closure
confirmation, cancellation, background-work blocking, draft-save failure retaining
tabs, draft preservation, and the final restart handshake after tabs close.

A ready update restarts automatically only when the update dialog is still open,
connections and workspace tabs are closed, other editors/dialogs are closed, and
background requests/jobs are idle. Otherwise it remains downloaded until the user
explicitly confirms connection/tab closure and restart. Closing the update dialog during download defers the
restart. Exercise both paths in native acceptance with two different versions.
See [the updater release contract](AUTO_UPDATES.md) for signing and bootstrap.

## Developer workflow and deployment acceptance

`pnpm test:e2e:workflows` runs the real Electron application with disposable
MongoDB data and isolated user settings. It checks loaded versus all-matching
exports, default filenames, BSON-preserving Node.js delivery, Python delivery,
typed saved-query parameters, whole-pipeline import, stage input/output samples,
team bundle preview/import, persistent Explain baselines, and successful diagnostic
capture for long collection names with the full namespace preserved. Set
`WORKBENCH_EXECUTABLE` to the unpacked candidate to test the packaged application.
The receipt is `.runtime/developer-workflows.json`; screenshots and exported
fixtures remain in `.runtime/workflows-*/`.

`pnpm accept:deployments` creates three disposable Docker deployments: standalone,
password authentication, and a single-node replica set. On Windows it invokes
Docker through WSL (`Ubuntu` by default; override `IRWIN_WSL_DISTRO`). Prepare
the local image before running; the script does not pull it automatically:

```powershell
wsl -d Ubuntu -- docker pull mongo:8.0
pnpm accept:deployments
```

On native Linux, use `docker pull mongo:8.0` before the same pnpm command.
`IRWIN_TEST_MONGO_IMAGE` can pin a different local image or digest. Each deployment
checks connection, paging/cancellation, BSON precision, read-only aggregation,
Explain/index metadata, nested write-stage rejection, production write protection,
conditional field updates, and reconnect. Cleanup verifies the run label, exact
container name and ID before removing only its own containers and volumes.
Sanitized receipts are written to `.runtime/deployment-acceptance/`; URI and
authentication secrets are excluded.

For an existing Atlas, TLS, or Cosmos account, set `IRWIN_ACCEPTANCE_URI`,
`IRWIN_ACCEPTANCE_DATABASE`, and `IRWIN_ACCEPTANCE_COLLECTION` locally, then run
`pnpm accept:external`. Use `IRWIN_ACCEPTANCE_PROVIDER=cosmos` for Cosmos;
`mongodb` is the default. This scenario reads the selected collection, performs
bounded read-only queries and diagnostics, and checks application write guards.
It creates no fixtures and performs no database writes. Missing capabilities or
permissions appear as failed checks, so inspect the receipt for provider limits.
It does not validate every cloud configuration, election, or sharded topology.

`pnpm accept:installation` exercises a Windows NSIS artifact (default:
`release/Irwin-<version>-win-x64.exe`). To select another candidate:

```powershell
node scripts/accept-installation.mjs --installer .runtime/workflow-release/Irwin-0.1.2-win-x64.exe
```

It refuses an existing registered Irwin installation, installs into a dedicated
workspace directory, verifies launch and bundled tools, reinstalls the same
version and checks saved settings/queries, then verifies its exact registered
target before uninstalling. Run it separately from other Irwin desktop tests:
the native installer can close running Irwin processes. The receipt records the
artifact hash, OS, signing status and individual checks under
`.runtime/installation-*/acceptance.json`. By default this is not an older-release upgrade,
downloaded-installer SmartScreen, or clean-machine acceptance test. Native macOS
and Ubuntu checks remain in the release checklist.

For a real two-version Windows upgrade, run the following on a clean Windows
profile or disposable VM, with no existing Irwin installation or running Irwin:

```powershell
pnpm accept:installation --installer release/Irwin-<new-version>-win-x64.exe --previous-installer .runtime/previous-release/Irwin-<old-version>-win-x64.exe
```

The runner requires a strictly older installer, launches that version, saves
isolated settings/query markers, installs the candidate, verifies the running
version and preserved markers, then uninstalls only the verified task-owned
target. The receipt records both installer hashes. It does not establish the
in-app download/restart behavior; `updates-native.mjs` covers that path with
isolated NSIS fixtures, and the real downloaded-release path still needs native
acceptance.

## Native desktop evidence

After downloading and manually testing an exact installer on the target desktop:

```sh
pnpm accept:native --artifact /path/to/Irwin-<version>-mac-arm64.dmg --output .runtime/native-acceptance.json
```

Use the matching `.exe` or `.deb` filename on Windows or Ubuntu. The command
hashes the artifact and records the host OS/version/architecture. All manual
checks start **pending**. It does not run an installer or manufacture acceptance.
To record observed results, supply `--answers <local-file.json>`:

```json
{
  "checks": {
    "install": {
      "status": "passed",
      "evidence": "Installed the matching downloaded DMG into Applications; recorded filename and date."
    },
    "first-launch": { "status": "pending", "evidence": "" }
  }
}
```

Other check names are `launcher-shortcuts`, `core-database-workflow`,
`clipboard-file-dialogs`, `credential-storage`, `upgrade-preserves-settings`,
`uninstall`, and `download-prompts-signing`. macOS additionally requires
`gatekeeper` and `native-process-architecture`. Missing answers remain pending;
passes/failures require evidence notes. A different platform/architecture, WSL
or a detected container cannot earn a passed native report. `recordingCommit`
identifies the checkout recording the evidence, not the artifact's build commit;
link its SHA-256 to the release manifest for provenance. Do not include URIs,
credentials, customer documents or personal data in notes/screenshots.

Use `pnpm accept:external` only with a deliberately selected test namespace and
read-only credentials for live Cosmos DB/Atlas validation. It can incur read
costs and does not test writes or claim unsupported provider features work.
No live cloud or native Mac/Ubuntu acceptance is implied by a successful build.

Recorded results for this implementation are in
[the six-feature acceptance record](acceptance/2026-10-06-developer-workflows.md).

## Import completion and sidebar refresh

`node tests/e2e/import-collection-refresh.mjs` runs the real sidebar and import
dialog against an isolated file/database IPC fixture. It covers right-click
import to a new collection, completion before the start response, disabled
notifications, duplicate events, collapsed databases, unrelated connections,
exports, and out-of-order metadata responses from concurrent imports. No real
database or application data is used by this browser test. The transfer
integration suite verifies import events identify the actual target database.

## Optional transfer benchmark

`tests/performance/transfers.mjs` measures large transfers and UI responsiveness, then verifies document counts and a complete BSON digest after import. It uses its own MongoDB instance and application data directory. It is outside normal CI because its default one-million-document dataset produces a file larger than 5 GB and can take substantial time and disk space.

For a smaller local run, set `BENCHMARK_DOCS` explicitly. In PowerShell:

```powershell
$env:BENCHMARK_DOCS = '1000'
node tests/performance/transfers.mjs
Remove-Item Env:BENCHMARK_DOCS
```

On macOS or Linux:

```sh
BENCHMARK_DOCS=1000 node tests/performance/transfers.mjs
```

Results and datasets remain in `.runtime/benchmark-*/`. Keep them local; publish only deliberately reviewed, sanitized measurements when they explain a product change.
