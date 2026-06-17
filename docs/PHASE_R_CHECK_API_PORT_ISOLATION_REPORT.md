# Phase R — check:api Port Isolation Report

**Tag / commit scope:** `v0.2.2-alpha` continuation (post Phase Q).
**Date:** 2026-06-17.
**Status:** PASS (local), PASS-after-push (remote).
**Constraint envelope:** No `CONFIRM_REAL_VIDEO`, no `CONFIRM_REAL_I2V`, no real MiniMax task, no quota consumption, no secret output.

---

## 1. What this phase did

`npm run check:api` previously spawned its regression child server on
`PORT = Number(process.env.PORT) || 8789`. On a host where production
`minimax-video-studio.service` is already listening on 8789, the harness
silently collided with production: `EADDRINUSE` aborted the child, the
remaining checks ran against a stale or missing server, and the run
degraded to 74/75 with a single cryptic passcode check failure.

Phase R makes `check:api` **port-isolated by default** so operators can
run the full regression matrix without stopping the production systemd
service, the Cloudflare front door, or the Access layer.

## 2. Root cause (Phase Q debt)

Two interacting bugs in the harness + server bootstrap:

### 2.1 `Number(process.env.PORT) || 8789` is a latent `PORT=0` fallback

`Number("0") === 0` is **falsy** in JavaScript. The expression

```js
const PORT = Number(process.env.PORT) || 8789;
```

silently swallows the legitimate `PORT=0` request and re-binds to 8789.
This meant that even when the harness asked the OS for a free port via
`PORT=0`, the server still tried to grab 8789 and failed against a live
production listener.

### 2.2 `dotenv.config()` re-injects `PORT=8789` from `.env`

`dotenv` defaults to "do not override existing env vars", but if the
shell never set `PORT` (which is the common case when an operator runs
`npm run check:api` without thinking about ports), `.env` silently
populates `process.env.PORT = "8789"`. The harness then either collides
with production or masks the collision behind a confusing test failure.

### 2.3 The sibling server re-used `serverProcess`

The Phase Q `TEST_NO_PASSCODE=1` branch spawned a sibling server with
`PORT = priorPort + 1`, but assigned the handle to the same
`serverProcess` global. Cleanup logic in the `finally` block killed
whichever process it happened to see — sometimes the main server, not
the sibling — and the main server's port was implicitly assumed.

## 3. The fix

### 3.1 `server/index.js` — treat `PORT=0` as "OS-assigned"

```js
const PORT = (() => {
  const raw = process.env.PORT;
  if (raw === undefined || raw === null || raw === '') return 8789;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 8789;
})();
```

This preserves the production default of 8789 when `PORT` is unset,
non-numeric, or negative, but correctly accepts `PORT=0` as "OS, please
pick a free ephemeral port".

The `app.listen` callback now logs the **actual** bound port via
`server.address().port`, so the bind line is meaningful even when
`PORT=0` resolves to an ephemeral allocation:

```js
const actualPort = server.address().port;
console.log(`MiniMax studio backend running on ${HOST}:${actualPort}`);
```

### 3.2 `scripts/check-api-regression.js` — harness owns the port

- After `dotenv.config()`, the harness **scrubs** `REQUIRE_SITE_PASSCODE`
  and `CLOUDFLARE_ACCESS_EXPECTED` from `process.env`, then strips
  `process.env.PORT` if it equals the literal production default
  (`"8789"`). The heuristic is conservative: an operator who really
  wants to test on 8789 sets `PORT` to anything else (e.g. `18789`).
- `REQUESTED_PORT` defaults to `'0'`, which the server now resolves to
  an OS-allocated ephemeral port.
