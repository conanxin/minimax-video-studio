# Phase Q — Disable App Passcode When Protected by Cloudflare Access

**Phase name:** Phase Q — Disable App Passcode When Protected by Cloudflare Access
**Status:** **PASS**
**Date (UTC):** 2026-06-17
**Local repo:** `/home/conanxin/.hermes/workspace/projects/minimax-video-studio`
**Public URL:** `https://mvs.conanxin.com`
**Deployed tag (CVM):** `v0.2.2-alpha` (plus UI rollout `917c7ad` + docs `473cfcf`)

---

## 1. What this phase did

Phase Q adds an open-source-friendly switch that lets an operator
disable the in-app `SITE_PASSCODE` middleware once the deployment
is already gated upstream by Cloudflare Access (or any equivalent
IdP-fronted reverse proxy). The change is opt-in: a fresh clone of
the repo still defaults to `SITE_PASSCODE` being required.

Concretely:

- **`server/index.js`**
  - Reads two new env vars: `REQUIRE_SITE_PASSCODE` (default
    `true`) and `CLOUDFLARE_ACCESS_EXPECTED` (default `false`,
    informational only).
  - `requirePasscode` middleware now short-circuits to `next()`
    when `REQUIRE_SITE_PASSCODE` is `false`.
  - New unauthenticated endpoint `GET /api/runtime-config`
    returns the booleans `require_site_passcode`,
    `cloudflare_access_expected`, and `version`. It deliberately
    never echoes `SITE_PASSCODE`, `MINIMAX_API_KEY`, or any other
    secret.
- **`web/src/App.jsx`**
  - Fetches `/api/runtime-config` on mount.
  - Hides the `Passcode` input when `require_site_passcode` is
    `false`; shows an "Access is protected by Cloudflare Access."
    banner instead.
  - `requestJson` no longer attaches the passcode to requests
    when the server has signalled that it is not required.
  - The hero subtitle now drops "Cloudflare Access protected"
    unless the server reports `cloudflare_access_expected: true`,
    so the marketing line and the runtime truth agree.
- **`scripts/check-api-regression.js`**
  - Added three always-on assertions against `/api/runtime-config`:
    shape ok (booleans + version string), no key leak, no passcode
    leak.
  - Added an opt-in block (gated by `TEST_NO_PASSCODE=1`) that
    spawns a sibling server with `REQUIRE_SITE_PASSCODE=false`
    and asserts that `/api/runtime-config` reports
    `require_site_passcode: false`, that `GET /api/tasks` returns
    200 without a passcode, and that `POST /api/video/create`
    returns 400 (validation) instead of 401 (auth) when no
    passcode is provided.
  - Removed a duplicate `assertNoKeyLeakage` placeholder that was
    sitting unused above the real definition.
- **`.env.example`** now documents the new vars (commented out by
  default so a fresh clone still works as before).
- **`README.md`** got a new "Disabling the in-app passcode behind
  Cloudflare Access (Phase Q)" subsection under Deployment, with
  the prerequisite list and the explicit "don't skip any of these"
  guardrails.

## 2. Why a switch instead of deleting the passcode

Deleting `SITE_PASSCODE` entirely would have been a breaking
change for anyone running the open-source starter without an
upstream IdP. The switch keeps the default behaviour **safe**
(`REQUIRE_SITE_PASSCODE=true`) and gives operators who are
already protected by Cloudflare Access a documented way to drop
the redundant second factor without forking the project.

The switch is also a guardrail, not just an ergonomic feature:

- It defaults to `true` so that any deployment that does not
  actively opt in still has the in-app passcode as a second
  factor.
- The UI hides the input only after the server has confirmed the
  flag; until then, the input stays visible (fail-closed).
- The README prerequisite list explicitly calls out that the
  public hostname must be fronted by Cloudflare Access, that
  `8789` must NOT be reachable from the public internet, and that
  `HOST=0.0.0.0` must NOT be set. Skipping any of these leaves
  the deployment exposed.

## 3. Back-end endpoints affected

`requirePasscode` middleware is applied to:

- `GET  /api/tasks`
- `POST /api/video/create`
- `GET  /api/video/task/:taskId`
- `GET  /api/video/file/:fileId`
- `POST /api/video/file/:fileId/refresh`

When `REQUIRE_SITE_PASSCODE=false`, **all five** skip the
middleware entirely; the route handlers are reached without a
passcode in the query string / body / header.

Always-public, never-gated, unaffected by the switch:

- `GET /api/health` — version / environment probe.
- `GET /api/runtime-config` — runtime flags for the UI.
- `GET /api/video/models` — text-to-video model matrix.
- `GET /api/video/i2v/models` — image-to-video model matrix.
- `GET /api/generation-modes` — generation modes summary.
- `GET /api/polling/config` — polling guardrails.
- `GET /api/download-link/config` — download-link TTLs.
- `GET /` (frontend `index.html`) — Vite-built static SPA.

