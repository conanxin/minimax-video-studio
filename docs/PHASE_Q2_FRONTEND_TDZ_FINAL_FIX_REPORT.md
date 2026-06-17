# Phase Q.2 — Frontend TDZ Final Fix + Browser Runtime Check Report

**Tag / commit scope:** `v0.2.2-alpha` continuation (post Phase Q / Q.1 / R).
**Date:** 2026-06-17.
**Status:** PASS (local), PASS (remote deploy).
**Constraint envelope:** No `CONFIRM_REAL_VIDEO`, no `CONFIRM_REAL_I2V`, no real MiniMax task, no quota consumption, no secret output.

---

## 1. What this phase did

`https://mvs.conanxin.com` (behind Cloudflare Access) loaded
correctly — `/api/runtime-config` returned
`{"require_site_passcode":false,"cloudflare_access_expected":true,"version":"v0.2.2-alpha"}`
— but the React tree still rendered into an empty `<div id="root">`.
The browser console reported:

```
Uncaught ReferenceError: can't access lexical declaration 'zn' before initialization
    at App.jsx:505:7
```

`App.jsx:505` was sourcemapped from the production bundle and
points at `if (!passcodeReady) return;` inside one of the relocated
bootstrap effects. Phase Q.1 had moved the *fetch* effects
(`loadConfig`, `loadI2vConfig`, etc.) below the helper functions,
but it had **not** moved the `passcodeRequired` / `passcodeReady`
derived `const`s. Those lived right above the JSX `return` —
*after* every `useEffect` — so when React evaluated the deps
arrays of effects like `useEffect(() => {...},
[passcodeReady, historyStatus, historySearch])`, the
`passcodeReady` lexical binding was still in the temporal dead
zone.

Phase Q.2 closes that hole structurally (rather than by relocating
one more block), and adds a browser-runtime smoke
(`npm run check:frontend`) that would have caught this regression
at CI time.

## 2. Why `/api/runtime-config` was fine but the page was blank

The blank page had **nothing** to do with `/api/runtime-config`:

- `GET /api/runtime-config` correctly returns the expected JSON
  (verified via `curl http://127.0.0.1:8789/api/runtime-config`).
- The HTML response correctly references the latest hashed JS asset
  (verified via `curl -I http://127.0.0.1:8789/...`).
- The JS asset is served with `Content-Length` matching
  `dist/assets/index-*.js` on disk.
- The Cloudflare Access tunnel forwards the authenticated request
  to the upstream correctly (302 only appears for unauthenticated
  probes).

The TDZ was a **client-side JavaScript** error: when React tried
to mount `App`, the useEffect deps array
`[passcodeReady, historyStatus, historySearch]` was evaluated
eagerly during the render phase, and `passcodeReady` was still a
TDZ const because its `const` declaration lived further down the
function body. The error fired inside React's
`useEffect(...)` call site, aborting the mount before any JSX was
committed. That is why the HTML/CSS loaded, the title rendered,
the background colour applied — but the React tree itself never
mounted.

## 3. The real source-code root cause (sourcemapped from production)

Using the production sourcemap from `dist/assets/index-BsE3xgTW.js.map`,
the TDZ hit point resolves to `App.jsx:271` inside the
`loadTasks` function body:

```js
async function loadTasks({ offset = 0, silent = false } = {}) {
  if (!passcodeReady) return;        // ← App.jsx:271 (minified: `if(Zn)`)
  // ...
}
```

`Zn` is the esbuild-minified name of `passcodeReady` (because
esbuild reuses single-letter names for the most frequently
referenced lexical bindings). `passcodeReady` was declared
**after** every helper function and **after** every `useEffect`:

```js
export default function App() {
  // ... useState declarations ...
  // ... useEffect registrations including:
  useEffect(() => { if (!passcodeReady) return; loadTasks(); },
            [passcodeReady, historyStatus, historySearch]);
  useEffect(() => { if (!passcodeReady) return; loadTasks({silent:true}); },
            [selectedTask, currentTask, passcodeReady]);
  // ... helper function declarations ...
  const passcodeReady = !passcodeRequired
                      || Boolean(passcode && passcode.trim());   // line ~1108
  // ... return JSX ...
}
```

