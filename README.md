# minimax-video-studio

MiniMax Token Plan text-to-video studio MVP (non-official).

This repository is an open-source starter for cloning and local development. It is not an official MiniMax product.

> You need your own MiniMax Token Plan API Key to run real generation.

Current status:
- `v0.1.0-alpha` has been published.
- Phase C.1 real smoke test is verified once.
- Phase D task history and parameter matrix are merged.
- Phase E download link refresh, polling guardrails, and API regression
  checks are merged.
- Phase F task history UI, filtering, pagination, search, time
  grouping, and copy-params affordances are merged.
- Phase G download link freshness indicators and link-freshness UX
  are merged.
- Default smoke checks are non-consuming (dry run).

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

Current MVP scope remains text-to-video only:

- ✅ Text-to-video
- ❌ Image-to-video
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

## Env vars

| Name | Description | Example |
| --- | --- | --- |
| `MINIMAX_API_KEY` | MiniMax API key for backend requests | `replace_with_your_minimax_token_plan_key` |
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
  - `Success + file_id + 30h-old download_url` is reported as
    `stale` with `should_refresh_download_url: true`
- The script aborts immediately if `CONFIRM_REAL_VIDEO=1` is set.
- The script never reads, logs, or prints `MINIMAX_API_KEY`.
- The script never prints a real `download_url`; it only asserts
  presence/absence.
- The Phase G run writes local SQLite seed rows (`local-seed-g-*`
  prefix) before booting the server. These rows are obviously fake
  and live in the same gitignored `data/*.sqlite` file.
- The run output is appended to
  `reports/phase-g-api-regression.report.txt` (gitignored).

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
