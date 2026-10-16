# Changelog

User-visible changes are recorded here for each public release. Unreleased work is not a release commitment.

## Unreleased

### Improvements

- Add per-theme custom palettes with color pickers, HEX input, live preview, individual resets and explicit save/cancel in Appearance preferences.
- Configure Table, Tree and JSON fonts, sizes, line spacing, padding and applicable indentation independently, with matching virtual row heights and document-editor display.
- Add Midnight and Graphite dark palettes plus Lavender and Paper light palettes, with matching native frames, editor color schemes and settings previews.
- Show compact type tags for every table value, with full type names on hover and the existing selection/always-show preference.
- Reduce workspace, query-toolbar and pagination spacing to leave more room for results without changing table row density.
- Add repeatable WSL Docker acceptance for standalone, authenticated and replica-set MongoDB, plus isolated Windows installation/reinstallation/uninstallation checks with JSON evidence.
- Consolidate result exports into one scope/format picker; name loaded and all-matching files explicitly and label page size as rows per batch.
- Accept whole BSON-aware pipelines, modern read-only aggregation stages and stage input/output sample comparison with version checks and nested write-stage rejection.
- Export runnable Node.js/TypeScript and Python driver code; share versioned Find/Shell/pipeline bundles with import previews, fresh identities and typed structural parameters.
- Persist reproducible Find and Aggregation diagnostics with hint, collation, query inputs, namespace/environment, server version, index definitions and raw executionStats; compare baselines and import/export JSON records.
- Show query completion and failure in dismissible bottom-right notifications; every notification expires after five seconds.
- Keep manual Count next to loaded/matching result status, including zero results, persistent retryable errors and stale-response protection when filters change.
- Defer the local Monaco editor, Excel export library and application dialogs until needed; add production renderer measurements and a static-import bundle budget.
- Separate document editing, query-count state and update restart coordination from the main workspace components.
- Add verified draft-release staging with clean-source provenance, combined checksums, required renderer regressions and previous-release Windows upgrade acceptance.
- Record native desktop acceptance against exact installer hashes with explicit evidence and pending checks; retain unverified platform/service status.

### Fixes

- Keep Shell's displayed database, saved queries and subsequent history aligned with `use`/`getSiblingDB`, including scripts that switch databases before failing and sessions reset after cancellation.
- Display Shell scalar values and print-only command completion in the primary results area; reserve the empty-query message for document queries.
- Preserve successful query/write results when local history or draft cleanup fails, with a warning that the operation must not be repeated.
- Correct collection, legacy and MongoDB client bulk-write counters without changing BSON document-read precision.
- Keep Run and Stop disabled while cancellation resets the Shell session.
- Show Mongo Shell update/insert/delete/bulk-write acknowledgements and counts as read-only result rows instead of an incorrect empty-query message.
- Preserve Find and Aggregation cancellation during server-version detection, including disconnects and duplicate cursor requests.
- Validate BSON export filters before creating partial archives, allowing corrected filters to retry the same destination.
- Refresh Count before jumping to the last page, update the displayed total, and ignore failed or stale counts.
- Keep collection Output collapsed until explicitly opened, including after query errors and subsequent cell edits; preserve manual expansion during the current session.
- Keep Explain capture usable for long collection names by shortening only the record's display name while preserving the full namespace and timestamp.
- Reject impossible calendar dates and invalid clock values in typed query parameters instead of silently normalizing them to another date; preserve valid leap days and explicit UTC offsets.
- Keep download retry/fallback and verification progress distinct, reserving 100% for a verified installer instead of replaying the percentage bar.
- Confirm connection/tab closure before update restart, save Shell drafts before closing tabs, and preserve the workspace on cancellation or draft-save failure.

- Refresh the affected sidebar collection list when an import or restore finishes, including partial writes from cancelled or failed imports. Preserve collapsed databases and ignore stale refresh responses.