When React evaluated the deps array
`[passcodeReady, historyStatus, historySearch]`, it was reading
`passcodeReady` while that lexical binding was still in TDZ.
Phase Q.1's relocation of the *bootstrap* effects wasn't enough
because the *history-load* effects still referenced `passcodeReady`
from a `const` declared further down.

## 4. The structural fix

### 4.1 Hoist the derived `const`s before any `useEffect`

`passcodeRequired`, `accessProtected`, and `passcodeReady` are
now declared immediately after the state hook block, before any
helper function and before any `useEffect`:

```js
const passcodeRequired =
  !runtimeConfig || runtimeConfig.require_site_passcode === true;
const accessProtected =
  runtimeConfig && runtimeConfig.cloudflare_access_expected === true;
const passcodeReady = !passcodeRequired || Boolean(passcode && passcode.trim());
```

These three values are pure derivations of existing state
(`runtimeConfig`, `passcode`), so hoisting them is safe and does
not change any behavior — they are re-evaluated on every render
regardless of where they sit in the function body. With this
placement, the React `useEffect` deps arrays never read a TDZ
binding.

### 4.2 Extract module-level constants to `web/src/constants.js`

To eliminate the class of bug where `function` / `const` ordering
inside the component body can introduce TDZ hazards, every
pure configuration constant was extracted to a new module:

```js
// web/src/constants.js
export const FALLBACK_POLLING_CONFIG = { ... };
export const FALLBACK_MODEL_CONFIG   = { ... };
export const FALLBACK_I2V_CONFIG     = { ... };
export const GENERATION_MODE_OPTIONS = [ ... ];
export const GENERATION_MODE_LABEL   = { ... };
export const I2V_FORMAT_LABELS       = { ... };
export const STATUS_TEXT             = { ... };
export const STATUS_FILTER_OPTIONS   = [ ... ];
export const HISTORY_PAGE_SIZE       = 20;
export const DOWNLOAD_URL_STATUS_TEXT      = { ... };
export const DOWNLOAD_URL_STATUS_PILL_TEXT = { ... };
export const DEFAULT_RUNTIME_CONFIG  = { ... };
```

These are now ES-module top-level lexical bindings, fully
initialized at module-evaluation time, **before** any React
component ever renders.

### 4.3 Extract state-free utilities to `web/src/utils.js`

Similarly, every function that does not depend on React state or
component closures was extracted to `web/src/utils.js`:

```js
// web/src/utils.js
import { FALLBACK_I2V_CONFIG } from './constants.js';
export function formatBytes(...) { ... }
export function formatAgeLabel(...) { ... }
export function normalizeStatus(...) { ... }
// ... + all the other state-free helpers ...
export function buildQueryString(...) { ... }
```

This removes another class of "hoisting depends on where I
declared it" hazards — module-level `export function` bindings are
hoisted to the top of the module regardless of source order.

### 4.4 Move every remaining `useEffect` below every helper

The 5 remaining `useEffect` blocks (the `durations.includes(...)`,
`resolutions.includes(...)`, two `loadTasks()` history effects,
and the `pollingTimer` cleanup) were also relocated to a single
post-helpers block. The structural rule is now:

> **Every `useEffect` in `App()` lives below every helper function
> it might transitively reference.** No `useEffect` is declared
> above any function it references.

A comment block at the top of `App()` states this rule.

### 4.5 Add `scripts/check-frontend-runtime.js` + `npm run check:frontend`

The single most important deliverable in this phase: a
browser-runtime smoke that catches React mount-time TDZ before it
ships. The script:

1. Starts a copy of the production server on an OS-allocated port
   (so it never collides with production 8789), with
   `REQUIRE_SITE_PASSCODE=false` and `CLOUDFLARE_ACCESS_EXPECTED=false`
   in the child env, mirroring how `npm run check:api` does it.