## 4. Front-end UI behaviour

`passcodeRequired` (derived from `/api/runtime-config`):

- `true` (default when the runtime-config fetch fails or returns
  `require_site_passcode: true`): the `Passcode` card is rendered
  with the existing input box. Requests still include the
  passcode. The hero subtitle includes
  "· Cloudflare Access protected" only when
  `cloudflare_access_expected` is also `true`.
- `false`: the `Passcode` card is replaced by an
  "Access is protected by Cloudflare Access." banner. Requests
  omit the passcode query/body/header. The hero subtitle no longer
  pretends Access is in the path unless the server has explicitly
  said so.

The "Submit task" button's local check (`if (passcodeRequired && !passcode.trim())`)
preserves the old error message when the input is required, and
skips the check entirely when it is not.

## 5. Default safety preserved

- A fresh clone with no `.env` overrides will load
  `SITE_PASSCODE` from `.env.example`'s `change_me` placeholder,
  parse `REQUIRE_SITE_PASSCODE` as unset → `true`, and keep the
  existing 401-on-no-passcode behaviour.
- `/api/runtime-config` is unauthenticated and never carries
  secrets; the new `assertNoPasscodeLeakage` helper checks both
  the configured `SITE_PASSCODE` and the default `change_me`.
- The check-api regression suite grows from 72 → 75 assertions
  on the default mode (three new always-on runtime-config
  assertions) and from 75 → 82 on the opt-in `TEST_NO_PASSCODE=1`
  mode (three Phase-Q assertions + three leak assertions against
  the sibling server).

## 6. Did this phase create video tasks?

**No.** `CONFIRM_REAL_VIDEO` and `CONFIRM_REAL_I2V` were not set
in any invocation during this phase. The opt-in `check:api` run
spun up a sibling server with `REQUIRE_SITE_PASSCODE=false` and
issued exactly one `POST /api/video/create` with an invalid
`resolution: "4K"` body — the server responded with HTTP 400
**before** any forward to MiniMax. No `POST /v1/video_generation`
or `POST /v1/image_to_video` was sent.

## 7. Did this phase consume quota?

**No.** The only outbound MiniMax API calls during the two
`check:api` runs (default mode and `TEST_NO_PASSCODE=1` mode) were
the standard `GET /v1/token_plan/remains` from
`check:minimax-auth`, which is a usage-quota read. The local
sibling server in `TEST_NO_PASSCODE=1` mode was started with
`NODE_ENV=test` and never issued an outbound MiniMax call.

## 8. Local verification

| Mode | Command | Result |
| --- | --- | --- |
| default (`REQUIRE_SITE_PASSCODE=true`) | `npm install` | OK |
| default | `npm run build` | OK (vite v5.4.21, 31 modules; `dist/assets/index-BwDG7Cfl.js` 175.11 kB / gzip 57.37 kB) |
| default | `npm run smoke:video` | dry-run, `final_status: skipped`, `real_quota_consumed: No` |
| default | `npm run smoke:i2v` | dry-run, `final_status: dry_run_ok`, `real_quota_consumed: No`, `fixture_validation: PASS`, `data_url_present: yes` |
| default | `npm run check:api` | **75/75 PASS** (72 existing + 3 new runtime-config assertions; final summary: "all checks PASSED. No real MiniMax task was created.") |
| opt-in Phase Q | `TEST_NO_PASSCODE=1 npm run check:api` | **82/82 PASS** (75 + 7 Phase-Q assertions: S1 runtime-config shape + 2 leak, S2 `/api/tasks` no passcode 200 + 2 leak, S3 `/api/video/create` no passcode 400) |

Runtime-config shape verified on both modes:

- default mode:
  `{"require_site_passcode":true,"cloudflare_access_expected":false,"version":"0.2.2-alpha"}`
- opt-in mode:
  `{"require_site_passcode":false,"cloudflare_access_expected":true,"version":"0.2.2-alpha"}`

The default-mode response confirms that an operator who has not
set either env var still gets `require_site_passcode: true` and
the UI continues to show the input box. The opt-in response
confirms that flipping `REQUIRE_SITE_PASSCODE=false` does exactly
what it says.

## 9. Remote verification

The remote CVM was updated to `origin/main` and the deployment
process set `REQUIRE_SITE_PASSCODE=false` and
`CLOUDFLARE_ACCESS_EXPECTED=true` in `/home/ubuntu/apps/minimax-video-studio/.env`,
then restarted the systemd service. After restart:

- `systemctl --user is-active minimax-video-studio.service` →
  `active`.
- `curl -fsS http://127.0.0.1:8789/api/health` → HTTP 200,
  `version: "v0.2.2-alpha"`.
- `curl -fsS http://127.0.0.1:8789/api/runtime-config` →
  HTTP 200, `require_site_passcode: false`,
  `cloudflare_access_expected: true`, `version: "v0.2.2-alpha"`.
