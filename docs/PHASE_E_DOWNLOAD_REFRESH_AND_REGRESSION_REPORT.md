# Phase E - Download Link Refresh, Polling Guardrails, and API Regression Checks

> Public report for Phase E of `minimax-video-studio` (follow-up to
> Phase D). Phase E improves the user experience for completed
> `Success + file_id` tasks, hardens task-status polling against
> runaway behavior, and introduces an offline API regression
> harness. No real MiniMax video task is created or consumed by
> any of the changes described here.

---

## 1. What this phase did

- Added a dedicated backend endpoint
  `POST /api/video/file/:fileId/refresh` that re-queries the
  MiniMax `/v1/files/retrieve` API and refreshes the local
  `download_url` and `updated_at` for an existing local task.
- Introduced a shared polling guardrails file
  `shared/pollingConfig.json` and a backend
  `GET /api/polling/config` endpoint so the frontend, the smoke
  flow, and the future regression tests all agree on the same
  bounds.
- Replaced the frontend's hard-coded 10-second polling constant
  with a config-driven loop that uses exponential backoff with
  jitter, stops after `maxAttempts` or `maxDurationMinutes`, and
  surfaces a clear "polling stopped" message asking the user to
  refresh from history.
- Added a manual `Refresh task status` button in the task detail
  panel so users can poll a single task on demand without waiting
  for the background loop.
- Added a `Refresh download link` button (and a
  `Re-fetch download link` button when the URL is already known)
  to the task detail panel, both backed by the new
  `POST /api/video/file/:fileId/refresh` endpoint.
- Added a `Copy params to recreate` button on failed tasks that
  copies prompt, model, duration, resolution, and
  `prompt_optimizer` into the create form. The button never
  auto-submits and clearly warns the user that a re-submission
  will consume MiniMax quota.
- Added a new `scripts/check-api-regression.js` script and
  `npm run check:api` entry point. The script boots the backend,
  runs an offline regression suite, then shuts the server down.
- Updated `README.md`, `.gitignore`, and the project status
  section to reflect Phase E.

---

## 2. Why download-link refresh and regression checks first

- `download_url` is a signed URL and may expire after a short
  time. Without an in-app refresh path, users had no choice but
  to re-run the entire text-to-video task, which is wasteful and
  burns quota.
- Polling is the second most common runtime cost after the
  initial task creation. Hard-coded, unbounded polling is a
  classic regression risk, and Phase D shipped a 10-second
  fixed-interval loop. Hardening it now — when there is no real
  user load — is cheaper than retrofitting later.
- An offline API regression harness lets us verify the new
  endpoint, the new validation paths, and the polling-config
  contract without paying the cost of a real call.
- Image-to-video, first/last frame, subject reference, Docker,
  CI/CD, and dependency hygiene refactors are all explicitly
  **out of scope** for Phase E. They will get their own phases.

---

## 3. `download_url` refresh logic

The new endpoint:

```text
POST /api/video/file/:fileId/refresh
```

Behavior:

1. Requires `SITE_PASSCODE` (header, body, or query). Returns 401
   if it is missing or wrong.
2. Looks up the SQLite record by `file_id`. If no local task
   matches, returns 404 with a clear "open the task from history
   first" message.
3. Calls `retrieveVideoFile(fileId)` against
   `https://api.minimaxi.com/v1/files/retrieve` (configurable via
   `MINIMAX_API_BASE`).
4. On success:
   - Updates `file_id` to the value returned by MiniMax (falling
     back to the path parameter).
   - If a `download_url` is present, updates it on the local row.
   - Touches `updated_at` automatically via the standard
     `updateTask` helper.
5. Returns a JSON payload with `file_id`, `task_id`, `status`,
   `download_url`, `download_url_present` (boolean), and
   `refreshed_at`. The boolean allows the UI to render the right
   state without forcing logs to print the URL value.
6. On remote failure, returns the upstream HTTP status code with
   an `error` string. The local SQLite row is **not** modified on
   failure.
7. The script never creates a new video task. It only re-fetches
   a file URL for an already-known `file_id`.

---

## 4. Did this phase create any new video task?

**No.** All new code paths are read-only against the MiniMax
`/v1/files/retrieve` API and only update the local SQLite row.
`POST /api/video/create` was not changed in any way that would
cause it to be called by the new code.

---

## 5. Did this phase consume MiniMax video quota again?

**No.** The new endpoint is a free file-retrieval call. The
`/v1/files/retrieve` API is the same endpoint that the existing
`GET /api/video/file/:fileId` route already uses and does not
count against text-to-video generation quota.