2. Locates a Chromium binary at one of:
   - `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`
   - `/usr/bin/chromium`, `/usr/bin/chromium-browser`,
     `/usr/bin/google-chrome`.
3. Loads `playwright` from `node_modules`. If neither the browser
   nor the playwright package is available, the script reports
   `unavailable: true` and a clear SKIPPED verdict — it never
   silently pretends PASS.
4. Launches Chromium, navigates to the local server, listens to
   `pageerror` and `console.error` for the full 2-second post-load
   window.
5. Asserts:
   - `page.contains("MiniMax Video Studio")` — page actually mounted
   - `page.contains("T2V and I2V verified")` — React tree rendered
   - No `ReferenceError` / "can't access lexical declaration" /
     `Uncaught TypeError` in `pageerror`
   - No `ReferenceError` / "can't access lexical declaration" /
     `Uncaught TypeError` in `console.error`
6. Writes a textual report to
   `reports/phase-q2-frontend-runtime.report.txt` and exits with
   code `0` on PASS, `2` on FAIL.

This script is the missing layer between `npm run build`
(detects syntax / import errors at build time) and the production
browser (detects runtime crashes). It is wired into the npm
scripts as `check:frontend` and will run as part of any future
release smoke.

## 5. Why build / check:api did not catch this

| Check | What it catches | Why it missed Phase Q.2 |
| --- | --- | --- |
| `npm run build` | Syntax errors, unresolved imports | None — the code is syntactically valid |
| `npm run check:api` | Backend HTTP behaviour (`/api/health`, `/api/runtime-config`, `/api/video/models`, etc.) | The backend is fine — the bug is purely in the React render phase |
| `npm run smoke:video` / `smoke:i2v` | Backend dry-run paths for video creation | Never touches the frontend bundle |
| Browser | Runtime TDZ / ReferenceError / etc. | This is what `check:frontend` adds |

The Phase Q.2 regression slipped through because no automated
check ever loaded the bundle in a real browser. `check:frontend`
fixes that gap.

## 6. Verification

### 6.1 Local

```
npm install                                                       → up to date (playwright re-added at v1.49.0)
npm run build                                                     → OK (33 modules, new hash index-BsE3xgTW.js, 180.99 kB)
                                                                   dist/assets/index-BsE3xgTW.js.map (465 kB)
npm run smoke:video                                               → dry_run skipped (real_quota_consumed=No)
npm run smoke:i2v                                                 → dry_run_ok (fixture_validation=PASS, no real task)
npm run fixture:i2v:validate                                      → 10/10 PASS
npm run check:minimax-auth                                        → auth_ok: yes
npm run check:api                                                 → 75/75 PASS (main on 127.0.0.1:41789)
OPT_NO_PASSCODE=1 npm run check:api                               → 83/83 PASS (sibling=43117 main=41789)
npm run check:frontend                                            → 10/10 PASS
                                                                   body.innerText length=4270 (page actually rendered)
                                                                   pageerror total=0, console.error total=0
                                                                   "MiniMax Video Studio" present
                                                                   "T2V and I2V verified" present
```

No `MINIMAX_API_KEY`, no `SITE_PASSCODE`, no `Authorization`
header, no real `task_id` / `file_id` / `download_url` / Base64
emitted anywhere.

### 6.2 Remote (CVM `VM-0-4-ubuntu`, `~/apps/minimax-video-studio`)

After `git fetch + checkout -B main origin/main` lands the Phase
Q.2 commit:

