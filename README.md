# minimax-video-studio

MiniMax Token Plan text-to-video studio MVP (non-official).

This repository is an open-source starter for cloning and local development. It is not an official MiniMax product.

> You need your own MiniMax Token Plan API Key to run real generation.

Current status:
- `v0.2.1-alpha` is the **recommended deployment baseline**. Tag
  points to commit `beacc0d`.
- `v0.2.0-alpha` (tag points to commit `ada27c9`) is preserved
  as the "first I2V verified" release. Upgraders are encouraged
  to jump straight to `v0.2.1-alpha`; the v0.2.0 → v0.2.1 delta
  is regression fixes only and does not change any user-facing
  behaviour.
- T2V real smoke has been verified once.
- I2V real smoke has been verified once (Phase J.4, fixture-driven
  first frame, 10/10 offline fixture validation PASS).
- Phase A–I feature surface is intact: text-to-video + image-to-video
  task creation, task history, download-link refresh, polling
  guardrails, freshness indicators (`fresh` / `aging` / `stale` /
  `absent` / `unknown`), per-task error categorization, and
  `npm run check:api` offline regression.
- I2V fixture harness (Phase J.3) is the canonical path: a
  pngjs-generated 1024×768 RGBA PNG is offline-validated (10/10 PASS)
  before any real submit, and the smoke script refuses to submit if
  the fixture is invalid.
- Once-only local lock (`reports/local/i2v-real-smoke.lock`) remains
  armed. A second real I2V submit is refused unless the operator
  explicitly authorizes a new phase and removes the lock by hand.
  The lock is a **sticky safety artifact**: `npm run check:api`
  uses a dedicated test-only lock path
  (`reports/local/i2v-real-smoke.test.lock`) so it never touches
  the real lock. The dry-run sub-test snapshots the real lock
  before and after the smoke run and asserts byte-for-byte
  preservation (content + mode + size).
- Default smoke checks are non-consuming (dry run). `check:minimax-auth`
  performs a Token Plan usage lookup only — it does NOT call
  `/v1/video_generation` and consumes no video quota.
- **Real smoke consumes video quota.** Any future controlled real
  smoke (T2V or I2V) must be authorized explicitly per-phase; the
  default path is dry-run only.

## Features

- Text-to-video task creation through backend API
- Task status polling with shared guardrails (max attempts and max
  duration) — see `shared/pollingConfig.json`
- Manual `Refresh task status` button in the task detail panel
- Manual `Refresh download link` button for `Success + file_id` tasks
- Re-fetch download link when the original `download_url` is missing
  or expired (`POST /api/video/file/:fileId/refresh`)
- Soft download-link freshness hints: `fresh` / `aging` / `stale` /
  `absent` / `unknown`, computed from
  `shared/downloadLinkConfig.json` and exposed in every task
  response
- Per-task video error fallback: if the `<video>` element fails to
  load, the detail panel surfaces a hint pointing to
  `Re-fetch download link` instead of silently failing
- Per-task error categorization: every task response carries
  `error_category` / `error_severity` /
  `error_user_message` / `error_suggested_action` /
  `error_can_retry` / `error_retry_hint`, derived from
  `fail_reason`, `base_resp.status_code`, and HTTP status by
  `server/services/errorClassifier.js`
- Smoke `dry-run` writes only to console + gitignored
  `reports/local/smoke-dry-run.local.{md,json}`; the public
  `docs/PHASE_A_API_SMOKE_REPORT.md` is no longer touched by the
  smoke script
- Task history listing with status filter, keyword search, and
  paginated backend (`GET /api/tasks?limit=&offset=&status=&q=`)
- Time-grouped task history (Today / Yesterday / Earlier)
- Copy Prompt / Copy task params (JSON) / Fill form with these
  params buttons in the task detail panel
- Task compatibility validation before submit
- Video playback + download link when available
- Simple page passcode protection (`SITE_PASSCODE`)
- SQLite task storage
- Offline-friendly local setup
- `npm run check:api` for offline API regression checks (no real
  MiniMax call)

## Function scope

Current MVP scope (v0.2.0-alpha):

- ✅ Text-to-video (real smoke verified)
- ✅ Image-to-video (real smoke verified, fixture-driven first frame)
- ❌ First/last frame conditioning
- ❌ Subject reference video

Phase E explicitly does **not** introduce any of: image-to-video,
first/last frame, subject reference, Docker packaging, CI/CD, or
dependency hygiene refactors.

Phase F keeps the same scope discipline. It only polishes the local
task history UI (filtering, pagination, search, time grouping,
copy-params affordances) and the matching backend
`GET /api/tasks` endpoint. It does **not** introduce new
generation modes, Docker, CI, or dependency changes.

