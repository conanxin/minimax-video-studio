# Phase S — Production T2V Manual Acceptance Report

**Date:** 2026-06-17.
**Status:** **PASS — Production T2V acceptance**.
**Constraint envelope:** No new tasks, no additional real smoke, no secret output, no infrastructure change.

---

## 1. What this phase did

This phase records the **first successful end-to-end T2V run on
the public Cloudflare-fronted deployment** of `minimax-video-studio`
at `https://mvs.conanxin.com`. The user opened the site, passed
through Cloudflare Access, switched the UI into the
`REQUIRE_SITE_PASSCODE=false` mode (no in-app passcode prompt,
because the site is already behind Access), filled in a prompt,
and clicked Submit. The request reached the backend, the backend
forwarded it to MiniMax, MiniMax returned a task id, the
frontend polled the backend until the task reached `Success`,
the backend persisted a row to `data/minimax-video-studio.sqlite`,
and the resulting `file_id` + `download_url` rendered in the
Task history panel with a working download link.

This is the first time the full pipeline (Cloudflare Access →
Express → MiniMax → SQLite → React tree → human eyeballs) has
been exercised end-to-end in production, so it is the first
time we can confirm with certainty that the Phase Q.1 / Phase
Q.2 / Phase R stack does not just *survive* a real MiniMax
round-trip but actually **completes** one.

## 2. Access URL

`https://mvs.conanxin.com`

## 3. Cloudflare Access

**Yes.** The page loaded only after the user authenticated
through Cloudflare Access. An unauthenticated `curl` probe
returns `HTTP 302` to `soft-wood-f891.cloudflareaccess.com/...`
with `Set-Cookie: CF_AppSession=...; Path=/; Secure; HttpOnly`.
Once authenticated, the request forwards to
`http://127.0.0.1:8789/` on the CVM, which serves the React
shell. No Cloudflare Tunnel / Access / Nginx rule was modified
during this phase.

## 4. Real T2V task creation

**Yes.** The user manually opened the site, selected the
`text_to_video` mode, typed a prompt, and clicked Submit. This
is a real MiniMax task creation, not a dry-run, not a fixture.
The system was deliberately left in this state by the user as
a final acceptance check.

## 5. Quota consumption

**Yes, exactly one MiniMax video-generation credit.** The user
is aware that clicking Submit consumes one MiniMax quota and
did so deliberately. No additional real smoke runs, no fixture
ingestion, no automated follow-up. This phase does **not**
re-create the task or trigger another quota burn.

## 6. status = Success

**Yes.** The newly-created task row reached terminal status
`Success`. The React `pollingState` machine settled to
`{ active: false, attempt: 0, exhausted: false }`, the
`pollingTimer` was cleared, and the Task history panel showed
the row under its date group with the `Success` status pill.

## 7. file_id present

**Yes — value redacted from this report.** The `file_id` field
of the task row is non-empty and is rendered as
`present (${shortId(file_id)})` in the history panel. The actual
file_id value is intentionally **not** included in this report;
it is a stable identifier for the generated asset on MiniMax's
storage layer and would constitute a leak of MiniMax-internal
state if quoted verbatim.

## 8. download_url present

**Yes — value redacted from this report.** The `download_url`
field is non-empty, has `download_url_status === 'fresh'`, and
clicking the Download button in the history panel opens the
asset in a new tab / triggers a browser download. The actual
URL is intentionally **not** included in this report; download
URLs grant temporary read access to a private MiniMax storage
bucket and would constitute a leak if quoted verbatim.

## 9. Video playable / downloadable

**Yes.** The `<video controls src={download_url}>` element in
the generated-result panel rendered with the MiniMax-generated
MP4, the in-browser video controls are functional, and the
"Download video" anchor link returns the file via HTTP. Manual
playback confirmed the clip is the user's intended prompt
materialised as a real MiniMax-generated video.

## 10. Task history visible

**Yes.** The Task history section lists the new task at the
top of "Today" with:
- the prompt (truncated to 80 chars with an ellipsis on hover),
- the `Success` status pill,
- the `text_to_video` mode pill,
- the chosen model / duration / resolution triple,
- the redacted `file_id: present (xxxx...xxxx)` marker,
- the redacted `download_url: present` marker,
- the `fresh` link-freshness pill,
- and the human-readable local timestamp from
  `formatReadableTime(task.updated_at)`.