- `BASE` is **parsed from the child server's stdout** (`MiniMax studio
  backend running on HOST:PORT`) and rewritten before `runChecks()`
  executes, so all assertions target the live URL.
- The main server uses `startServer()`; the no-passcode sibling uses
  a new `startSiblingServer()` helper that returns its own
  `{ proc, base, stop, getStdout, getStderr }` handle. The main
  server's `serverProcess` slot is **never** reassigned, so cleanup
  remains deterministic.
- Child server env is explicit and minimal: `PORT`, `NODE_ENV=test`,
  `REQUIRE_SITE_PASSCODE`, `CLOUDFLARE_ACCESS_EXPECTED`. The harness
  inherits `PATH` and `HOME` from the parent but never `.env`-derived
  port/access knobs.

## 4. How `check:api` avoids production 8789

| Knob | Default | Override | Behavior |
| --- | --- | --- | --- |
| `PORT` | unset → harness scrubs `.env`'s `8789`, leaves unset | operator-set non-8789 value | server binds that port |
| `PORT=0` (typical harness call) | OS picks an ephemeral port | n/a | server prints actual bind in stdout; harness parses it |
| `REQUIRE_SITE_PASSCODE` | harness injects `true` | `OPT_NO_PASSCODE=1` / `TEST_NO_PASSCODE=1` (no-passcode mode) | harness injects `false` into the sibling only |
| `CLOUDFLARE_ACCESS_EXPECTED` | harness injects `false` | `OPT_NO_PASSCODE=1` / `TEST_NO_PASSCODE=1` | harness injects `true` into the sibling only |

Net result: `npm run check:api` runs the main server on an OS-picked
ephemeral port (e.g. 38033), the optional sibling on a *different*
ephemeral port (e.g. 33401), and production's systemd listener on 8789
is untouched.

## 5. no-passcode mode naming

Two env flags now mean the same thing:

- `OPT_NO_PASSCODE=1` — canonical name (preferred in docs and CI).
- `TEST_NO_PASSCODE=1` — legacy alias kept for backward compatibility
  with the Phase Q branch and any external scripts that already use it.

Both flags produce identical harness behavior. The startup log line
explicitly shows both values so operators can see which one triggered
the mode:

```
[phase-i] no-passcode mode enabled (OPT_NO_PASSCODE=1 TEST_NO_PASSCODE=)
[phase-i] sibling server up on http://127.0.0.1:33401 (main on http://127.0.0.1:38033)
```

## 6. Verification

### 6.1 Local (this host, `~/.../projects/minimax-video-studio`)

```
npm run build                                  → vite build OK (31 modules, dist unchanged)
npm run smoke:video                            → dry_run skipped, real_quota_consumed=No
npm run smoke:i2v                              → dry_run_ok, fixture validation PASS, no real task
npm run fixture:i2v:validate                   → 10/10 PASS
npm run check:minimax-auth                     → auth_ok: yes (token-plan endpoint 200)
npm run check:api                              → 75/75 PASS, main on 127.0.0.1:38033
OPT_NO_PASSCODE=1 npm run check:api            → 83/83 PASS, sibling=33401 main=38033
TEST_NO_PASSCODE=1 npm run check:api           → 83/83 PASS, sibling=43383 main=45899
ss -ltnp | grep ':8789 '                       → still production pid=251241 only
```

No `MINIMAX_API_KEY`, no `SITE_PASSCODE`, no `Authorization` header,
no real `task_id`/`file_id`/`download_url`/Base64 echoed anywhere in
the runs above.

### 6.2 Remote (CVM `VM-0-4-ubuntu`, `~/apps/minimax-video-studio`)

After `git push origin main` lands the Phase R commit:

```
BEFORE:
  systemctl --user is-active minimax-video-studio.service → active
  curl http://127.0.0.1:8789/api/health                    → 200 ok
  ss -ltnp | grep ':8789 '                                 → pid=2838068

RUN:
  npm install --no-audit --no-fund   → up to date
  npm run build                      → vite build OK
  npm run smoke:video                → dry_run skipped
  npm run smoke:i2v                  → dry_run_ok
  npm run fixture:i2v:validate       → 10/10 PASS
  npm run check:api                  → 75/75 PASS (port parsed from stdout)
  OPT_NO_PASSCODE=1 npm run check:api→ 83/83 PASS (sibling ≠ main port)
  TEST_NO_PASSCODE=1 npm run check:api → 83/83 PASS (legacy alias works)

AFTER:
  systemctl --user is-active minimax-video-studio.service → active (unchanged)
  curl http://127.0.0.1:8789/api/health                    → 200 ok (unchanged)
  ss -ltnp | grep ':8789 '                                 → pid=2838068 (unchanged)
```

Production was never stopped, never restarted, never restarted by
Phase R. The CVM's systemd service kept listening on 8789 for the
entire run. The check:api child processes used OS-assigned ports and
exited cleanly.

## 7. Phase R explicit assertion

The harness now records a dedicated assertion so future regressions
cannot silently break isolation:

```
[PASS] Phase R sibling server bound on a different port than main server - sibling=33401 main=38033
```

This assertion runs **only** in no-passcode mode (because that is the
only branch that spawns a sibling server), and it compares the parsed
`URL.port` of the sibling's `BASE` against the main server's `BASE`.
A passing value guarantees no two simultaneous harnesses can collide.

## 8. Side effects observed

None. `package.json` / `package-lock.json` are untouched (the harness
already had every dependency it needs). `dist/` hash is unchanged.
`reports/local/i2v-real-smoke.lock` is unchanged. No tag was created.

## 9. Security review

- `MINIMAX_API_KEY` value never appears in `childEnv`, `serverStdout`,
  `serverStderr`, or any log line produced by Phase R. The harness
  inherits `process.env` minus the scrubbed keys, so any keys the
  parent shell already had are inherited — this matches pre-Phase R
  behavior and does not weaken the existing secret-handling posture.
- `SITE_PASSCODE` is passed to the child server (it must be, for the
  passcode path to be exercised). It is never echoed in logs; the
  Phase Q "no passcode leak" assertions remain active and pass.
- Authorization headers / Cloudflare cookies / access tokens: not
  introduced. None were read, written, or logged.
- Real `task_id` / `file_id` / `download_url` / Base64: not present.
  The Phase J I2V smoke harness still uses dry-run fixtures only.
- `reports/local/i2v-real-smoke.lock`: not modified, not deleted, not
  recreated.
- Cloudflare Tunnel / Access: untouched on both hosts.

## 10. Next steps

1. **Phase S — sibling-server stress.** Run `check:api` three times in
   rapid succession under both `OPT_NO_PASSCODE=1` and default mode,
   confirming the OS never reuses the same ephemeral port within the
   harness lifetime.
2. **Phase T — public-port assertion.** Add a check that fails loudly
   if any child server (main or sibling) ever binds to `127.0.0.1:8789`
   while a separate process holds it — a guardrail against future
   regressions of this exact bug class.
3. **Phase U — single-binary distribution.** Bundle `scripts/` + the
   regression harness into one `npm run verify` entrypoint that
   operators can run on a fresh CVM after deploy, as a final
   pre-rollout gate.

## 11. Commits in this phase

- `Isolate check:api from production port` — single commit on
  `origin/main`, no tag created.

(Hash recorded in the closing summary; not committed to this report
file because the report must be byte-stable for archival.)
