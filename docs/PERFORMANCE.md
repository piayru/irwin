# Renderer performance

Measure the production renderer with local fixtures before changing loading or
rendering behavior. These commands never connect to MongoDB or read Irwin's
saved profiles. Benchmark output stays in ignored `.runtime/` storage.

```sh
pnpm build
pnpm perf:bundle
pnpm exec playwright install chromium
pnpm perf:renderer
```

`perf:bundle` follows every static import from Vite's `index.html` manifest entry,
counts each script once, and fails above **1,500,000 uncompressed JavaScript
bytes**. It reports initial CSS separately. Dynamic editor/export modules and
workers are excluded from the startup budget, but still ship with the app and
are exercised by editor/export tests. The CI and packaging workflows run this
gate; do not raise the threshold merely to silence a regression.

`perf:renderer` opens three fresh browser contexts against the production build.
It records startup script resources, time to display 3,000 collection names,
time to render 1,000 result rows with 512-byte text fields, first JSON editor
load, and JavaScript heap usage. There are no brittle elapsed-time assertions;
compare repeated samples on the same machine and browser. These numbers measure
renderer work with IPC fixtures, not real database/network latency or native
Electron cold start.

To compare two isolated builds:

```sh
node scripts/measure-renderer.mjs --directory .runtime/before --output .runtime/perf-before.json
node scripts/measure-renderer.mjs --directory .runtime/after --output .runtime/perf-after.json
node scripts/renderer-budget.mjs --directory .runtime/after
```

Set `CHROMIUM_PATH` when deliberately using an already-installed compatible
Chromium executable. Install Playwright's matching Chromium in CI.

`Editor.tsx` keeps Monaco out of application startup. Opening a query warms the
module; an already-loaded editor mounts directly, and each editing session keeps
a stable component identity as its parent updates. The editor configuration lives
in `MonacoEditor.tsx`. ExcelJS is loaded inside `excelContent`, and application
dialogs have cancellable loading fallbacks.
Table row/column virtualization and bounded result retention remain in place.
Measure large-sidebar rendering before choosing another virtualization layer.

Development dependency discovery scans only `index.html`, avoiding HTML in local
QA/build snapshots. Vite otherwise discovers dependencies by crawling HTML files;
see [Vite dependency entry configuration](https://vite.dev/config/dep-optimization-options.html#optimizedeps-entries).

The 2026-10-15 production snapshots measured the complete static startup graph:

| Metric             |          Before |         After |
| ------------------ | --------------: | ------------: |
| Initial JavaScript | 5,055,503 bytes | 738,749 bytes |
| Initial CSS        |   222,005 bytes |  89,463 bytes |

Initial JavaScript decreased by **85.4%**. This does not describe total packaged
size: Monaco, its workers and ExcelJS still ship locally and load when needed.

Three fresh browser contexts per build, using Chromium 153 on Linux x64 in a
WSL Docker container limited to 2 CPUs and 4 GiB, produced these local medians:

| Renderer fixture metric        |     Before |      After |
| ------------------------------ | ---------: | ---------: |
| Startup visible                |   709.8 ms |   235.8 ms |
| 3,000 collection names visible |   479.9 ms |   448.0 ms |
| First 1,000-row table visible  | 2,596.1 ms | 2,765.3 ms |
| First JSON editor visible      |   508.8 ms |   613.9 ms |

The final first-JSON samples were 522.0, 613.9 and 790.4 ms. Deferring every editor
until its first render caused a several-second delay in this fixture; warming it
on query open and directly mounting the resolved component removed that delay.
The tool records JSON resource durations to distinguish loading from rendering.

These samples demonstrate reduced startup work, not uniformly faster queries or
a native Electron startup guarantee. Table/JSON activation still has work to do;
background host load and garbage collection affect timings. Keep elapsed times
informational, retain the deterministic byte budget, and repeat comparable
measurements before claiming further improvements.