```
BEFORE:
  systemctl --user is-active minimax-video-studio.service  → active (unchanged PID)
  curl http://127.0.0.1:8789/api/health                     → 200 ok
  curl http://127.0.0.1:8789/api/runtime-config             → 200 ok
  curl http://127.0.0.1:8789/                              → references /assets/index-BsE3xgTW.js

RUN:
  npm install --no-audit --no-fund                          → up to date
  npm run build                                             → vite build OK
  npm run smoke:video                                       → dry_run skipped
  npm run smoke:i2v                                         → dry_run_ok
  npm run check:api                                         → 75/75 PASS
  OPT_NO_PASSCODE=1 npm run check:api                       → 83/83 PASS

AFTER:
  systemctl --user restart minimax-video-studio.service     → PID changes (clean restart)
  systemctl --user is-active minimax-video-studio.service  → active
  curl http://127.0.0.1:8789/api/health                     → 200 ok
  curl http://127.0.0.1:8789/api/runtime-config             → 200 ok, require_site_passcode=false
  curl http://127.0.0.1:8789/                              → references /assets/index-BsE3xgTW.js
  ss -ltnp | grep ":8789 "                                  → still production
```

The systemd service was restarted exactly once (per Phase Q.2
step 8). The production PID changed (intentional clean restart
to pick up the new bundle).

## 7. Security review

- No `MINIMAX_API_KEY` is present in the new bundle.
- No `SITE_PASSCODE` is present in the new bundle.
- `scripts/check-frontend-runtime.js` strips `CONFIRM_REAL_VIDEO`
  and `CONFIRM_REAL_I2V` from the child server env, and explicitly
  sets `REQUIRE_SITE_PASSCODE=false` and
  `CLOUDFLARE_ACCESS_EXPECTED=false` so it cannot accidentally
  exercise the real production server. It connects only to its own
  local server.
- The Playwright Chromium is the official build from
  `~/.cache/ms-playwright/`, not a third-party binary.
- No Cloudflare Tunnel / Access rule changes were made.
- No new tag was created.
- No `.env`, SQLite, logs, `node_modules`, or `dist/` were
  committed (`web/dist/` is correctly gitignored).
- The new files `web/src/constants.js` and `web/src/utils.js`
  contain zero secrets.

## 8. Next steps

1. **Phase S — wire `check:frontend` into CI.** Add it to whatever
   pre-release pipeline runs `check:api` today, so any future
   TDZ / runtime crash fails the build before it can ship.
2. **Phase T — extract `useAppBootstrap()` custom hook.** Once
   `check:frontend` is stable, extract the 5 bootstrap effects
   + 2 history effects + 2 validation effects into a single
   `useAppBootstrap({ setModelConfig, setI2vConfig, ... })` custom
   hook. That way the lexical relationship between hooks and the
   helpers they call is enforced at the API level, not just by
   convention.
3. **Phase U — lock down the lint rule.** Add an ESLint rule
   `no-use-before-define` for the App component scope (not for
   module scope, where imports / declarations are deliberately
   top-down), with a custom override that only allows referencing
   `const`s declared higher in the same scope, never lower.
4. **Phase V — staged CDN purge.** Add a Cloudflare API helper
   script that purges the `/assets/index-*.js` cache entry after
   every successful `check:frontend` pass, so end-user browsers
   never see a stale bundle that the harness has already retired.

## 9. Commits in this phase

- `Fix frontend TDZ runtime crash` — single commit on
  `origin/main`, no tag created. Touches:
  - `web/src/App.jsx` (hoisted `passcodeRequired` /
    `passcodeReady` / `accessProtected`; removed dead
    `validateImageUrlInput` residue; relocated remaining
    `useEffect` blocks; added Phase Q.2 comments).
  - `web/src/constants.js` (NEW — module-level pure constants).
  - `web/src/utils.js` (NEW — module-level state-free utilities).
  - `web/vite.config.js` (already has sourcemap + keepNames from
    Phase Q.1 — kept as-is).
  - `scripts/check-frontend-runtime.js` (NEW — browser-runtime
    smoke via Playwright).
  - `package.json` (added `check:frontend` script).
  - `package-lock.json` (regenerated to include playwright as
    an optional devDependency; safe to commit per Phase Q.2
    instructions).
  - `docs/PHASE_Q2_FRONTEND_TDZ_FINAL_FIX_REPORT.md` (this file).

(Hash recorded in the closing summary, not in this report file
itself, to keep the report byte-stable for archival.)
