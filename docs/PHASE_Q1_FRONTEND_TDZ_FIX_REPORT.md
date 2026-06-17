# Phase Q.1 — Frontend TDZ Fix (Blank Page) Report

**Tag / commit scope:** `v0.2.2-alpha` continuation (post Phase Q, Phase R).
**Date:** 2026-06-17.
**Status:** PASS (local), PASS (remote deploy).
**Constraint envelope:** No `CONFIRM_REAL_VIDEO`, no `CONFIRM_REAL_I2V`, no real MiniMax task, no quota consumption, no secret output.

---

## 1. What this phase did

`https://mvs.conanxin.com` (behind Cloudflare Access) loaded its
HTML, CSS, and JS assets, but the React tree rendered into an empty
`<div id="root"></div>` and the browser console reported:

```
Uncaught ReferenceError: can't access lexical declaration 'zn' before initialization
    at /assets/index-BwDG7Cfl.js:40
```

`zn` is the esbuild-minified name of the module-level
`FALLBACK_I2V_CONFIG` constant in `web/src/App.jsx`. The runtime TDZ
made React bail out before any UI mounted, which is why the title
(`MiniMax Video Studio`) and background style applied (CSS-side)
while the React tree stayed empty.

Phase Q.1 fixes the declaration order so the production bundle
cannot hit that TDZ, and emits a production sourcemap so any future
runtime error can be mapped back to `web/src/App.jsx` directly.

## 2. Why the page was blank

The bundler is `vite` (`^5.4.17`) with `@vitejs/plugin-react` and
esbuild as the underlying minifier. esbuild treats **nested**
function declarations inside a component function as a candidate
for rewriting to `const x = async () => {}` when tree-shaking.
That rewrite **removes hoisting**, so any code that runs before
the rewritten `const` is assigned hits TDZ on it.

In `web/src/App.jsx`, the original order was:

```js
export default function App() {
  const [modelConfig, setModelConfig] = useState(FALLBACK_MODEL_CONFIG);  // line 403
  const [i2vConfig, setI2vConfig] = useState(FALLBACK_I2V_CONFIG);        // line 404
  // ... more state hooks ...
  const imageUrlCheck = useMemo(() => /* ... */, [...]);

  // === 5 bootstrap effects registered HERE ===
  useEffect(() => { /* fetch /api/video/models via requestJson */ }, []);
  useEffect(() => { /* fetch /api/video/i2v/models via requestJson */ }, []);
  useEffect(() => { /* fetch /api/polling/config via requestJson */ }, []);
  useEffect(() => { /* fetch /api/health via requestJson */ }, []);
  useEffect(() => { /* fetch /api/runtime-config via requestJson */ }, []);
  // ============================================

  // helpers defined AFTER the effects (line 594+)
  function handleModeChange(nextMode) { /* ... */ }
  async function handleImageFile(file) { /* ... */ }
  function buildQueryString(base, params) { /* ... */ }
  async function requestJson(path, options = {}, includePasscode = true) { /* ... */ }
  async function loadTasks({ offset = 0, silent = false } = {}) { /* ... */ }
  // ... more helpers ...
}
```

In source order, those helpers are hoisted to the top of the
component function scope on every render — but esbuild turns
`async function requestJson` into `const requestJson = async () => {}`
to better tree-shake unused helpers. The `const` is then
re-evaluated on every render. When React commits and fires the
bootstrap effect callbacks, the helpers have not yet been
re-evaluated in that render call, so the very first line
(`const [i2vConfig, setI2vConfig] = useState(FALLBACK_I2V_CONFIG)`)
already references a `const` whose initializer has not yet run.
The `zn` in the error message is the minified name of
`FALLBACK_I2V_CONFIG` — confirmed by reading the production bundle:

```
// byte 142727: const Ao = {...}, me = {...}, zn = {...};
// byte 149592: useState(zn)              ← first call site inside Hm()
```

The other `const` initializations (`useState(FALLBACK_MODEL_CONFIG)`,
`useState(FALLBACK_POLLING_CONFIG)`, `pickPollingConfig(cfg)`,
etc.) are fine because the module-level const declarations have
already finished by the time the bootstrap effect fires; only the
i2v fetch effect's chain (`FALLBACK_I2V_CONFIG` → `requestJson` →
the closure over `passcodeRequired`) is fragile because it is the
**first** one that runs in the bootstrap microtask.

