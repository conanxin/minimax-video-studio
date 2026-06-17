# Phase P.1 — Remote UI Rollout Report

**Phase name:** Phase P.1 — Deploy UI branding update to Tencent Cloud
**Status:** **PASS**
**Date (UTC):** 2026-06-17
**Local repo:** `/home/conanxin/.hermes/workspace/projects/minimax-video-studio`
**Remote target:** `tencent-minimax` (118.195.129.137, user `ubuntu`)
**Remote path:** `/home/ubuntu/apps/minimax-video-studio`
**Public URL:** `https://mvs.conanxin.com` (unchanged)

---

## 1. What this phase did

Phase P shipped the UI branding update on `main` (new `<title>`,
new `<h1>`, new hero subtitle, new live `Runtime: <version>` line
fetched from `/api/health`). The CVM was still running the
previous build from Phase N.1-C, so the public URL was still
showing the stale "MiniMax Text-to-Video MVP" UI even though the
Node process was `v0.2.2-alpha`.

Phase P.1 only deploys the new UI to the CVM. No code or config
was changed during this phase:

- `git fetch origin main --tags`
- `git checkout -B main origin/main` (advances the local main
  branch from `9540a67` to `917c7ad`)
- `npm install` (idempotent, picks up the `917c7ad` `package.json`
  / `package-lock.json`)
- `npm run build` (rebuilds `dist/` with the Phase P UI changes)
- `npm run smoke:video` / `smoke:i2v` / `check:api` /
  `check:minimax-auth` (all non-consuming; confirm the new build
  is still green offline)
- `systemctl --user restart minimax-video-studio.service` (picks
  up the new `dist/`)

`server/index.js`, `package.json` `version`, the systemd unit,
the `.env`, the I2V once-only lock, the Cloudflare Tunnel, and
the Cloudflare Access policy were all left untouched.

## 2. Remote commit before deploy

```
$ git rev-parse --short HEAD
9540a67
$ git describe --tags --exact-match
v0.2.2-alpha
```

The remote was pinned at `v0.2.1-alpha` `bind runtime to localhost
by default` — i.e. the Phase N.1-C deploy. The UI build was the
Phase N.1-C build, which still had the Phase G `<h1>` and subtitle.

## 3. Remote commit after deploy

```
$ git rev-parse --short HEAD
917c7ad
$ git log -1 --oneline
917c7ad Align UI branding with v0.2.2-alpha
```

The remote advanced to `917c7ad` (Phase P). Note this commit does
not move the deployed `package.json` version — `v0.2.2-alpha`
remains the recommended tag — because Phase P was a UI-only change.

## 4. Did this phase create video tasks?

**No.** `CONFIRM_REAL_VIDEO` and `CONFIRM_REAL_I2V` were not set.
The "Submit task" button was not pressed.

## 5. Did this phase consume quota?

**No.** The smoke checks were dry-run only. The only outbound
MiniMax call was `GET /v1/token_plan/remains` from
`check:minimax-auth`, which is a usage-quota read and does not
trigger `/v1/video_generation` or `/v1/image_to_video`.

## 6. Build / smoke dry-run / check:api / auth-only results

| Step | Result |
| --- | --- |
| `npm install` | OK |
| `npm run build` | OK (vite v5.4.21, 31 modules; `dist/index.html` 0.41 kB, `dist/assets/index-DA3EGklt.js` 174.07 kB (gzip 57.08 kB), `dist/assets/index-DJ45okvy.css` 7.92 kB; built in 743 ms) |
| `npm run smoke:video` | dry-run, `final_status: skipped`, `real_quota_consumed: No` |
| `npm run smoke:i2v` | dry-run, `final_status: dry_run_ok`, `real_quota_consumed: No`, `fixture_validation: PASS`, `data_url_present: yes` |
| `npm run check:api` | **72/72 PASS** — final summary: "all checks PASSED. No real MiniMax task was created." |
| `npm run check:minimax-auth` | `auth_ok: yes`, `http_status: 200`, `base_resp_status_code: 0`, `auth_reason: token_plan_200_and_base_resp_0` |

## 7. Service active

```
$ systemctl --user is-active minimax-video-studio.service
active
```

The service was restarted and is running with the new build.

