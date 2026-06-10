# Phase D - Task History Alignment and Parameter Compatibility Matrix Report

## What was done in this phase
- Reworked backend task record flow to centralize text-to-video tasks through `taskStore`.
- Added a shared compatibility matrix config used by both backend validation and frontend dropdowns.
- Kept MiniMax request execution in backend only.
- Updated smoke script to write real/failed smoke task attempts into SQLite through the same store path.
- Added task detail panel, history-click detail, download state, and matrix-aware form logic in web.
- Added optional local smoke import script: `scripts/import-local-smoke-to-db.js`.

## Why task history alignment first
- The real smoke task was previously not consistently visible in task history.
- Stabilizing one storage path prevents split state between creation, query, and file-refresh flows.
- This is required before adding broader feature scope.

## Task storage flow changes
- `POST /api/video/create`: validate input -> call MiniMax -> `upsert` task row.
- `GET /api/video/task/:taskId`: sync remote status + file_id and update DB.
- `GET /api/video/file/:fileId`: fetch download URL and persist when missing.
- `GET /api/tasks`: paginated DB read ordered by updated time.
- `scripts/smoke-text-to-video.js`: records successful/failed run and periodic status updates to same DB.

## Smoke default behavior
- `npm run smoke:video` remains dry-run by default.
- Real call still requires `CONFIRM_REAL_VIDEO=1`.

## Quota usage
- During Phase D pass we did not execute new real MiniMax calls (`CONFIRM_REAL_VIDEO` remained unset).

## Parameter matrix support
- Added model-duration-resolution rules for:
  - `MiniMax-Hailuo-2.3`
  - `MiniMax-Hailuo-02`
  - `T2V-01-Director`
  - `T2V-01`
- Frontend auto-adjusts duration/resolution options and blocks unsupported combos.
- Prompt max length enforced at 2000 chars.

## Frontend interaction changes
- Combination compatibility hints and submit guard.
- Camera move quick insert buttons with per-move max usage guard.
- Prompt length counter.
- Task detail area with status, model/duration/resolution, file/download indicators, fail reason, and timestamps.
- Click-to-view history item detail.
- Refresh download link button when success has file_id but no download URL.

## Local acceptance
- `npm install`: success
- `npm run build`: success
- `npm run smoke:video` (without `CONFIRM_REAL_VIDEO=1`): success
- API checks:
  - `GET /api/health`: 200 and `ok:true`
  - `GET /api/tasks` without passcode: `401`
  - `GET /api/tasks` with passcode: success
  - invalid combo create (`T2V-01`, `10s`, `720P`): `400`
  - long prompt (>2000) create: `400`
- Frontend checks:
  - page load: `200`
  - history rendering with DB tasks: success

## import:local-smoke
- Script added and executed once.
- Result: local smoke task `407717672415745` imported into SQLite successfully.
- After import, `/api/tasks` with passcode includes imported task.

## Leak check
- `git ls-files` and local scan did not report tracked `.env`, DB files, logs, node_modules, or `reports/local` entries.
- Secret-bearing artifacts remain untracked and out of commit scope.

## What system can do now
- Create text-to-video tasks with compatibility validation.
- Maintain consistent lifecycle updates for task status and download metadata.
- Display history and details, and allow manual download-link refresh.

## What system cannot do
- No image-to-video.
- No first/last frame mode.
- No subject reference video.
- No Docker or CI/CD setup.
- No Tencent Cloud production DNS/HTTPS/ref-proxy hardening in this phase.

## Next phase suggestions
- Improve retry/backoff strategy for transient task status fetch failures.
- Add task history pagination controls and search/filter.
- Add download-link freshness warning with quick re-fetch UX.
- Proceed to new-model feature expansion only after stable end-to-end coverage.