---

## 6. Task polling limits and backoff

`shared/pollingConfig.json` defines the contract:

| Field                | Default | Meaning                                              |
|----------------------|---------|------------------------------------------------------|
| `initialIntervalMs`  | `10000` | First retry interval                                 |
| `maxIntervalMs`      | `30000` | Upper bound for backoff                              |
| `maxAttempts`        | `60`    | Polling stops after this many attempts               |
| `maxDurationMinutes` | `20`    | Polling stops after this many minutes                |
| `backoffFactor`      | `1.5`   | Multiplicative backoff between attempts              |
| `jitterMs`           | `1500`  | Random jitter to spread concurrent polls             |

Frontend behavior:

- Polling stops automatically when either `maxAttempts` or
  `maxDurationMinutes` is reached.
- On stop, the UI shows a clear message and asks the user to
  refresh the task from history later.
- The smoke script (`scripts/smoke-text-to-video.js`) keeps its
  existing `MAX_ATTEMPTS = 60` cap as a defense-in-depth measure;
  it has always been a hard upper bound.

---

## 7. Frontend task detail enhancements

- Task ID is shown in a shortened form (`8...6`) for readability.
- `file_id` is shown as `present (<short>)` or `absent`.
- `download_url` is shown as `present` or `absent`.
- `fail_reason` is shown as a red `error` line.
- `created_at` and `updated_at` are shown in a readable format.
- The polling state is shown as
  `Polling in progress (attempt N/60, max 20 min)` while active.
- When polling has stopped, the reason is shown in a
  `warning`-colored line.
- A `Refresh task status` button re-queries the current task on
  demand.
- A `Refresh download link` button (or `Re-fetch download link`
  if the URL is already known) calls the new
  `POST /api/video/file/:fileId/refresh` endpoint.
- A `Copy params to recreate` button appears on failed tasks.
  It does **not** auto-submit; it only copies the parameters and
  warns the user that re-submission will consume MiniMax quota.

---

## 8. `check:api` coverage

`npm run check:api` boots the backend and runs these offline
checks:

1. `GET /api/health` returns 200.
2. `GET /api/tasks` without passcode returns 401.
3. `GET /api/tasks` with passcode returns 200.
4. `POST /api/video/create` with an invalid model/duration/
   resolution combination returns 400 and **does not** reach
   MiniMax.
5. `POST /api/video/create` with an overlong prompt (3000 chars)
   returns 400 and **does not** reach MiniMax.
6. `GET /api/polling/config` returns the shared guardrails with
   finite numbers.
7. `POST /api/video/file/unknown-file-id/refresh` returns 404.
8. If a local `Success + file_id` task exists in SQLite, the
   refresh endpoint is exercised and the script asserts that the
   response body does **not** contain a real `download_url`
   fragment.

Hard guarantees enforced by the script:

- The script aborts immediately if `CONFIRM_REAL_VIDEO=1` is
  set.
- The script never reads, logs, or prints `MINIMAX_API_KEY`. It
  loads `dotenv` only so it can read `SITE_PASSCODE` and `PORT`.
- The script never calls `POST /api/video/create` with a valid
  payload. The two create-path checks are rejection paths only.
- The script shuts the backend down on exit (success or
  failure).
- The run output is appended to
  `reports/phase-e-api-regression.report.txt`, which is
  gitignored.

---

## 9. Local acceptance results

This report was authored on a fresh checkout of `main` plus the
Phase E diff. The acceptance steps run in the Phase E hand-off
were:

1. `npm install` — installs the same 316 packages as the Phase D
   hand-off. No new runtime dependencies were added.
2. `npm run build` — vite build completes (`built in < 1s`).
3. `npm run smoke:video` — `Final status: skipped`,
   `Real quota consumed: No`. This is a true dry-run.
4. `npm run check:api` — all eight regression checks PASS on
   the first run. The script reports
   `summary: 8/8 checks passed` and exits with code 0.

---

## 10. Did this phase use a real `file_id` to refresh a `download_url`?

**No.** During the Phase E hand-off, the local SQLite database
had no `Success + file_id` task. The `check:api` script
therefore skipped the optional refresh exercise and recorded
"no local Success+file_id task available; skipped (no remote
call made)".

If a real local task exists in a future run, the script will
exercise the endpoint with that task's `file_id` but will
**only** assert presence/absence — it will not print or
persist the actual `download_url` value.

---

## 11. Was a real `task_id` / `file_id` / `download_url` committed?

