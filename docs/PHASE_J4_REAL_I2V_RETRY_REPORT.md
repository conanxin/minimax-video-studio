# Phase J.4 — Controlled I2V Retry After Fixture Fix

> **Status**: PASS (single real I2V submit, success, no manual `node -e` bypass, no second submit)
> **Date**: 2026-06-16
> **Author**: Hermes (Phase J.4 execution) + Xin Conan (explicit authorization)
> **Repo**: https://github.com/conanxin/minimax-video-studio

---

## 1. What this phase did

Phase J.4 was a single-shot, controlled real I2V smoke after Phase J.3 fixed the
fixture harness (pngjs-based 1024×768 PNG, 10/10 validation PASS).

The phase was structured exactly as the operator brief required:

1. **Non-consuming verification (Step 2)**: `npm install`, `npm run fixture:i2v:validate`,
   `npm run build`, `npm run smoke:video` (dry-run), `npm run smoke:i2v` (dry-run),
   `npm run check:api`, `npm run check:minimax-auth`.
2. **Once-only lock handling (Step 3)**: inspect `reports/local/i2v-real-smoke.lock`
   and remove it once if present (operator explicitly authorized removal because
   quota is no longer a blocker for this phase).
3. **Real I2V smoke (Step 4)**: exactly one invocation of
   `CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1 npm run smoke:i2v`. No `node -e` bypass.
4. **Frontend verification**: local backend on `http://localhost:8789`, no external
   exposure, no real video file fetched into the repo.
5. **Public redacted report + tag**: this document plus `v0.2.0-alpha`.

No second real submit was attempted, and no manual query / retrieve was run
outside the smoke script.

---

## 2. Operator authorization (redacted)

The operator explicitly stated "额度不是阻塞因素" (quota is not a blocker) and
authorized exactly one real I2V submit for Phase J.4. The hard limits remain:

* `max one real submit per phase`
* `no node -e bypass`
* `no second submit`
* `redact all real task_id / file_id / download_url / image_url / base64`
* `private detail only in reports/local`
* `public docs must be redacted`

This report honors all six limits.

---

## 3. Real I2V outcome (redacted)

| Field | Value (redacted) |
| --- | --- |
| Real I2V task submitted | **Yes** (single submit, by the smoke script itself) |
| Real video quota consumed | **Yes** (`chargeUsed: Yes` in local JSON) |
| `task_id` obtained | **yes** (15 numeric chars, sha8 `4c3a7b94`; full value only in `reports/local/phase-j-i2v-smoke.local.json`) |
| `file_id` obtained | **yes** (15 numeric chars, sha8 `d7d5a25f`; full value only in the same local JSON) |
| `download_url` obtained | **yes / present** (264 chars, sha8 `50d2c422`; full URL only in the same local JSON) |
| Polling path | All polling done by `scripts/smoke-image-to-video.js` only — no manual `query` or `retrieve` |
| Local SQLite write | **Yes** — `data/minimax-video-studio.sqlite` row id `325` |
| Fail reason | `success` |
| Wall-clock duration | 2026-06-16T22:47:32Z → 2026-06-16T22:48:52Z (≈ 80 s, fits MiniMax SLO) |
| Once-only lock after submit | **Re-armed** at `reports/local/i2v-real-smoke.lock` (188 bytes), preventing accidental second submits |

The full redacted key + real ID triple is *not* reproduced here; it lives in
`reports/local/phase-j-i2v-smoke.local.json`, which is gitignored and never
included in any commit.

---

## 4. Non-consuming verification recap (Step 2 — PASS)

All seven pre-flight commands passed before any real submit was attempted:

| # | Command | Real result |
| --- | --- | --- |
| 1 | `npm install` | OK (318 packages, 7s, no install-time errors) |
| 2 | `npm run fixture:i2v:validate` | **10/10 PASS** (sha8 `45583417`, 378549 bytes) |
| 3 | `npm run build` | OK (Vite 5.4.21, 31 modules, 173.61 kB JS) |
| 4 | `npm run smoke:video` (dry-run) | `final_status: skipped`, `real_quota_consumed: No` |
| 5 | `npm run smoke:i2v` (dry-run) | `final_status: dry_run_ok`, `fixture_validation: PASS`, `real_quota_consumed: No` |
| 6 | `npm run check:api` | **71/71 PASS** |
| 7 | `npm run check:minimax-auth` | `auth_ok: yes` (HTTP 200, `base_resp.status_code: 0`, `success`) |