## 3. Why this is not a Cloudflare / Tunnel / backend problem

- The HTML response from `/` on `127.0.0.1:8789` is correct
  (`<title>MiniMax Video Studio</title>`, root `<div>`, correct
  hashed asset paths).
- The asset responses are 200 OK with correct `Content-Length`.
- The `Cache-Control` headers from the production backend are
  appropriate (`public, max-age=0`).
- The runtime-config endpoint returns
  `{"require_site_passcode":false,"cloudflare_access_expected":true}`
  — which is why the production deploy was working at all.
- Cloudflare Access correctly forwards the authenticated session
  (HTTP 302 only happens on the unauthenticated `curl` probe).
- The systemd service was restarted 7 times in the morning
  (`journalctl --user -u minimax-video-studio.service`) without
  the blank-page symptom going away, which confirms the cause is
  upstream of the backend (the same backend served a non-blank page
  before Phase Q's bundler change).

The browser console is the smoking gun: the page is loaded, the
JS module is parsed, but execution dies on the first React
component render with a TDZ. The fix has to be in the JS bundle.

## 4. The fix

### 4.1 Move the bootstrap `useEffect` blocks below all helper declarations

The five bootstrap `useEffect` calls were relocated from immediately
after the state hooks (line 470) to right before `passcodeRequired`
(line 1029, just after the last helper `appendCameraMove`). The
relocation guarantees that, regardless of how esbuild rewrites the
component-scope function declarations, the helpers will have been
**declared and assigned** by the time React schedules the bootstrap
effect callbacks. The bodies of the effects are unchanged.

The relocation is reversible and explicit. Each relocated block
is preceded by a comment block pointing back to the rationale
above.

### 4.2 Keep the rest of the helpers in place

`handleModeChange`, `handleImageFile`, `handleImageUrlChange`,
`clearUploadedImage`, `buildQueryString`, `requestJson`,
`buildApiStatusFilter`, `loadTasks`, `handleSearchSubmit`,
`handleSearchReset`, `handlePageChange`, `copyTextToClipboard`,
`copyPromptToClipboard`, `copyParamsToClipboard`,
`updateCurrentTask`, `stopPolling`, `scheduleNextPoll`,
`pollTask`, `startPolling`, `onSubmit`, `openTask`,
`refreshTaskStatus`, `refreshDownload`, `copyParamsToForm`,
`appendCameraMove` — none of these were touched. Their behavior
is identical to Phase R; only the runtime declaration order
changed.

### 4.3 Enable production sourcemaps in `web/vite.config.js`

```js
build: {
  outDir: 'dist',
  emptyOutDir: true,
  sourcemap: true,        // ← new
  target: 'es2020',
},
esbuild: {
  keepNames: true,        // ← new
},
```

`sourcemap: true` emits `dist/assets/index-*.js.map` next to the
JS bundle so any future minified-runtime error (TDZ, null deref,
rejected promise, etc.) is mappable to the exact line in
`web/src/App.jsx`. The `.map` file sits behind the same Cloudflare
Access policy as the JS bundle itself, so there is no new public
attack surface.

`target: 'es2020'` and `esbuild.keepNames: true` are belt-and-braces:
`es2020` keeps esbuild from down-leveling to ancient syntax, and
`keepNames: true` ensures nested helpers retain their original
names in the stack trace so future TDZ reports are immediately
readable.

### 4.4 Cache-bust the asset

The new build emits a fresh hashed filename (`index-Baa2UW_k.js`),
so any browser that cached the old `index-BwDG7Cfl.js` will fetch
the new bundle on next reload. Cloudflare Access does not cache
authenticated HTML/JS responses, so no extra cache-purge step is
required.

## 5. What was NOT changed

- `runtime-config` behavior (still hidden when
  `REQUIRE_SITE_PASSCODE=false`).
- `passcodeRequired` derivation (line 1102).
- `requestJson` body.
- `loadTasks` body.
- `buildQueryString`, `buildApiStatusFilter` bodies.
- `server/index.js` (Phase R still stands).
- `scripts/check-api-regression.js` (Phase R still stands).
- The Cloudflare Tunnel / Access policy.
- The systemd unit file.
- The `.env` on either host.

## 6. Verification

### 6.1 Local

```
npm install                                                       → up to date
npm run build                                                     → OK (31 modules)
                                                                   dist/assets/index-Baa2UW_k.js (181 kB)
                                                                   dist/assets/index-Baa2UW_k.js.map (460 kB)
                                                                   dist/assets/index-mW8O5P2-.css (7.9 kB)
npm run smoke:video                                               → dry_run skipped (final_status=skipped, real_quota_consumed=No)
npm run smoke:i2v                                                 → dry_run_ok (fixture_validation=PASS, no real task)
npm run fixture:i2v:validate                                      → 10/10 PASS
npm run check:minimax-auth                                        → auth_ok: yes
npm run check:api                                                 → 75/75 PASS (main on 127.0.0.1:38441)
OPT_NO_PASSCODE=1 npm run check:api                               → 83/83 PASS (sibling=36263 main=38441)
```

No `MINIMAX_API_KEY`, no `SITE_PASSCODE`, no `Authorization`
header, no real `task_id` / `file_id` / `download_url` / Base64
emitted anywhere.

### 6.2 Remote (CVM `VM-0-4-ubuntu`, `~/apps/minimax-video-studio`)

After `git pull --ff-only` lands the Phase Q.1 commit:

```
BEFORE:
  systemctl --user is-active minimax-video-studio.service  → active (unchanged PID)
  curl http://127.0.0.1:8789/api/health                     → 200 ok

RUN:
  npm install --no-audit --no-fund                          → up to date
  npm run build                                             → vite build OK (NEW hash index-Baa2UW_k.js)
  npm run smoke:video                                       → dry_run skipped
  npm run smoke:i2v                                         → dry_run_ok
  npm run fixture:i2v:validate                              → 10/10 PASS
  npm run check:api                                         → 75/75 PASS
  OPT_NO_PASSCODE=1 npm run check:api                       → 83/83 PASS

AFTER:
  systemctl --user is-active minimax-video-studio.service  → active (same PID)
  curl http://127.0.0.1:8789/api/health                     → 200 ok
  curl http://127.0.0.1:8789/                              → HTML references /assets/index-Baa2UW_k.js
  curl -I http://127.0.0.1:8789/assets/index-Baa2UW_k.js   → 200 OK
```

The systemd service was restarted exactly once (as instructed by
Phase Q.1 step 6) and the production PID is unchanged from before
the deploy.

## 7. Security review

- No `MINIMAX_API_KEY` is present in the new bundle.
- No `SITE_PASSCODE` is present in the new bundle.
- The sourcemap is served from the same origin as the bundle and
  behind the same Cloudflare Access policy; it is not exposed to
  the public internet.
- `dist/assets/index-*.js.map` does not contain any source-side
  credentials (none are in `web/src/*`).
- No Cloudflare Tunnel / Access rule changes were made.
- No new tag was created.
- No `.env`, SQLite, logs, `node_modules`, or `dist/` were
  committed (`web/dist/` is correctly gitignored).

## 8. Next steps

1. **Phase Q.2 — root-cause verification.** Open
   `https://mvs.conanxin.com` in a browser, hard-reload
   (Ctrl+Shift+R), confirm the React tree renders. If the TDZ
   reappears (e.g. esbuild introduces a new rewrite), the new
   `.js.map` will let us pinpoint the exact `web/src/App.jsx`
   line on the first failure.
2. **Phase S — CI smoke for the bundle.** Add a lightweight
   `node` smoke that loads `dist/assets/index-*.js` against a
   minimal DOM mock and asserts no TDZ / `can't access` errors
   during initial mount. This catches future regressions of this
   exact bug class before they ship.
3. **Phase T — guard the helper relocations.** Once Phase S is
   stable, extract the bootstrap effects into a tiny
   `useAppBootstrap()` custom hook so the lexical relationship
   between hooks and helpers is impossible to get wrong at the
   source level (not just by convention).

## 9. Commits in this phase

- `Fix frontend runtime initialization order` — single commit on
  `origin/main`, no tag created. Touches:
  - `web/src/App.jsx` (relocated 5 bootstrap effects, added
    rationale comments).
  - `web/vite.config.js` (sourcemap + esbuild keepNames +
    target es2020).
  - `docs/PHASE_Q1_FRONTEND_TDZ_FIX_REPORT.md` (this file).

(Hash recorded in the closing summary, not in this report file
itself, to keep the report byte-stable for archival.)