Phase G follows the same scope discipline. It only adds a soft
download-link freshness hint layer on top of the existing refresh
endpoint. It does **not** auto-refresh, does **not** introduce new
generation modes, Docker, CI, or dependency changes.

Phase H follows the same scope discipline. It only adds a pure
error-categorization layer on top of the existing `fail_reason`
field, plus a smoke-hygiene fix so the public
`docs/PHASE_A_API_SMOKE_REPORT.md` is no longer mutated by every
dry-run. It does **not** introduce new generation modes, Docker,
CI, or dependency changes.

## Project structure

- `server/` - Express backend, MiniMax adapter, SQLite DB
- `web/` - Vite + React frontend
- `scripts/` - smoke and local import scripts
- `docs/` - deployment and phase reports
- Root configs: `.env.example`, `.nvmrc`, `package.json`

## Local development (multi-machine flow)

```bash
cd path/to/minimax-video-studio
git clone <your-repo-url>
npm install
cp .env.example .env
```

Edit `.env`:

- `MINIMAX_API_KEY` = your MiniMax Token Plan key
- `SITE_PASSCODE` = your local passcode
- (optional) `MINIMAX_API_BASE` = `https://api.minimaxi.com` by default
- `CONFIRM_REAL_VIDEO` = `0` (default)

```bash
npm run dev
```

- Frontend: <http://127.0.0.1:8789>
- Health check: <http://127.0.0.1:8789/api/health>

### Multi-machine continuation

- Keep `.env` private on every machine.
- Run `npm install` to sync dependencies.
- Run `git pull` then copy `env` values, install, then launch.
- `data/` and SQLite files are created locally but ignored in repo.

## Scripts

- `npm run dev`
- `npm run dev:server`
- `npm run dev:web`
- `npm run build`
- `npm run start`
- `npm run smoke:video` — dry-run by default
- `npm run import:local-smoke`
- `npm run check:api` — offline API regression checks (no real
  MiniMax task created, never sets `CONFIRM_REAL_VIDEO=1`)
- `npm run check:open-source`
- `npm run check:minimax-auth` — auth-only Token Plan `remains`
  check; never submits a video task
- `npm run fixture:i2v:generate` — generate
  `test/fixtures/i2v-smoke-first-frame.png` via `pngjs`
- `npm run fixture:i2v:validate` — re-decode and assert
  dimensions / size / aspect / MIME; exits 0 on `10/10 PASS`

## Env vars

| Name | Description | Example |
| --- | --- | --- |
| `MINIMAX_API_KEY` | MiniMax API key for backend requests | (your Token Plan subscription key; bare value, no `Bearer ` prefix, no surrounding quotes) |
| `SITE_PASSCODE` | Simple page passcode | `change_me` |
| `PORT` | Service port (default 8789) | `8789` |
| `DATABASE_PATH` | SQLite path | `./data/minimax-video-studio.sqlite` |
| `MINIMAX_API_BASE` | MiniMax API base URL | `https://api.minimaxi.com` |
| `CONFIRM_REAL_VIDEO` | `0` for dry-run smoke, `1` to call real API | `0` |

## MiniMax Token Plan key

1. Open MiniMax Token Plan console
2. Get a valid Token Plan API key
3. Put the key in `.env` as `MINIMAX_API_KEY`
4. Never commit real keys or `.env`

## Smoke test

- `npm run smoke:video` runs smoke output and does **not** consume quota by default.
- Set `CONFIRM_REAL_VIDEO=1` for one controlled real run only.

```bash
# default dry-run (do not export CONFIRM_REAL_VIDEO, or leave it as 0)
npm run smoke:video

# controlled call (only when an operator explicitly approves a real run)
$env:CONFIRM_REAL_VIDEO = "1"
npm run smoke:video
```

## API regression check

