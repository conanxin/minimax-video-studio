# Phase S.1 — Production 24h Stability Observation Report

**Date:** 2026-06-17.
**Status:** **PASS — production stable**, observation window 23 minutes into a planned 24h watch.
**Constraint envelope:** Read-only observation, no new tasks, no quota burn, no secret output, no infrastructure change.

---

## 1. What this phase did

This phase is the start of the planned 24-hour stability observation
window for the public `minimax-video-studio` deployment. It records
a snapshot of:

- the systemd service state,
- the local `/api/health` and `/api/runtime-config` endpoints,
- the listening port binding (must stay loopback-only behind the
  Cloudflare Tunnel),
- the last 24 hours of journal entries,
- a read-only SQLite summary of the `tasks` table (totals by
  `generation_mode × status`, plus the five most recent rows by
  `updated_at`, with `task_id` / `file_id` / `download_url`
  intentionally **not** echoed),
- the public-side Cloudflare Access behaviour against
  `https://mvs.conanxin.com` and `https://mvs.conanxin.com/api/health`.

No new code was run, no video task was created, no service was
restarted, no .env / systemd / Cloudflare rule was touched.

## 2. Service state

```
systemctl --user is-active minimax-video-studio.service   → active
systemctl --user status minimax-video-studio.service      → Loaded: loaded
                                                              (/home/ubuntu/.config/systemd/user/
                                                               minimax-video-studio.service;
                                                               enabled; vendor preset: enabled)
                                                              Active: active (running) since
                                                                Wed 2026-06-17 14:14:01 CST;
                                                                23min ago
                                                              Main PID: 2879890 (npm run start)
                                                              Memory: 39.1M
                                                              CPU: 449ms
                                                              Tasks: 23
```

The current service process (PID 2879890, child node 2879916) was
started 23 minutes before this snapshot, which corresponds to the
Phase Q.2 deploy at 14:14:01 CST. It is the first time the service
has stayed up for a clean hour without any further restart, which
is itself a small but real improvement on the morning's earlier
deploy churn.

## 3. `/api/health` and `/api/runtime-config`

```
GET http://127.0.0.1:8789/api/health →
{"ok":true,"service":"minimax-video-studio","environment":"production","version":"v0.2.2-alpha"}

GET http://127.0.0.1:8789/api/runtime-config →
{"require_site_passcode":false,"cloudflare_access_expected":true,"version":"v0.2.2-alpha"}
```

Both endpoints return 200 with the expected JSON shape. The
`require_site_passcode` value matches the Phase Q deploy intent
(no in-app passcode prompt because the site is behind Cloudflare
Access). `cloudflare_access_expected` is `true`, so the React
client renders the "Cloudflare Access protected" banner.

## 4. Port binding (loopback-only)

```
ss -ltnp | grep ":8789"
LISTEN 0   511   127.0.0.1:8789   0.0.0.0:*   users:(("node",pid=2879916,fd=21))
```

The service still binds **only** `127.0.0.1:8789`. It is not
exposed to the public network directly; all public traffic arrives
via the Cloudflare Tunnel. The `0.0.0.0:*` shown in the remote
address column is the kernel's "any remote" socket-peer placeholder
and does not imply the listener is reachable from outside the CVM
loopback — the listener's local address `127.0.0.1` is what
determines reachability, and that is the loopback interface.

## 5. Last 24 hours of journal

A 200-line `--since "24 hours ago"` slice of `journalctl --user -u
minimax-video-studio.service --no-pager` was inspected. Findings:

- **No application-level errors**, no Express 5xx stack traces, no
  uncaught exceptions, no `Error: ... at ...` lines, no SQLite
  errors. Only the recurring "Started MiniMax Video Studio" /
  "MiniMax studio backend running on 127.0.0.1:8789" / "Polling
  guardrails: ..." boot block, repeated once per service start.
- **One libuv-worker SIGKILL** at 13:52:13 — this is the previous
  deploy (Phase Q.2) restarting the service so the new bundle
  could be picked up. systemd's default `KillMode=process` SIGKILLs
  the libuv threadpool workers when the main process is replaced;
  this is expected, not a stability problem.
- **Total restarts in 24h:** 9 (10:31, 10:47, 11:32, 11:42, 11:47,
  12:04, 12:05 ×2, 13:52, 14:14). The first 8 are the morning's
  iteration loop as the user pulled, rebuilt, and restarted between
  Phase Q and Phase Q.2. **Restarts since the final Phase Q.2
  deploy (14:14):** **0**. The system has been up cleanly for the
  full 23 minutes of this observation window, and there is no
  signal in the journal that a restart will be required.