- Show release notes when opening an available update and require an explicit download confirmation; retain the notes during download and retries.
- Keep Windows in-app updates silent and restart automatically, including legacy updater calls that omit `/S`; normal manual installers retain their setup wizard.
- Make the update dialog resizable and maximizable, and render HTML/Markdown release notes with passive formatting and no executable content or remote resources.
- Show an indeterminate native installation progress indicator during unattended Windows updates, then restart automatically.
- Report table-cell save success and failure in a bottom-right notification that disappears after five seconds; keep failed edits for retry without opening Output.
- Double-clicking an already-open collection creates another independent query tab; the first double-click opens one tab, while single-click and keyboard activation reuse an existing tab.

## 0.1.3 — 2026-10-14

### Fixes

- Accept numeric and string literals in Int32/NumberInt, Long/NumberLong, Double and Decimal128/NumberDecimal constructors, including `new` forms. Preserve exact integer/decimal source values, reject lossy Double conversions and retain constructor error locations.
- Pin mongosh's indirect proxy-addr dependency to 2.0.8 to address GHSA-jqcg-44mw-7w3h; retain production dependency auditing.

## 0.1.2 — 2026-10-05

### Improvements

- Improved query toolbar actions, keyboard selection of operator suggestions, narrow-window layouts, and the resizable AI assistant dock.
- Added an independent model-service settings dialog with explicit save and discard behavior.
- Made JSON viewing and editing display ordinary numbers, retaining ObjectId and date constructors and support for explicit Extended JSON.
- Added a Local environment tag for local database connections, including connection badges and operation-receipt filtering.
- Improved connection settings and URI export to reflect effective topology, TLS, timeouts, write concern, and retryable-write overrides; Cosmos DB disables retryable writes by default.

### Fixes

- Preserved BSON numeric types and exact values during document and nested-field editing, including structural array edits; ambiguous array edits now require explicit Extended JSON instead of silently guessing a type.
- Kept conflict refresh and retry scoped to the edited field, and added line/column navigation for document parsing errors.
- Hardened update metadata verification and restart behavior while operations or unsaved edits are active. Unsigned macOS packages continue to use manual updates; verified signed macOS builds have a separate opt-in update path.

### Security

- Updated transitive `basic-ftp` to 6.2.1 to address GHSA-c475-qrg2-pj4r without disabling dependency audits.

## 0.1.1 — 2026-09-30

### Security

- Updated transitive `brace-expansion` dependencies to 1.1.21, 2.1.7, and 5.0.12 to address resource-exhaustion advisories.
- Updated transitive `ip-address` to 10.7.2 to address address-family comparison and IPv6 parse-diagnostic advisories.
- Updated the packaging toolchain's transitive `fast-uri` dependency to 3.1.8 to address host-normalization inconsistency.

### Documentation

- Clarified the required Node.js and pnpm versions and macOS certificate-helper behavior in the installation guide.

## 0.1.0 — 2026-09-30

- Added an in-app GitHub release check and update download flow for packaged Windows and Ubuntu builds; unsigned macOS builds link to the release page for manual installation.
- Added a quiet, once-per-launch update check for packaged builds. It is enabled by default, can be disabled in Preferences, and is skipped while offline.
- Added an opt-in AI assistant with configurable OpenAI-compatible, Anthropic, and Gemini services, bilingual query drafts, MongoDB Explain interpretation, and per-connection settings.
- Added context review, literal redaction, local-only schema sampling, encrypted API-key storage, cancelable requests, and validation before a generated draft can be applied.
- Added separate README translations in Traditional Chinese, Japanese, Korean, Spanish, and Portuguese alongside the English reference.
- Added human-readable Mongo shell BSON editing, including ObjectId and date constructors, plus line and column details for parse errors.
- Added ISODate and Date support in query editing and keyboard acceptance for prefix suggestions.
- Improved button tooltips on macOS with consistent pointer, keyboard, and screen-reader behavior.
- Fixed frozen table headers and cells shifting down a row, which could hide keyboard-selected cells behind the header.
- Fixed JSON array and JSONL imports failing in the compiled desktop application.
- Clear previous renderer build outputs so packaging does not include obsolete UI assets.