- `npm run check:api` boots the backend on `PORT` (default `8789`) and
  runs an offline regression suite covering:
  - `GET /api/health` returns 200
  - `GET /api/tasks` without passcode returns 401
  - `GET /api/tasks` with passcode returns 200
  - `POST /api/video/create` with an invalid combination returns 400
    and never reaches MiniMax
  - `POST /api/video/create` with an overlong prompt returns 400 and
    never reaches MiniMax
  - `GET /api/polling/config` returns the shared guardrails
  - `POST /api/video/file/unknown/refresh` returns 404
  - If a local `Success + file_id` task exists, the refresh endpoint
    is exercised and the script asserts no real `download_url` is
    printed in the response body
  - `GET /api/tasks?limit=5&offset=0` returns 200 with a pagination
    block (`limit`, `offset`, `total`, `hasMore`)
  - `GET /api/tasks?status=Success` returns 200
  - `GET /api/tasks?status=InvalidStatus` returns 400
  - `GET /api/tasks?q=<text>` returns 200; the keyword uses
    parameterized SQL, so injection attempts return 200 with an
    empty / partial result set instead of leaking data
  - `GET /api/tasks?limit=999` returns 200 with `pagination.limit`
    clamped to `<= 100`
  - `GET /api/download-link/config` returns the shared
    `warningTtlHours` / `softTtlHours` and the five freshness
    statuses
  - `GET /api/tasks` returns `download_url_status` /
    `download_url_age_hours` / `should_refresh_download_url` /
    `download_url_present` on every row
  - `Success + file_id + no download_url` is reported as
    `absent` with `should_refresh_download_url: true`
  - `Success + file_id + 2h-old download_url` is reported as
    `fresh` with `should_refresh_download_url: false`
  - `Success + file_id + 15h-old download_url` is reported as
    `aging` with `should_refresh_download_url: true`
  - `GET /api/tasks?status=Success + 30h-old download_url` is
    reported as `stale` with `should_refresh_download_url: true`
  - `errorClassifier({ fail_reason: 'out of quota' })` returns
    `error_category: 'quota'`
  - `errorClassifier({ status: 429 })` returns
    `error_category: 'rate_limit'`
  - `errorClassifier({ fail_reason: 'unsupported model' })`
    returns `error_category: 'invalid_params'`
  - `errorClassifier({ status: 401 })` returns
    `error_category: 'auth'`
  - `errorClassifier({ status: 503 })` returns
    `error_category: 'server_error'`
  - `errorClassifier({ fail_reason: 'fetch failed' })` returns
    `error_category: 'network'`
  - `errorClassifier({ fail_reason: 'polling reached max
    attempts' })` returns `error_category: 'timeout'`
  - `GET /api/tasks` returns `error_category: 'quota'` for the
    seeded quota-fail row
  - `GET /api/tasks` returns the matching
    `invalid_params` / `auth` / `network` categories for the
    three other seeded fail rows
  - `npm run smoke:video` (dry-run) leaves
    `docs/PHASE_A_API_SMOKE_REPORT.md` content + mtime
    unchanged, and its console output never echoes a real key
    fragment
- The script aborts immediately if `CONFIRM_REAL_VIDEO=1` is set.
- The script never reads, logs, or prints `MINIMAX_API_KEY`.
- The script never prints a real `download_url`; it only asserts
  presence/absence.
- The Phase G / Phase H run writes local SQLite seed rows
  (`local-seed-g-*` / `local-seed-h-*` prefix) before booting
  the server. These rows are obviously fake and live in the
  same gitignored `data/*.sqlite` file.
- The run output is appended to
  `reports/phase-h-api-regression.report.txt` (gitignored).

```bash
npm run check:api
```

## Task history filtering, pagination, and search

`GET /api/tasks` now accepts the following query parameters (all
require `passcode`):

| Param   | Type    | Default        | Notes |
|---------|---------|----------------|-------|
| `limit` | integer | `20`           | Clamped to a maximum of `100` server-side |
| `offset`| integer | `0`            | Non-negative integer |
| `status`| string  | (unset)        | One of `Preparing`, `Queueing`, `Processing`, `Success`, `Fail`; anything else returns `400` |
| `q`     | string  | (unset)        | Searches `prompt`, `model`, and `task_id` with parameterized `LIKE` |
| `sort`  | string  | `updated_desc` | One of `updated_desc`, `created_desc`; anything else returns `400` |

Response shape:

```json
{
  "tasks": [ { "id": 1, "task_id": "...", "status": "Success", ... } ],
  "pagination": { "limit": 20, "offset": 0, "total": 42, "hasMore": true },
  "filters": { "status": "Success", "q": "windmill", "sort": "updated_desc" }
}
```

The frontend groups the current page into **Today**, **Yesterday**,
and **Earlier** sections using the task's `updated_at` timestamp,
shows a status pill plus a single-line `model / duration / resolution
/ file_id / download_url` summary per card, and renders clear empty
states for both "no tasks yet" and "no tasks match the current
filter" cases.

The `q` value is bound through `?` parameters in `sqlite3`, so it is
safe against SQL injection.

## Task detail copy / fill-form affordances

The task detail panel now exposes four buttons in addition to the
existing refresh actions:

- **Copy Prompt** — copies the raw `prompt` string to the clipboard.
- **Copy task params** — copies a JSON object containing `prompt`,
  `model`, `duration`, `resolution`, and `prompt_optimizer` to the
  clipboard.
- **Fill form with these params** — populates the create form
  (model, duration, resolution, `prompt_optimizer`, and prompt)
  with the task's parameters. The user must review and click
  **Submit** manually. A new submission will consume MiniMax quota.
