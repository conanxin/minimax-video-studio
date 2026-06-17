# Phase N.1-C — Runtime Bind Hardening and Health Version Alignment

**Phase name:** Phase N.1-C — Runtime Bind Hardening and Health Version Alignment
**Status:** **PASS**
**Date (UTC):** 2026-06-17
**Local repo:** `/home/conanxin/.hermes/workspace/projects/minimax-video-studio`
**Remote target:** `tencent-minimax` (118.195.129.137, user `ubuntu`)
**Remote path:** `/home/ubuntu/apps/minimax-video-studio`
**Released tag:** `v0.2.2-alpha`

---

## 1. What this phase did

Two deployment deficiencies were observed after Phase N.1-Restore-B:

1. The Node server was bound on `*:8789` (all interfaces), not on
   `127.0.0.1:8789`. A fresh deploy could accidentally be reachable
   from the public internet depending on the host firewall.
2. `/api/health` returned `version: "0.1.0"` regardless of which
   tag was actually deployed. Health checks could not be used to
   confirm the deployed release.

This phase:

- Introduced a `HOST` env variable (default `127.0.0.1`) and updated
  `server/index.js` to bind on that host explicitly.
- Introduced an `APP_VERSION` env variable (with `package.json`
  fallback) and replaced the hardcoded `version: '0.1.0'` in the
  `/api/health` response.
- Bumped `package.json` `version` to `0.2.2-alpha`.
- Shipped a new systemd user unit on the remote CVM that sets
  `HOST=127.0.0.1`, `PORT=8789`, and `APP_VERSION=v0.2.2-alpha`
  explicitly in `Environment=`.
- Published `v0.2.2-alpha` as the recommended deployment baseline.

## 2. Why we changed from `*:8789` to `127.0.0.1:8789`

`app.listen(port, host, callback)` without an explicit `host`
defaults to binding on all interfaces. That is the wrong default
for an MVP intended for a single-operator CVM:

- The Tencent Cloud security group is the only thing standing
  between the process and the public internet. A misconfiguration
  (or a temporary "open everything" debugging step) would expose
  the app immediately.
- The intended Phase O topology is `reverse_proxy(0.0.0.0:443) →
  127.0.0.1:8789`. With the Node process already bound on
  `127.0.0.1`, the reverse proxy is the only public entry point
  and TLS termination is centralised there.
- Loopback bind is a defense-in-depth measure: even if a future
  bug forgets to harden the firewall, the process cannot be
  reached from outside the host.

The override remains available for operators who intentionally
want LAN / non-proxied exposure (`HOST=0.0.0.0`).

## 3. How the health version was fixed

`server/index.js` now reads `APP_VERSION` first, then falls back to
`package.json.version`:

```js
const APP_VERSION =
  process.env.APP_VERSION ||
  (() => {
    try { return require('../package.json').version; }
    catch (_) { return 'unknown'; }
  })();
```

The `/api/health` handler returns `version: APP_VERSION`. The
`v0.2.2-alpha` systemd unit sets
`Environment=APP_VERSION=v0.2.2-alpha`, so a health check on the
remote CVM now reports the deployed tag exactly.

`package.json` `version` was bumped to `0.2.2-alpha` so deployments
that do not set `APP_VERSION` still report the correct version.

## 4. Local pre-release verification

All non-consuming checks passed locally before tagging:

| Check | Result |
| --- | --- |
| `npm install` | OK |
| `npm run fixture:i2v:validate` | 10/10 PASS (sha256[0:8] = `45583417`) |
| `npm run build` | OK (vite v5.4.21, 31 modules transformed) |
| `npm run smoke:video` | dry-run, `final_status: skipped`, `real_quota_consumed: No` |
| `npm run smoke:i2v` | dry-run, `final_status: dry_run_ok`, `real_quota_consumed: No`, `fixture_validation: PASS`, `data_url_present: yes` |
| `npm run check:api` | **72/72 PASS** |
| `npm run check:minimax-auth` | `auth_ok: yes`, `http_status: 200`, `base_resp_status_code: 0` |

## 5. Remote deployment result

The remote CVM was upgraded to `v0.2.2-alpha`:

| Item | Result |
| --- | --- |
| `git checkout v0.2.2-alpha` | OK (precise tag) |
| `npm install` | OK |
| `npm run fixture:i2v:validate` | 10/10 PASS |
| `npm run build` | OK |
| `npm run smoke:video` | dry-run |
| `npm run smoke:i2v` | dry-run |
| `npm run check:api` | 72/72 PASS |
| `npm run check:minimax-auth` | `auth_ok: yes` |
| `systemctl --user is-active` | `active` |
| `curl /api/health` | HTTP 200, `version: "v0.2.2-alpha"` |
| `ss -ltnp \| grep :8789` | `LISTEN 0 511 127.0.0.1:8789` |
| Lock file | preserved (`reports/local/i2v-real-smoke.lock`, mtime unchanged) |

The Node process now binds on `127.0.0.1:8789`, not `*:8789`. The
health endpoint returns the deployed tag.

## 6. Did this phase create video tasks or consume quota?

- `CONFIRM_REAL_VIDEO` and `CONFIRM_REAL_I2V` were not set.
- `smoke:video` and `smoke:i2v` both reported `real_quota_consumed: No`.
- `check:api` closed with: "all checks PASSED. No real MiniMax task was created."
- The only outbound API call was `GET /v1/token_plan/remains` via
  `check:minimax-auth` (Token Plan quota read, not a video submission).
- No real video task was created.

## 7. Sensitive information disclosure check

| Class | Captured? |
| --- | --- |
| Full `MINIMAX_API_KEY` | No (only length, sha256_short, "exists: yes") |
| Full `SITE_PASSCODE` | No (only length, never echoed) |
| Full `Authorization` header | No (never logged) |
| Real `task_id` / `file_id` / `download_url` | No (dry-run + auth probe did not produce any) |
| Full Data URL / Base64 | No (only sha8 + char count summary) |

## 8. Git hygiene check

Before commit:

- `git status --short` is clean apart from the intended
  modifications (`server/index.js`, `package.json`,
  `package-lock.json` if touched, README + docs).
- `.gitignore` continues to exclude `.env`, `reports/local/`,
  `data/*.sqlite`, `logs/`, `node_modules/`, `dist/`.

After commit:

- `git status` clean.
- `git ls-files | grep -E '\.env|reports/local|sqlite|node_modules|dist'` returns no rows.

## 9. Current blockers

None. The remote service is `active`, binds on `127.0.0.1:8789`,
returns `version: "v0.2.2-alpha"` on `/api/health`, and the I2V
once-only lock remains armed.

## 10. Recommended next phase

**Phase O — Reverse proxy / HTTPS / domain**

Candidate sequence (requires explicit operator authorization):

1. Acquire a domain and point its DNS A record to `118.195.129.137`.
2. Install Caddy (or Nginx) on the CVM.
3. Author a minimal Caddyfile:
   `https://<domain> { reverse_proxy 127.0.0.1:8789 }`.
4. Verify `https://<domain>/api/health` returns HTTP 200 with
   `version: "v0.2.2-alpha"`.
5. Confirm Tencent Cloud security group still blocks inbound 8789
   from the public internet; the loopback bind makes this a
   defense-in-depth measure rather than the only barrier.

## 11. Final verdict

**Phase N.1-C: PASS.** The two deployment deficiencies observed
in Phase N.1-Restore-B are closed: the Node process now binds on
`127.0.0.1:8789` by default (with `HOST` override), and
`/api/health` reports the deployed tag through `APP_VERSION`. The
release is published as `v0.2.2-alpha` and deployed on the remote
CVM.