- `ss -ltnp | grep ":8789"` → `LISTEN 0 511 127.0.0.1:8789`
  (loopback only — Node has not silently rebind to `*:8789`).
- The I2V once-only lock `reports/local/i2v-real-smoke.lock` was
  not touched.

The Cloudflare Tunnel / Access policy is unchanged; the public
URL still returns HTTP 302 to the Access login flow for
unauthenticated requests.

### Remote check-api pass: operator workflow note

`npm run check:api` on the CVM has a known interaction with the
Phase Q switch that is worth recording here so future operators do
not get bitten by it:

- `check-api-regression.js` spawns a sibling server on the same
  port (`PORT=8789`) that the production systemd service already
  holds. Without coordination, the child process fails with
  `EADDRINUSE` while `curl` still gets responses from the
  production server (which is the *previous* release until
  systemd is restarted). The first attempt on the CVM landed on
  a `74/75` line because the production server was still on
  `917c7ad` and did not yet expose `/api/runtime-config`.
- The Phase Q-aware procedure is:
  1. `systemctl --user stop minimax-video-studio.service`
  2. `sed -i '/^REQUIRE_SITE_PASSCODE=/d;/^CLOUDFLARE_ACCESS_EXPECTED=/d' .env`
     so the sibling server inherits a default passcode-on env
     (otherwise the new Phase Q default would break the legacy
     `GET /api/tasks without passcode -> 401` assertion).
  3. `npm run check:api` — expect `75/75 PASS`.
  4. Restore the deleted lines, then
     `systemctl --user start minimax-video-studio.service`.

That run on the CVM completed with `75/75 checks passed` and the
production service restarted cleanly into the Phase Q
`REQUIRE_SITE_PASSCODE=false` mode.

This workflow gap is not a Phase Q bug — it is a pre-existing
property of `check-api-regression.js` that only becomes visible
once the production deployment sets a non-default
`REQUIRE_SITE_PASSCODE`. A future phase can address it (e.g.
make the child server pick `PORT=0` so the OS allocates a free
port, or pass `REQUIRE_SITE_PASSCODE=true` explicitly into the
child env); that refactor is out of scope for Phase Q.


## 10. Sensitive information disclosure check

| Class | Captured in this report? |
| --- | --- |
| Full `MINIMAX_API_KEY` | No (only length, never echoed) |
| Full `SITE_PASSCODE` | No (only length, never echoed) |
| Full `Authorization` header | No (never logged) |
| `CF_AppSession` cookie / `kid` / `meta` | No (header structure summarised; values not captured) |
| Real `task_id` / `file_id` / `download_url` | No (none generated) |
| Full Data URL / Base64 first-frame | No (only sha8 + char count summary in `smoke:i2v` output) |
| Runtime-config response body | Yes — captured structurally (3 fields, no secrets) |

The runtime-config response body is the only "sensitive-ish"
payload captured here. It is safe to record by construction
(no secret material in the schema).

## 11. Git hygiene check

- `git status --short` before commit: only the intended files
  (`server/index.js`, `web/src/App.jsx`,
  `scripts/check-api-regression.js`, `.env.example`, `README.md`).
- `.gitignore` still excludes `.env`, `reports/local/`,
  `data/*.db`, `data/*.sqlite`, `node_modules/`, `dist/`, `logs/`.
- No new tag was created (`v0.2.2-alpha` remains the latest tag).
- `git ls-files | grep -E '\.env$|^reports/local|\.sqlite$|/node_modules/|^dist/|^logs/'`
  → no rows.

## 12. Recommended next phase

1. **Browser-side visual verification.** Log in through Cloudflare
   Access and confirm:
   - `Passcode` input box is gone.
   - "Access is protected by Cloudflare Access." banner is
     visible.
   - `Refresh list` populates `Task history` without a 401.
   - `Runtime:` line shows `v0.2.2-alpha`.
2. **Optional hardening (not in this phase's scope).**
   - Make `REQUIRE_SITE_PASSCODE` rejection a single helper that
     can also be wired to a `next(error)` so a future access-tier
     refactor (e.g. RBAC) reuses the same gate.
   - Add a Cloudflare WAF rule that denies direct IP origin
     requests so a misconfigured security group does not bypass
     Access.
   - Pin `cloudflared` to a specific tunnel UUID for audit logs.

## 13. Final verdict

**Phase Q: PASS.** The open-source default is unchanged
(`SITE_PASSCODE` still required), the opt-in switch is small and
documented, the runtime-config endpoint is safe by construction,
the offline regression grows from 72 to 75 (default) / 82
(opt-in `TEST_NO_PASSCODE=1`) checks, and the remote CVM now
serves the de-passcode path behind Cloudflare Access as intended.
No video task was created; no quota was consumed; no sensitive
material leaked.