- **Copy params to recreate** (failed tasks only) — same effect as
  the previous Phase E button, kept for clarity on failed tasks.

For failed tasks the panel shows an additional red-bordered warning
reminding the user that a fresh submission will consume MiniMax
quota. The buttons never auto-submit.

## Download link freshness

Phase G adds a soft advisory TTL layer on top of the existing
`POST /api/video/file/:fileId/refresh` endpoint. The TTL values
are defined in `shared/downloadLinkConfig.json`:

| Field             | Default | Meaning                                              |
|-------------------|---------|------------------------------------------------------|
| `warningTtlHours` | `12`    | URL younger than this is `fresh`                     |
| `softTtlHours`    | `24`    | URL between `warningTtlHours` and `softTtlHours` is `aging`; older is `stale` |

For every `Success` task that has a `file_id`, the backend returns:

| Field                          | Type     | Notes |
|--------------------------------|----------|-------|
| `download_url_present`         | `bool`   | `true` iff a `download_url` is stored locally |
| `download_url_status`          | `string` | `fresh` / `aging` / `stale` / `absent` / `unknown` |
| `download_url_age_hours`       | `number` | hours since the last successful refresh, or `null` if unknown |
| `should_refresh_download_url`  | `bool`   | `true` for `absent` / `aging` / `stale` / unknown-age rows |
| `download_url_refreshed_at`    | `string` | ISO 8601 of the last successful refresh; `null` if never |

State machine:

| Task shape | `download_url_status` | `should_refresh_download_url` |
|------------|----------------------|------------------------------|
| `Success + file_id` and no stored URL | `absent` | `true` |
| `Success + file_id`, URL age `< warningTtlHours` | `fresh` | `false` |
| `Success + file_id`, URL age in `[warningTtlHours, softTtlHours)` | `aging` | `true` |
| `Success + file_id`, URL age `>= softTtlHours` | `stale` | `true` |
| `Success` without `file_id` | `unknown` | `false` |
| any non-`Success` status | `unknown` | `false` |

Hard rules:

- The backend **never** auto-refreshes the `download_url`. Every
  refresh happens only when the user clicks `Re-fetch download
  link` (or `Refresh download link` for absent URLs).
- The age is computed from `download_url_refreshed_at` when
  present, falling back to `updated_at` for legacy rows that were
  created before Phase G.
- The TTL bounds are advisory. The actual MiniMax `download_url`
  may or may not be expired at these boundaries — the user is
  expected to click refresh if a video fails to play.
- Re-fetching a download link does **not** create a new video
  task. It only calls `POST /v1/files/retrieve`.
- Re-submitting a task (filling the form with the task's
  parameters and clicking Submit) **does** create a new video
  task and consumes MiniMax quota.

The frontend renders:

- A status pill (`fresh` / `aging` / `stale` / `absent` / `unknown`)
  on the task detail panel and on each history card.
- An age label such as `2 小时前刷新` in the detail panel.
- A red-bordered warning in the detail panel when
  `should_refresh_download_url` is `true`, pointing the user at
  the existing `Re-fetch download link` / `Refresh download link`
  button.
- A red-bordered `如果视频无法播放，请尝试"重新获取下载链接"`
  hint whenever the `<video>` element fires an error event.

The `q` value used by the new check:api freshness regression
tests is bound through `?` parameters in `sqlite3`, so the same
SQL-injection-safety guarantee from Phase F applies.

## Error categorization

Phase H adds a pure error-classification layer that turns each
`Fail` task's `fail_reason`, `base_resp.status_code`, and HTTP
status into a stable category plus a user-friendly message and a
suggested next action. The classifier lives in
`server/services/errorClassifier.js` and is exposed via
`classifyVideoError(input)` / `classifyFromTask(task)`.

Eight categories are returned:

| `error_category` | Trigger (example) | `can_retry` | `severity` |
|-------------------|-------------------|-------------|------------|
| `quota` | `out of quota`, `insufficient balance`, `token plan`, 额度 / 余额 | `false` (must top up) | `error` |
| `rate_limit` | `rate limit`, `too many requests`, HTTP 429, 限流 | `true` | `warning` |
| `invalid_params` | `invalid`, `unsupported model`, `prompt too long`, 参数 / 不支持 | `true` | `warning` |
| `auth` | HTTP 401/403, `unauthorized`, `forbidden`, `invalid api key` | `false` (must fix key) | `error` |
| `server_error` | HTTP 5xx, `internal error`, `service unavailable` | `true` | `warning` |
| `network` | `ECONNRESET`, `ETIMEDOUT`, `fetch failed`, 网络 | `true` | `warning` |
| `timeout` | `polling reached max attempts`, `timed out`, 超时 | `true` (no auto-regenerate) | `info` |
| `unknown` | anything else | `false` | `warning` |