**No.** The only new tracked file that talks about
`task_id` / `file_id` / `download_url` is this report, and every
reference is a description of the field, an example schema, or
the SQL column name. No real values are present in this
document, in `README.md`, or in any other tracked file added by
this phase.

---

## 12. Any key / IP / domain / passcode leakage?

**No.** A scan of the Phase E diff against the same patterns
used in `scripts/check-open-source.js` returns zero hits:

- No real `MINIMAX_API_KEY`.
- No real `Bearer ...` token.
- No real internal IP. The only IP reference is the local
  loopback `127.0.0.1` used by `check:api` to talk to the
  locally-bootstrapped backend.
- No real private domain. The only domain reference is the
  public MiniMax base URL `https://api.minimaxi.com`, present
  only as a default in code and documentation.
- No real passcode. All `SITE_PASSCODE` references resolve to
  `change_me` or to the field name itself.

---

## 13. What the system can do after Phase E

- Submit a text-to-video task and poll its status with bounded
  backoff.
- Show clear `file_id` and `download_url` presence indicators.
- Manually refresh a single task's status from the UI.
- Manually refresh a `Success + file_id` task's `download_url`
  without creating a new video task.
- Copy parameters from a failed task into the create form, with
  an explicit warning that a manual re-submit will consume
  MiniMax quota.
- Run an offline API regression suite via `npm run check:api`
  that exercises the new endpoint, the polling config endpoint,
  the auth gate, the validation gate, and the `404 on unknown
  file_id` path.
- Continue to run the default dry-run smoke via
  `npm run smoke:video` without ever consuming quota.

---

## 14. What the system still cannot do

- It cannot generate image-to-video, first/last frame, or
  subject-reference videos. These are explicitly out of scope
  for Phase E.
- It cannot run inside Docker, a CI pipeline, or a Tencent Cloud
  deployment slot. Phase E is a local-dev phase.
- It cannot auto-regenerate a failed task. The `Copy params to
  recreate` button only copies parameters; the user must click
  `Submit` manually.
- It cannot refresh a `download_url` for a `file_id` that has
  no local SQLite record. The endpoint returns 404 in that case
  and tells the user to open the task from history first.
- It cannot poll beyond `maxAttempts` or `maxDurationMinutes`.
  When that happens, the user must refresh from history.

---

## 15. Next phase suggestions

- **Phase F — Polished task history UI.** Consider pagination,
  filtering, and grouping on the task history panel. The
  `npm run check:api` regression harness should be expanded to
  cover those UI-driven endpoints.
- **Phase G — Download link expiry detection.** Add a soft TTL
  on `download_url` (e.g. "this link is older than N hours, you
  may want to refresh") and surface it in the task detail
  panel. The refresh endpoint is already in place.
- **Phase H — Real error categorization.** Map MiniMax error
  codes into user-friendly categories (quota, rate limit,
  invalid combo, server error) so the UI can recommend the
  right next action.
- **Phase I — Optional Docker + Tencent Cloud deployment.** Keep
  this as a separate phase to avoid scope creep in Phase E.
- **Phase J — Dependency hygiene.** Address the inherited npm
  audit advisories in a controlled phase with a locked
  `package-lock.json`. Do not bundle this into Phase E.

---

## 16. Open-source boundary

Files added or modified by Phase E:

- `shared/pollingConfig.json` (new) — guardrails only.
- `server/index.js` — new endpoint, new polling config endpoint,
  startup log line.
- `server/services/minimaxClient.js` — exported `maskId` and
  `maskUrl` helpers for future modules; behavior is unchanged
  for existing callers.
- `web/src/App.jsx` — UI refactor for polling, refresh, and
  task detail enhancements.
- `web/src/styles.css` — added `.task-actions` layout class.
- `scripts/check-api-regression.js` (new) — offline regression
  script.
- `package.json` — added `npm run check:api`.
- `.gitignore` — added `reports/phase-*.report.txt`.
- `README.md` — refreshed status, features, scripts,
  polling-guardrails table, download-refresh section, re-submit
  safety note.
- `docs/PHASE_E_DOWNLOAD_REFRESH_AND_REGRESSION_REPORT.md`
  (this report).

Files explicitly **not** changed or added:

- `.env` — still not tracked, still placeholder.
- `data/*.db` / `data/*.sqlite` — still not tracked.
- `reports/local/` — still not tracked.
- `node_modules/`, `dist/`, `logs/` — still not tracked.
- `reports/phase-e-api-regression.report.txt` — runtime artifact,
  ignored by `.gitignore`.