## 8. Local health (loopback)

```
$ curl -fsS http://127.0.0.1:8789/api/health
{"ok":true,"service":"minimax-video-studio","environment":"production","version":"v0.2.2-alpha"}

$ ss -ltnp | grep ":8789"
LISTEN 0 511 127.0.0.1:8789 0.0.0.0:* users:(("node",pid=2826878,fd=21))
```

HTTP 200, `version: "v0.2.2-alpha"`, Node still bound on
`127.0.0.1:8789` (loopback only — no public direct exposure).

## 9. Cloudflare Access public result

```
$ curl -I https://mvs.conanxin.com
HTTP/2 302
location: https://soft-wood-f891.cloudflareaccess.com/cdn-cgi/access/login/mvs.conanxin.com?kid=...&meta=...&redirect_url=%2F
www-authenticate: Cloudflare-Access resource_metadata="https://mvs.conanxin.com/.well-known/cloudflare-access-protected-resource/"
server: cloudflare
cf-ray: ...
```

```
$ curl -I https://mvs.conanxin.com/api/health
HTTP/2 302
location: https://soft-wood-f891.cloudflareaccess.com/cdn-cgi/access/login/mvs.conanxin.com?kid=...&meta=...&redirect_url=%2Fapi%2Fhealth
www-authenticate: Cloudflare-Access resource_metadata="https://mvs.conanxin.com/.well-known/cloudflare-access-protected-resource/api/health"
server: cloudflare
cf-ray: ...
```

Both the root `/` and `/api/health` paths return HTTP 302 redirecting
to `cloudflareaccess.com` with the `www-authenticate: Cloudflare-Access
resource_metadata=...` header. **Cloudflare Access is still
enforcing on the public hostname**, exactly as it was in Phase O-CF.

The Access `kid` (the public policy identifier in the `Location:`
URL) is identical between the Phase O-CF probe and the Phase P.1
probe, confirming the Access policy itself was not modified by
this phase — only the CVM origin content changed.

## 10. Sensitive information disclosure check

| Class | Captured in this report? |
| --- | --- |
| Full `MINIMAX_API_KEY` | No (length only, never echoed) |
| Full `SITE_PASSCODE` | No (length only, never echoed) |
| Full `Authorization` header | No (never logged) |
| Real `task_id` / `file_id` / `download_url` | No (none generated) |
| Full Data URL / Base64 first-frame | No (only sha8 + char count summary in `smoke:i2v` output, not in this report) |
| `CF_AppSession` cookie value | No (header reproduced structurally; cookie value not captured) |
| Cloudflare Access `meta` payload | No (truncated to first ~14 characters in this report; full token not captured) |

## 11. Git hygiene check

- `.env` unchanged on disk; `chmod 600` preserved.
- `reports/local/i2v-real-smoke.lock` mtime unchanged (`Jun 17
  10:24`) and content unchanged — only `npm run check:api` and
  its test-mode lock file touched lock-adjacent paths.
- No `git clean` executed.
- No new tag was created (`v0.2.2-alpha` remains the latest tag).
- No `node_modules` / `dist` / `data/` / `logs/` committed.

## 12. Recommended next phase

1. **Browser-side visual verification.** Log in through Cloudflare
   Access and confirm the page renders:
   - `<title>`: `MiniMax Video Studio`
   - `<h1>`: `MiniMax Video Studio`
   - Subtitle: `T2V and I2V verified · v0.2.2-alpha · Cloudflare Access protected`
   - Runtime line: `Runtime: v0.2.2-alpha · Service: production`
2. **Cloudflare Access policy audit.** Verify audience / IdP /
   session duration match the operator's threat model.
3. **Optional: pin UI version label to git SHA.** Operators who
   want to distinguish a hot-patched build from the tagged
   release can additionally set `APP_VERSION` to the short git
   SHA at deploy time. Not in scope for this phase.

## 13. Final verdict

**Phase P.1: PASS.** The CVM now runs the Phase P build (commit
`917c7ad`), the local health endpoint reports `v0.2.2-alpha`, the
service is `active`, the Cloudflare Tunnel + Access policy are
unchanged and still enforcing, and the offline regression stays
green at 72/72. No video task was created; no quota was consumed;
no sensitive material leaked.