Every task response now carries these fields in addition to
`fail_reason`:

| Field | Type | Notes |
|-------|------|-------|
| `error_category` | `string` | one of the eight categories above |
| `error_severity` | `string` | `info` / `warning` / `error` |
| `error_user_message` | `string` | stable Chinese template explaining the failure |
| `error_suggested_action` | `string` | what the user should do next |
| `error_can_retry` | `bool` | whether a manual retry is reasonable |
| `error_retry_hint` | `string` | extra hint about quota / auto-submit caveats |

The frontend renders the category in a dedicated "错误类型"
block in the task detail panel, with the user message, the
suggested action, and a `适合 / 不建议` retry label. For
`invalid_params` the block specifically nudges the user toward
the "用此参数填回表单" button. For `quota` / `auth` it
emphasizes fixing the upstream root cause before any new
submission. For `rate_limit` / `server_error` / `network` /
`timeout` it explicitly says the system will **not**
auto-regenerate the task.

The classifier is a pure function with no I/O and no new
dependencies. It is exercised by seven unit-style checks in
`npm run check:api` plus four seed-driven `GET /api/tasks`
checks for the `quota` / `invalid_params` / `auth` / `network`
rows.

## Smoke hygiene

Phase H also fixes a Phase A / F / G hygiene gap:

- `npm run smoke:video` in default (non-`CONFIRM_REAL_VIDEO=1`)
  mode used to overwrite `docs/PHASE_A_API_SMOKE_REPORT.md` on
  every run, which meant the public report drifted even though
  the smoke had nothing real to report.
- Phase H splits the smoke report into two layers:
  - `reports/local/smoke-dry-run.local.md` and
    `reports/local/smoke-dry-run.local.json` — machine-local
    breadcrumbs that are gitignored under `reports/local/` and
    are regenerated on every dry-run. The console also prints
    a 5-line summary so a developer can see the result without
    opening any file.
  - `docs/PHASE_A_API_SMOKE_REPORT.md` is **not** touched by
    `smoke:video` in any mode. It is a historical artifact and
    is updated only by a dedicated phase.
- Real smoke (`CONFIRM_REAL_VIDEO=1`) still writes the local
  `phase-c1-real-smoke.local.{md,json}` pair. The public
  `docs/PHASE_C1_REAL_SMOKE_REPORT.md` is only updated when
  `PHASE_C1=1` is also set.
