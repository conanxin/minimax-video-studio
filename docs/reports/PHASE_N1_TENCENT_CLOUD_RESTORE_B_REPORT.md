# Phase N.1-Restore-B — Tencent Cloud Restore Deployment Report

**Date (UTC):** 2026-06-17T02:35:00Z
**Local HEAD:** 322c48d
**Deployed Tag (remote):** v0.2.1-alpha (commit `96e9691`)
**Remote Target:** `tencent-minimax` (118.195.129.137, user `ubuntu`)
**Remote Path:** `/home/ubuntu/apps/minimax-video-studio`
**Service Unit:** `~/.config/systemd/user/minimax-video-studio.service`
**Status:** **PASS** — service restored, all non-consuming checks green.

---

## 1. What this phase did

Phase N.1-Restore-B is the recovery half of Phase N.1 after a remote cleanup
event wiped `~/apps/minimax-video-studio` on `tencent-minimax`. Restore-A had
already re-cloned the repo at `v0.2.1-alpha` and prepared `.env` + the
once-only lock. Restore-B then:

1. Verified `.env` was operator-filled (no `replace_with` placeholder).
2. Ran `npm install` + `npm run build`.
3. Ran non-consuming checks: `fixture:i2v:validate`, `smoke:video`,
   `smoke:i2v`, `check:api`, and the live Token Plan probe
   `check:minimax-auth`.
4. Recreated the systemd user service, enabled it, and restarted.
5. Verified health endpoint, port binding, and lock preservation.

No real video tasks were created. No quota was consumed by the deployment
itself; only the Token Plan probe issued one HTTP GET.

## 2. Deployment artifact

| Item | Value |
| --- | --- |
| Source repo | `https://github.com/conanxin/minimax-video-studio` |
| Tag checked out on remote | `v0.2.1-alpha` |
| Remote commit | `96e9691` ("Prepare v0.2.1-alpha maintenance release") |
| Local repo HEAD (unrelated) | `322c48d` (this report's commit) |
| Install size | ~318 npm packages |
| Build output | `dist/index.html` (0.40 kB) + `dist/assets/index-*.css` (7.92 kB) + `dist/assets/index-*.js` (173.61 kB) |
| Health version reported | `0.1.0` (server `package.json` version) |

## 3. Non-consuming checks

| Step | Outcome |
| --- | --- |
| `npm install` | OK |
| `npm run fixture:i2v:validate` | **10/10 PASS** (exit=0) |
| `npm run build` | OK (31 modules transformed, built in 779 ms) |
| `npm run smoke:video` | dry-run, `final_status: skipped`, `real_quota_consumed: No` |
| `npm run smoke:i2v` | dry-run, `final_status: dry_run_ok`, `real_quota_consumed: No`, `fixture_validation: PASS`, `data_url_present: yes`, `first_frame_image_sha256_short: fd453001`, `first_frame_image_data_url_chars: 504754` |
| `npm run check:api` | **72/72 PASS** — final summary line: "all checks PASSED. No real MiniMax task was created." |
| `npm run check:minimax-auth` | `auth_ok: yes` — `http_status: 200`, `base_resp_status_code: 0`, `base_resp_status_msg: "success"`, `auth_reason: token_plan_200_and_base_resp_0`, `network: ok` |

The Token Plan call only hit `GET /v1/token_plan/remains`. It did not
invoke `/v1/video_generation` or `/v1/image_to_video`.

## 4. systemd user service

- Unit file: `/home/ubuntu/.config/systemd/user/minimax-video-studio.service`
- Enabled: yes (`~/.config/systemd/user/default.target.wants/minimax-video-studio.service` symlink present)
- Active state: `active (running)` since service restart
- Main PID: `2808114` (`npm run start`) → child PID `2808127` (`node server/index.js`)
- Memory: 38.0 MB
- CGroup: `/user.slice/user-1000.slice/user@1000.service/app.slice/minimax-video-studio.service`
- Startup log: `MiniMax studio backend running on :8789 / SQLite db path: ./data/minimax-video-studio.sqlite / Polling guardrails: maxAttempts=60, maxDurationMinutes=20, initialIntervalMs=10000, maxIntervalMs=30000`

## 5. Port binding

`ss -ltnp | grep :8789` on the remote:

```
LISTEN 0 511 *:8789 *:* users:(("node",pid=2808127,fd=21))
```

Bound on all interfaces (IPv4 + IPv6 via `*`). Phase O (reverse proxy) is
the right time to tighten this to loopback-only if the Tencent Cloud
security group does not already block inbound 8789.

## 6. Health check

`curl -fsS http://127.0.0.1:8789/api/health`:

```
{"ok":true,"service":"minimax-video-studio","environment":"production","version":"0.1.0"}
```

HTTP 200, no key/Authorization fragment in body, no download_url leak.

## 7. Deployment safety lock

`reports/local/i2v-real-smoke.lock` was created in Restore-A and was **not
modified or removed** during Restore-B.

```
-rw------- 1 ubuntu ubuntu 134 Jun 17 10:24 reports/local/i2v-real-smoke.lock
```

## 8. Did this phase create video tasks or consume quota?

- `CONFIRM_REAL_VIDEO` and `CONFIRM_REAL_I2V` were not set.
- `smoke:video` and `smoke:i2v` both reported `real_quota_consumed: No`.
- `check:api` closed with: "all checks PASSED. No real MiniMax task was created."
- The only outbound API call was `GET /v1/token_plan/remains` via
  `check:minimax-auth`, which is a usage-quota read (not a video-generation
  submission).

## 9. Sensitive information disclosure check

Inspected for any of: full `MINIMAX_API_KEY`, full `SITE_PASSCODE`,
full `Authorization` header, real `task_id` / `file_id` /
`download_url`, full Base64 / Data URL payloads.

| Class | Captured in report? |
| --- | --- |
| Full `MINIMAX_API_KEY` | No (only length, sha256_short, "exists: yes") |
| Full `SITE_PASSCODE` | No (only length captured, never echoed) |
| Full `Authorization` header | No (never logged by any script) |
| Real `task_id` / `file_id` / `download_url` | No (dry-run path produces none; auth probe did not return any) |
| Full Data URL / Base64 first-frame | No (only sha8 and character count summary) |

## 10. Did this phase touch Nginx / Caddy / Apache?

No. No reverse proxy config was added, modified, or deleted. No HTTPS
or DNS was configured.

## 11. Current blockers

None. The service is up, healthy, and bound on 8789. Real I2V smoke is
still blocked by the once-only lock and by the absence of
`CONFIRM_REAL_VIDEO=1` / `CONFIRM_REAL_I2V=1`.

## 12. Recommended next phase

**Phase O — Reverse proxy / HTTPS / domain**

Candidate sequence (requires explicit operator authorization):

1. Acquire a domain and point its DNS A record to `118.195.129.137`.
2. Install Caddy (auto-HTTPS) on the CVM.
3. Author a minimal Caddyfile that reverse-proxies
   `https://<domain>` → `127.0.0.1:8789`.
4. After the reverse proxy is verified, tighten the node binding to
   `127.0.0.1` only (server-side `app.listen(PORT, '127.0.0.1')` or a
   security-group change), so 8789 is no longer publicly reachable.
5. Verify `https://<domain>/api/health` returns HTTP 200.

## 13. Final verdict

**Phase N.1-Restore-B: PASS.** All non-consuming checks succeeded, no
quota was consumed by the deployment, the once-only lock is intact, the
systemd service is `active (running)`, the health endpoint returns
HTTP 200, and no sensitive material leaked into logs or this report.