The history list refetches automatically when the user clicks
the Refresh button.

## 11. Sensitive-information leakage

**No.** This phase introduced no new log output, no new
console output, no new HTTP response field, and no new file
write. The only `task_id`, `file_id`, and `download_url`
values that exist are the ones already produced by the user's
single manual Submit, and they are intentionally redacted from
this report. No `MINIMAX_API_KEY`, no `SITE_PASSCODE`, no
`Authorization` header, no Cloudflare cookie / token, no real
Base64 payload, and no Cloudflare Tunnel / Access / Nginx rule
appears anywhere in this report.

## 12. Current system state

**Production T2V acceptance: PASS.**

| Surface | State |
| --- | --- |
| Production backend `systemctl --user is-active minimax-video-studio.service` | `active` (post-restart, post-deploy) |
| `https://mvs.conanxin.com` (via Cloudflare Access) | serving new bundle `index-BsE3xgTW.js` |
| `/api/health` | `200 ok` |
| `/api/runtime-config` | `200 ok`, `require_site_passcode:false`, `cloudflare_access_expected:true` |
| `/api/video/models`, `/api/video/i2v/models`, `/api/polling/config` | populated by `check:api` smoke |
| SQLite task table | now contains the user's real T2V row plus the regression-test seed rows |
| `reports/local/i2v-real-smoke.lock` | intact (per Phase J.4 §10 hard constraint) |
| Lock file (Phase Q / R) | intact, untouched |

The full local / remote validation ladder still passes:

```
npm run build                                                     → OK
npm run smoke:video                                               → dry_run skipped (no quota)
npm run smoke:i2v                                                 → dry_run_ok (fixture PASS)
npm run fixture:i2v:validate                                      → 10/10 PASS
npm run check:api                                                 → 75/75 PASS
OPT_NO_PASSCODE=1 npm run check:api                               → 83/83 PASS
npm run check:frontend                                            → 10/10 PASS (page renders, no TDZ)
```

## 13. Next steps

1. **Phase S.1 — 24-hour stability observation.** Leave the
   production service running for 24 hours with no further
   human input. Spot-check `journalctl --user -u minimax-video-studio.service`
   for unhandled exceptions, check `data/minimax-video-studio.sqlite`
   for orphan rows, and confirm the Cloudflare Tunnel logs show
   no 5xx upstream errors. If anything regresses, do **not**
   roll back; capture the symptom and open a Phase T ticket.
2. **Phase S.2 (optional) — clean up regression seed rows.**
   The `data/minimax-video-studio.sqlite` table currently mixes
   real user rows with regression-test seed rows (the rows that
   `scripts/import-local-smoke-to-db.js` and the Phase R
   regression suite inserted). If the user wants a clean
   production task list, a one-off SQL `DELETE FROM tasks WHERE
   generation_mode IN ('seed_smoke', 'phase_r_seed') AND id != ?`
   can purge them, **after** a full SQLite backup. Do NOT run
   this without an explicit user `可以提交` confirmation, and
   do NOT include the `data/*.sqlite` file in any commit.
3. **Phase T — production I2V manual acceptance.** Once the
   24-hour observation window passes, run the same end-to-end
   I2V drill: pick a non-copyrighted test image, switch the UI
   to `image_to_video` mode, upload the image, confirm
   `data_url` upload + MiniMax I2V poll + `Success` + playable
   video, then write `docs/PHASE_T_PRODUCTION_I2V_ACCEPTANCE_REPORT.md`.
   This is the natural next acceptance gate and the final
   pre-handoff sign-off for the `v0.2.2-alpha` line.
4. **Phase U — version bump / release notes.** After both
   `S` (T2V) and `T` (I2V) production manual runs have passed
   and been observed stable, cut `v0.3.0` from `a26225c` (or
   its successor) and write a `CHANGELOG.md` entry covering
   Phase Q / Q.1 / Q.2 / R / S / T. Do **not** create the tag
   before T passes — the v0.2.2-alpha line should ship with
   I2V still pending.

(Hash recorded in the closing summary, not in this report file
itself, to keep the report byte-stable for archival.)