- `npm run check:api` now has a regression check (#29) that
  records the content + mtime of
  `docs/PHASE_A_API_SMOKE_REPORT.md`, runs
  `npm run smoke:video` (dry-run), and asserts both are
  unchanged. It also asserts the dry-run output never echoes a
  real key fragment.

## Polling guardrails

Polling is bounded by `shared/pollingConfig.json`:

| Field                | Default | Meaning                                              |
|----------------------|---------|------------------------------------------------------|
| `initialIntervalMs`  | `10000` | First retry interval                                 |
| `maxIntervalMs`      | `30000` | Upper bound for backoff                              |
| `maxAttempts`        | `60`    | Polling stops after this many attempts               |
| `maxDurationMinutes` | `20`    | Polling stops after this many minutes                |
| `backoffFactor`      | `1.5`   | Multiplicative backoff between attempts              |
| `jitterMs`           | `1500`  | Random jitter to spread concurrent polls             |

The frontend fetches these via `GET /api/polling/config`, applies
exponential backoff with jitter, and stops polling automatically
once either `maxAttempts` or `maxDurationMinutes` is reached. When
stopped, the UI shows a clear message and the user is expected to
refresh the task from history later.

## Download link refresh

For `Success + file_id` tasks whose original `download_url` has
expired or is missing, the backend exposes:

```text
POST /api/video/file/:fileId/refresh
```

- Requires `SITE_PASSCODE` (header, body, or query).
- Looks up the local SQLite record by `file_id`. If no local task
  matches, returns 404.
- Calls MiniMax `/v1/files/retrieve` and updates the local
  `download_url` and `updated_at` on success.
- Response body reports `download_url_present: true|false` so the
  frontend can render the right state without leaking the URL value
  to logs.
- Never creates a new video task.

The frontend renders three states in the task detail panel:

- `Success` + `file_id` + no `download_url` → "Refresh download link"
  button.
- `Success` + `file_id` + `download_url` → video player, "Download
  video" link, and a "Re-fetch download link" button.
- Loading and error states are explicit.

## Re-submission safety note

The "Copy params to recreate" button on failed tasks only copies
prompt, model, duration, resolution, and prompt_optimizer into the
create form. It does **not** auto-submit. The user must review and
click **Submit** manually, and a new submission will consume MiniMax
quota.

## Text-to-video parameter compatibility matrix

### Model defaults

- Model: `MiniMax-Hailuo-2.3`
- Duration: `6`
- Resolution: `768P`
- `prompt_optimizer`: `true`

### Supported combinations

- `MiniMax-Hailuo-2.3`
  - `6s`: `768P`, `1080P`
  - `10s`: `768P`
- `MiniMax-Hailuo-02`
  - `6s`: `768P`, `1080P`
  - `10s`: `768P`
- `T2V-01-Director`
  - `6s`: `720P`
- `T2V-01`
  - `6s`: `720P`

### Validation rules

- Illegal model/duration/resolution combos return HTTP 400.
- Invalid prompt length (`> 2000`) returns HTTP 400.
- `POST /api/video/create` returns recommendation text on reject.
- Frontend blocks unsupported combinations before submit.

## Image-to-Video Foundation (Phase I Recovery)

Phase I lays the **code + contract** groundwork for image-to-video. It does
**not** run a real I2V task against MiniMax in this release.

### `generation_mode`

`POST /api/video/create` now accepts a `generation_mode` field:

| Value | Meaning |
| --- | --- |
| `text_to_video` (default) | text → video, same as before |
| `image_to_video` | image (first frame) → video, requires `first_frame_image` |

If `image_to_video` is sent without `first_frame_image`, the server
returns HTTP 400 *before* any remote call.

### First-frame image inputs

Two input shapes are accepted:

1. **Public HTTPS URL** — e.g. `https://cdn.example.com/first-frame.jpg`.
   The server parses the URL, rejects `http://`, `localhost`, RFC1918
   private ranges, `0.0.0.0`, and `file://` URLs.
2. **Data URL** — `data:image/jpeg|png|webp;base64,...`. Built in the
   browser by `FileReader.readAsDataURL` from a local upload, or pasted
   manually. The server only accepts `image/jpeg`, `image/png`,
   `image/webp` and rejects everything else.

The **bytes** of `first_frame_image` are forwarded to MiniMax as part of
the I2V request and are **never persisted**:

- `data:image/...;base64,...` is **never** written to SQLite, JSON
  reports, README, or any committed file.
- Server stores only a *summary*: `input_image_present`,
  `input_image_type` (`public_url` / `data_url`), `input_image_host`,
  `input_image_mime`, `input_image_approx_bytes`,
  `input_image_sha256_short` (first 8 hex chars of SHA-256 of the raw
  value), `input_image_summary`.
- Frontend never restores the image when filling a task back into the
  form — it tells the user to re-pick / re-paste the first frame.

### Image constraints

| Constraint | Limit |
| --- | --- |
| Allowed MIME types | `image/jpeg`, `image/png`, `image/webp` |
| Max size | 20 MB (≈ 20,971,520 bytes) |
| Min short side | 300 px |
| Aspect ratio | long / short ∈ [0.4, 2.5] (≈ 2:5 to 5:2) |

These are enforced in two places:

- `server/services/validation.js` → `validateImageInput`,
  `validateImageToVideoInput`.
- `web/src/App.jsx` → `inspectImageFile` (runs before submit; greys out
  Submit until the image passes all four rules).

### I2V parameter matrix

The I2V model list is sourced from `shared/videoModelsI2V.json`
(wrapped under `i2vModelConfig`) and exposed at
`GET /api/video/i2v/models`. Current contents:

- `MiniMax-Hailuo-2.3`
  - `6s`: `768P`, `1080P`
  - `10s`: `768P`
- `MiniMax-Hailuo-2.3-Fast`
  - `6s`: `768P`, `1080P`
  - `10s`: `768P`
- `MiniMax-Hailuo-02`
  - `6s`: `512P`, `768P`, `1080P`
  - `10s`: `512P`, `768P`
- `I2V-01-Director`
  - `6s`: `720P`
- `I2V-01-live`
  - `6s`: `720P`
- `I2V-01`
  - `6s`: `720P`

Defaults: model `MiniMax-Hailuo-2.3`, duration `6`, resolution `768P`,
`prompt_optimizer: true`. The frontend always pulls the live matrix from
`/api/video/i2v/models`; the in-source `FALLBACK_I2V_CONFIG` is only used
if the API call fails.

### Image-related error categories

`server/services/errorClassifier.js` now recognizes image-specific
failure modes returned by MiniMax / the validator:

| `error_category` | Meaning |
| --- | --- |
| `image_unavailable` | MiniMax cannot fetch the image URL |
| `image_too_large` | image exceeds the size cap |
| `unsupported_image_format` | image is not JPG/JPEG/PNG/WebP |
| `invalid_image_dimensions` | short side < 300 px or aspect ratio out of range |

These surface as the existing `error_category` /
`error_user_message` / `error_suggested_action` fields in task
responses and in the detail panel.

### What was *not* done in Phase I Recovery

- **No real I2V smoke was executed.** `npm run smoke:i2v` is a dry-run
  only. To run one real I2V job you must explicitly opt in by setting
  `CONFIRM_REAL_VIDEO=1` *and* `CONFIRM_REAL_I2V=1` in the same shell
  — and even then, the project deliberately refuses to consume quota
  unless the user authorizes Phase J.
- **A real I2V smoke test would consume MiniMax quota.** Treat any
  real call as production traffic.
- **No image bytes are committed.** No task_id, file_id, download_url,
  image URL, or base64 image content from a real MiniMax run is
  present anywhere in `server/`, `web/`, `scripts/`, `shared/`, `docs/`
  or `README.md`.

### Phase J (next, gated)

Phase J would run **one** controlled real I2V smoke job end-to-end.
It is intentionally not part of this release and will only run after
explicit user authorization.

Phase J is currently in the **containment** state: the first attempt
returned `base_resp.status_code: 1004` from MiniMax, which was traced
back to a literal placeholder in `.env::MINIMAX_API_KEY` (Phase J.1
diagnosis). Once the operator replaced `.env::MINIMAX_API_KEY` with a
real Token Plan subscription key, a follow-up Phase J attempt created
two real I2V submits instead of the one authorized. Both submits were
accepted by MiniMax, both failed at the local post-submit stage for
the same reason (the previous hand-written PNG encoder produced a
PNG that MiniMax's service-side decoder rejected with `invalid
format / too much pixel data`), and the second submit was an
execution-discipline violation during debugging. The Phase J.2
incident report documents this without reproducing the real `task_id`s
in any committed file. Phase J.3 (this release) replaces the broken
PNG encoder with a deterministic pngjs-generated fixture and adds
the corresponding offline pre-flight validation.

## I2V smoke harness (Phase J.3)

Phase J.3 replaces the previous hand-written PNG encoder in
`scripts/smoke-image-to-video.js` with a deterministic PNG fixture
that is produced by `scripts/generate-i2v-fixture.js` and validated by
`scripts/validate-i2v-fixture.js`. The hand-written encoder was the
root cause of the Phase J.2 incident (MiniMax service-side rejected
the produced PNG with `invalid format / too much pixel data`). It
has been removed from the I2V code path.

### How it works

1. **Fixture generator** — `npm run fixture:i2v:generate` writes a
   deterministic 1024×768 RGBA PNG (abstract gradient, no people, no
   text, no logos, no copyrighted content) to
   `test/fixtures/i2v-smoke-first-frame.png`. The output is ~370 KB
   and uses `pngjs` (now a devDependency) to produce a
   decoder-valid PNG.
2. **Fixture validator** — `npm run fixture:i2v:validate` re-decodes
   the fixture and asserts: PNG magic bytes, `pngjs` decode succeeds,
   width == 1024, height == 768, RGBA pixel buffer length ==
   `width × height × 4`, file size ≤ 20 MB, short side ≥ 300 px,
   aspect ratio ∈ [0.40, 2.50], and extension/MIME agree on
   `image/png`. Exits 0 only on `10/10 PASS`.
3. **Dry-run** (`npm run smoke:i2v`) — runs the fixture validator,
   loads the fixture, and reports `fixture_exists` /
   `fixture_validation` / `data_url_present` / `data_url_chars` /
   `fixture_sha256_short` to console and to
   `reports/local/i2v-smoke-dry-run.local.{md,json}` (gitignored).
   The dry-run **never** logs the raw Data URL bytes.
4. **Real mode** (`CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1 npm run
   smoke:i2v`) — runs the same fixture pre-flight, then refuses to
   submit if any of the following are true:
   - fixture validation failed (`refused_by_fixture`);
   - the once-only lock at `reports/local/i2v-real-smoke.lock` is
     present (`refused_by_lock`).
   The fixture, the lock, and the dry-run reports all live under
   `reports/local/`, which is gitignored.

### Once-only local lock (Phase J.2)

Real I2V smoke is a one-shot operation per checkout. After a real
submit (or after a real submit attempt that failed) the harness
writes `reports/local/i2v-real-smoke.lock` with a masked task_id and
the run timestamps. Any subsequent real-mode run exits immediately
with `refused_by_lock` and a clear message pointing at the lock file.

To re-authorize a real submit, **the operator must explicitly delete
the lock file** — there is no CLI flag or env var that bypasses it.
This is the mechanical guard against a recurrence of the Phase J.2
execution-discipline incident.

### Hard guarantees

- `npm run smoke:i2v` in dry-run mode never creates a real I2V
  task and never touches the lock file.
- The fixture is an abstract gradient. It contains no people, no
  text, no logos, and no copyrighted material.
- The Data URL is built from the fixture bytes at request time and
  is **never** echoed to logs, reports, or commit messages.
- The harness never prints the real `MINIMAX_API_KEY`, the real
  `Authorization` header, the real `task_id`, the real `file_id`,
  the real `download_url`, or any base64 image content.

### What is *not* in scope for Phase J.3

- Phase J.3 does not run a real I2V smoke. It is a purely offline
  harness fix.
- Phase J.3 does not introduce subject-reference, first/last-frame,
  Docker, CI/CD, or dependency-hygiene refactors. It only swaps
  the I2V image source from a hand-written encoder to a deterministic
  pngjs-generated fixture and adds the corresponding pre-flight
  checks.

## Task status

- Preparing: `Preparing`
- Queueing: `Queueing`
- Processing: `Processing`
- Success: `Success`
- Fail: `Fail`

Frontend displays Chinese descriptions for the same statuses.

## Local smoke import

If a real smoke result exists in `reports/local/phase-c1-real-smoke.local.json`, import it into SQLite:

```bash
npm run import:local-smoke
```

This script keeps local records only and does not commit local JSON artifacts.

## Tencent Cloud deployment guide (generic)

See [docs/DEPLOY_TENCENT_CLOUD.md](docs/DEPLOY_TENCENT_CLOUD.md) for:

- clone/install/build/start workflow
- `.env` placement
- `systemd` sample with placeholder paths

## GitHub open-source publishing

Recommended process:

1. Ensure repository initialized and committed
2. Ensure `.env`, database files, logs, and node_modules are not tracked
3. Push to public GitHub repository
4. Keep `.env.example` only, not real secrets

## Open-source boundary

- Can publish:
  - Source code
  - README and docs
  - scripts and non-sensitive config templates
- Must not publish:
  - `.env`
  - real API keys
  - real database files
  - logs
  - any local path or IP/domain details from your environment

## Roadmap

- Add image-to-video
- Add first-frame / last-frame mode
- Add subject reference
- Prompt template library
- Local gallery enhancements
- Tencent Cloud domain + HTTPS + reverse proxy in next phase
- Optional Docker packaging

## Current limits

- This is a local MVP for personal usage and multi-machine continuation.
- It is intentionally minimal and safe by default.
- `download_url` may still expire; use the in-app
  `Refresh download link` / `Re-fetch download link` buttons instead
  of opening a brand-new video task. The backend
  `POST /api/video/file/:fileId/refresh` re-queries MiniMax for the
  current `download_url` without consuming additional generation
  quota.

## Deployment

This repo is an open-source starter. It is designed to be cloned and run
on a single Tencent Cloud CVM (or any Linux box) for personal use; it is
**not** intended to be exposed to the public internet without a reverse
proxy + HTTPS termination, which is out of scope for v0.2.0-alpha.

For the operator-facing, copy-pasteable Tencent Cloud CVM runbook — including
`git clone`, `.env` creation, `npm install`, `npm run build`, `npm run start`,
a placeholder systemd unit, and a health-check curl — see:

- [`docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md`](docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md)

The release notes for v0.2.0-alpha live at:

- [`docs/RELEASE_NOTES_v0.2.0-alpha.md`](docs/RELEASE_NOTES_v0.2.0-alpha.md)

The Phase K readiness report (offline, no real MiniMax submit) is at:

- [`docs/PHASE_K_RELEASE_AND_DEPLOYMENT_READINESS_REPORT.md`](docs/PHASE_K_RELEASE_AND_DEPLOYMENT_READINESS_REPORT.md)

## Releases

This project keeps both `v0.2.0-alpha` and `v0.2.1-alpha` as
publishable tags. Pick one explicitly:

- `v0.2.1-alpha` — **recommended deployment baseline** (post-release
  regression fix; `check:api` 72/72 PASS; sticky I2V lock contract
  preserved across runs).
  Release notes:
  [`docs/RELEASE_NOTES_v0.2.1-alpha.md`](docs/RELEASE_NOTES_v0.2.1-alpha.md).
- `v0.2.0-alpha` — first I2V-verified release. Preserved for
  reproducibility of the Phase J.4 single-submit record.
  Release notes:
  [`docs/RELEASE_NOTES_v0.2.0-alpha.md`](docs/RELEASE_NOTES_v0.2.0-alpha.md).