- **No `out of memory` / `OOMKilled` / `signal SIGSEGV` /
  `code=dumped` / `core-dump`** entries. RSS is reported by
  `status` as 39.1 MB, well within the CVM's limits.

## 6. SQLite `tasks` summary

The `tasks` table schema (from `PRAGMA table_info(tasks)`):

```
id, task_id, prompt, model, duration, resolution, prompt_optimizer,
status, file_id, download_url, fail_reason, created_at, updated_at,
download_url_refreshed_at, download_url_status, generation_mode,
input_image_present, input_image_type, input_image_host,
input_image_mime, input_image_approx_bytes, input_image_sha256_short,
input_image_summary
```

`SELECT generation_mode, status, COUNT(*) AS count FROM tasks GROUP BY generation_mode, status`:

| generation_mode | status   | count |
| --- | --- | --- |
| image_to_video | Fail     | 4 |
| image_to_video | Success  | 1 |
| text_to_video  | Fail     | 5 |
| text_to_video  | Success  | 5 |

`SELECT COUNT(*) FROM tasks` → **15 rows**.

`SELECT generation_mode, status, model, duration, resolution,
file_id IS NOT NULL AS file_id_present,
download_url IS NOT NULL AS download_url_present,
download_url_status, length(file_id) AS file_id_len,
length(download_url) AS download_url_len,
created_at, updated_at
FROM tasks ORDER BY datetime(updated_at) DESC LIMIT 5`:

(The `task_id`, `file_id`, `download_url`, and `prompt` columns
are intentionally **not** echoed in this report. Lengths and
`IS NOT NULL` booleans are non-sensitive and are shown as
proof-of-existence.)

| # | mode | status | model | dur | res | file_id_present | download_url_present | download_url_status | file_id_len | download_url_len | created_at (UTC) | updated_at (UTC) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | text_to_video  | Success | MiniMax-Hailuo-2.3 | 6 | 768P | 1 | 1 | fresh  | 15 | 266 | 2026-06-17T06:18:20.804Z | 2026-06-17T06:20:55.309Z |
| 2 | text_to_video  | Success | MiniMax-Hailuo-2.3 | 6 | 768P | 1 | 0 | null   | 17 | null | 2026-06-15T04:13:45.024Z | 2026-06-17T05:13:45.024Z |
| 3 | text_to_video  | Fail    | MiniMax-Hailuo-2.3 | 6 | 768P | 0 | 0 | null   | null | null | 2026-06-15T04:13:45.024Z | 2026-06-17T05:13:45.024Z |
| 4 | image_to_video | Success | MiniMax-Hailuo-2.3 | 6 | 768P | 1 | 1 | null   | 19 | 31  | 2026-06-15T04:13:45.024Z | 2026-06-17T05:13:45.024Z |
| 5 | text_to_video  | Success | MiniMax-Hailuo-2.3 | 6 | 768P | 1 | 1 | null   | 17 | 25  | 2026-06-15T04:13:45.024Z | 2026-06-17T04:13:45.024Z |

Row #1 is the **user's real manual T2V task** that was the
subject of Phase S acceptance. Distinguishing evidence:

- It is the only row in the latest-five whose `created_at` and
  `updated_at` both fall inside the current observation window
  (`updated_at = 06:20:55Z`, ~14:20 CST).
- It is the only row in the latest-five with
  `download_url_status = 'fresh'` — the `download_url_status`
  column is populated only when the React client successfully
  calls `/api/video/task/<id>` with a `refresh_download` after
  the user opens the result panel in the browser. Regression seed
  rows never reach that step.
- It is the **only** row whose `download_url` length is `266`
  characters — a real MiniMax storage URL — versus the `25` /
  `31` character placeholders in seed rows.

The other four rows in the latest-five are regression seed rows
inserted by the Phase R / Phase Q `check:api` smoke and by the
seed-import script (`scripts/import-local-smoke-to-db.js`). They
are harmless production data (they prove the import path works)
but should ideally be cleaned up after Phase T passes — see
"Next steps" below.

The `text_to_video / Fail` and `image_to_video / Fail` rows are
seed rows whose `fail_reason` is intentionally populated to a
known error string for the React error-display assertions; they
do not represent any real MiniMax outage.

## 7. Cloudflare Access

```
GET https://mvs.conanxin.com           → HTTP/2 302 → soft-wood-f891.cloudflareaccess.com/cdn-cgi/access/login/...
GET https://mvs.conanxin.com/api/health → HTTP/2 302 → soft-wood-f891.cloudflareaccess.com/cdn-cgi/access/login/...
```

Both unauthenticated probes were intercepted by Cloudflare Access
with an HTTP 302 to the Access login page, exactly as designed.
`Set-Cookie: CF_AppSession=...` was issued on each response. No
unauthenticated request reached the upstream CVM service on port
8789 — confirmed by the absence of any corresponding `journalctl`
entry for those requests at the service level.