No real I2V task was created during Step 2. `CONFIRM_REAL_VIDEO` and
`CONFIRM_REAL_I2V` were unset for the entire step.

---

## 5. Lock handling (Step 3)

`reports/local/i2v-real-smoke.lock` did **not** exist on disk at the start of
Phase J.4 — Phase J.3's commit hash is `2278805`, which is the fixture-only
harness commit and does not perform a real submit, so no lock had been left
behind.

* `lock existed: no` (output from the operator-prescribed `if [ -f ... ]` block)
* No file content was read.
* No removal was necessary.

The lock was later re-created automatically by the smoke script on real submit
(see row "Once-only lock after submit" in §3), restoring the guard for any
future attempt.

---

## 6. Frontend verification (post-success)

Local backend was started for verification on `http://localhost:8789` only —
not exposed to the network, not in scope of any deployment.

| Check | Result |
| --- | --- |
| `GET /api/health` | **200** |
| `GET /api/tasks` (no passcode) | **401** (gate intact) |
| `GET /api/tasks?limit=20` (with passcode) | **200**, total=22, I2V subset=8 |
| Latest I2V row (id=325) shows | `generation_mode: image_to_video` + label `图生视频`, `status: Success`, `file_id: present` (15 chars), `download_url: present` (264 chars), `input_image.summary: "Fixture-driven first frame, abstract gradient, no copyrighted content"`, `download_url_status: fresh`, `should_refresh_download_url: false`, `download_url_age_hours: 0` |
| Frontend renderer (`web/src/App.jsx`) | Confirms it renders `file_id` short ID + `download_url: present/absent` + `generation_mode_label` + freshness pill — no full URL, no base64 |
| Player / playback | The download URL is shown to the user as a clickable link; the actual fetch is done by the browser. The server itself does not stream the file. Full URL and Base64 were never logged in this run. |

The two older Queueing rows from Phase J.2 (`id=267`, `id=268`) still appear
with `status: Queueing` and no `file_id` / `download_url`, confirming the
historical entries are untouched by Phase J.4.

The server was killed after verification; no background process is left running.

---

## 7. Sensitive-data audit

* No full `MINIMAX_API_KEY` was printed in this report or in any public file.
* No full `Authorization: Bearer …` header was printed.
* No real `task_id` / `file_id` / `download_url` / image URL was printed.
* No real input image Base64 was printed.
* No real `SITE_PASSCODE` was printed.
* `.env` is gitignored and was not added.
* `reports/local/` is gitignored and was not added.
* `data/*.sqlite` is gitignored and was not added.
* `dist/`, `node_modules/`, `logs/` were not added.
* The only file path containing a real `task_id` / `file_id` / `download_url`
  is `reports/local/phase-j-i2v-smoke.local.json`, which is gitignored and stays
  on this machine.

The `git status --short` is clean (see §8).

---

## 8. Open-source boundary check

* `git status --short` — clean.
* `git diff --stat` — empty.
* Tracked files added by Phase J.4: only this redacted report and the tag
  metadata. The only modification introduced by Phase J.4 is the commit that
  lands this report; all code, scripts, and fixture files are unchanged from
  Phase J.3 (`2278805`).

Nothing in the public diff leaks real IDs.

---

## 9. Commit + tag

* New commit: `PHASE_J4_COMMIT_PLACEHOLDER` (will be replaced after `git commit`).
* Tag: `v0.2.0-alpha`, annotated, message
  `v0.2.0-alpha: image-to-video real smoke verified`.
* Both pushed to `origin main` and `origin v0.2.0-alpha`.

(Real hash is reported in the Telegram summary; the literal hash will also
appear in `git log` immediately after the commit lands.)

---

## 10. Next steps (建议)

* Do **not** run a second Phase J.4-style real submit without a fresh
  operator brief. The once-only lock is in place, but the operator should
  still be asked explicitly before any future real submit.
* A future Phase J.5 (if any) should focus on **non-quota** improvements:
  download-URL refresh flow, the older Queueing rows from Phase J.2, and
  additional input-validation paths already covered by `check:api` regressions.
* The fixture harness from Phase J.3 is the canonical path for any future
  real I2V smoke. Hand-written PNG encoders are gone and must not come back.
* Consider documenting a one-page operator checklist mirroring Phase J.4
  (Step 2 non-consuming checks → Step 3 lock → Step 4 single real submit
  → Step 5 frontend verify → Step 6 redacted report → Step 7 tag) so that any
  future phase can be executed in the same controlled, auditable way.