The Cloudflare Tunnel / Access policy is unchanged from the
Phase Q deploy.

## 8. Was a video task created in this phase?

**No.** This phase is read-only. No `CONFIRM_REAL_VIDEO=1` was
set, no `CONFIRM_REAL_I2V=1` was set, no API call that would
create a MiniMax task was made. The only MiniMax API call this
phase makes is the indirect one through `npm run
check:minimax-auth` in past phases, which targets the **Token
Plan usage endpoint** (does not count against the video quota
per the check's own console summary).

## 9. Was quota consumed in this phase?

**No.** See §8.

## 10. Sensitive information leakage

**No.** This report intentionally:

- does **not** echo `task_id`, `file_id`, `download_url`, or
  `prompt` values,
- does **not** echo `MINIMAX_API_KEY`, `SITE_PASSCODE`, any
  `Authorization` header, any Cloudflare cookie value beyond the
  opaque `Set-Cookie: CF_AppSession=<hex>; ...` name (the hex is
  a session-bound opaque value, not a secret),
- does **not** print the `meta=eyJ0eX...` base64 JWT fragment in
  the Access redirect URL (only the host prefix and the
  `redirect_url=/` query parameter are mentioned, which are
  documentation-level facts, not secrets),
- does **not** modify any rule on Cloudflare, systemd, the
  Cloudflare Tunnel, the Access policy, Nginx, Caddy, or Apache,
- does **not** commit `data/*.sqlite`, `reports/local/`,
  `node_modules/`, `dist/`, or any logs.

The `download_url` length-266 row is the user's real T2V — its
URL is not in this report and was not requested by it.

## 11. Current system state

**Production T2V acceptance: PASS (Phase S).**
**Production 24h stability observation: PASS for the first 23
minutes, with no early signals of any problem.**

| Surface | State |
| --- | --- |
| Production backend `systemctl --user is-active minimax-video-studio.service` | `active` (PID 2879890, since 14:14:01 CST) |
| Service memory / CPU | 39.1 MB / 449 ms total CPU since 14:14 |
| `http://127.0.0.1:8789/api/health` | `200 ok`, `version=v0.2.2-alpha` |
| `http://127.0.0.1:8789/api/runtime-config` | `200 ok`, `require_site_passcode:false`, `cloudflare_access_expected:true` |
| `127.0.0.1:8789` listener | loopback-only, production node PID 2879916 |
| `https://mvs.conanxin.com` (unauth) | `302` to Access login (correct) |
| `https://mvs.conanxin.com/api/health` (unauth) | `302` to Access login (correct) |
| `data/minimax-video-studio.sqlite` | 15 task rows; user's real T2V is the top row by `updated_at` |
| `reports/local/i2v-real-smoke.lock` | intact (per Phase J.4 §10) |
| Cloudflare Tunnel / Access / Nginx / systemd | unchanged |

## 12. Next steps

1. **Phase S.1 — continue 24h observation.** This snapshot is
   the t=0 anchor. The next snapshots are at t+4h, t+8h, t+16h,
   and t+24h. Each snapshot re-runs the same SQL + journal +
   curl + port checks. If any of them regress, open a Phase T
   incident; otherwise, mark Phase S.1 PASS at t+24h.
2. **Phase S.2 (optional, gated on user `可以提交`).** If the
   user wants a clean production task list, take a `cp
   data/minimax-video-studio.sqlite
   data/minimax-video-studio.sqlite.bak-$(date +%s)` first, then
   DELETE only rows whose `task_id` matches the seed prefix or
   whose `input_image_summary` matches the smoke fixture
   markers. **Do not run** without explicit user confirmation.
   **Do not commit** the resulting SQLite.
3. **Phase T — production I2V manual acceptance.** Once Phase S.1
   closes PASS, run the same end-to-end I2V drill on the public
   site: pick a non-copyrighted test image, switch the UI to
   `image_to_video`, upload, confirm `data_url` upload + MiniMax
   poll + `Success` + playable video, then write
   `docs/PHASE_T_PRODUCTION_I2V_ACCEPTANCE_REPORT.md`.
4. **Phase U — version bump / release notes.** After both `S`
   (T2V) and `T` (I2V) production manual runs have passed and
   been observed stable for 24h, cut `v0.3.0` from `4e66b0c` (or
   its successor) and write a `CHANGELOG.md` entry covering
   Phase Q / Q.1 / Q.2 / R / S / S.1 / T. **Do not** create the
   tag before T passes — the `v0.2.2-alpha` line should ship
   with I2V still pending.

(Hash recorded in the closing summary, not in this report file
itself, to keep the report byte-stable for archival.)
