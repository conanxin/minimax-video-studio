# Phase G - Download Link Expiry Detection and Link Freshness UX

> Public report for Phase G of `minimax-video-studio` (follow-up to
> Phase F). Phase G adds a **soft advisory** download-link freshness
> layer on top of the existing
> `POST /api/video/file/:fileId/refresh` endpoint. It does **not**
> create any new MiniMax video task, does **not** auto-refresh any
> `download_url`, and does **not** consume any additional MiniMax
> quota. The state machine is computed locally from
> `download_url_refreshed_at` (or `updated_at` for legacy rows) and
> `shared/downloadLinkConfig.json`.

---

## 1. What this phase did

- Added a new shared config file
  `shared/downloadLinkConfig.json` with two advisory TTLs:
  `warningTtlHours: 12` and `softTtlHours: 24`. The config is
  consumed by the backend only; the frontend reads the same
  values from the new `GET /api/download-link/config` endpoint.
- Extended the SQLite schema (additive, non-breaking) with two
  new columns on the `tasks` table:
  - `download_url_refreshed_at` (TEXT, nullable).
  - `download_url_status` (TEXT, default `'unknown'`).
  Both are added via a guarded `ALTER TABLE ... ADD COLUMN` that
  runs against legacy databases on first open. The migration is
  idempotent and never destroys data.
- Added a new server module
  `server/services/downloadLinkFreshness.js` with a pure
  `classify(task)` function that maps any task into
  `{ download_url_present, download_url_status, download_url_age_hours, should_refresh_download_url }`.
  The function takes `now` as an optional parameter so the
  regression tests can be deterministic.
- Extended `server/index.js` so:
  - `toSafeTaskPayload(task)` now also returns the four
    freshness fields plus `download_url_refreshed_at`.
  - `POST /api/video/file/:fileId/refresh` updates
    `download_url_refreshed_at = <now>` and
    `download_url_status = 'fresh'` whenever a real URL is
    stored. The same two columns are now also written by
    `GET /api/video/file/:fileId` and `GET /api/video/task/:taskId`
    whenever they pull a fresh `download_url` from MiniMax.
  - New endpoint `GET /api/download-link/config` returns the
    shared TTLs, the five status strings, and a clear
    "soft advisory only" note.
- Extended the React UI (`web/src/App.jsx` +
  `web/src/styles.css`) so:
  - Each history card now shows a colored
    `fresh / aging / stale / absent / unknown` freshness pill
    next to the existing model / duration / file_id / download_url
    summary, when the task is `Success` and has a `file_id`.
  - The task detail panel shows a dedicated "下载链接状态" block
    with the same status pill, a Chinese description
    (`下载链接可用` / `链接较久，建议刷新` / `链接可能已过期` /
    `未获取下载链接` / `暂无链接状态`), an age label such as
    `2 小时前刷新`, and a red-bordered warning that points the
    user at the existing `Re-fetch download link` button when
    `should_refresh_download_url` is `true`.
  - The `<video>` element now listens for `error` events. If the
    player fails to load, the detail panel surfaces
    `如果视频无法播放，请尝试"重新获取下载链接"——可能当前
    download_url 已过期` immediately below the player.
  - The frontend hero text was updated to "Phase G: download
    link freshness indicators and link-freshness UX."
- Extended `scripts/check-api-regression.js` with six new offline
  checks and a `seedFreshnessFixtures()` helper that writes five
  obviously-fake `local-seed-g-*` rows into the local SQLite DB
  before the server boots. The script never calls MiniMax, never
  prints a real `download_url`, never reads `MINIMAX_API_KEY`,
  and exits with code `2` if `CONFIRM_REAL_VIDEO=1` is set.
- Updated `README.md` to document the new TTL config, the new
  `download_url_status` / `download_url_age_hours` /
  `should_refresh_download_url` / `download_url_present` fields
  on every task response, the state machine, the explicit
  "never auto-refresh" rule, and the expanded `check:api`
  coverage.

---

## 2. Why download-link freshness next, and not image-to-video

- Image-to-video, first/last frame, and subject reference are
  meaningful new product surfaces. Each one deserves a focused
  phase with its own design, failure modes, and quota budget.
- The previous phases already shipped the only safe mechanism
  to recover from a stale `download_url`:
  `POST /api/video/file/:fileId/refresh`. What was missing was
  *visibility* — the user had no way to know whether the URL
  in the local DB was probably stale without opening every task
  and remembering MiniMax's link-expiry policy.
- Phase G is mostly a small, pure-function state machine
  (`classify`) plus a thin UI polish. It does not require any
  new MiniMax quota budget, does not change the create path,
  and does not require any new dependency. That is the right
  risk shape for a "polish" phase.
- The freshness contract is intentionally **advisory**, not
  hard-enforced. The user remains in control: only their click
  on `Re-fetch download link` ever causes a new
  `/v1/files/retrieve` call.

---

## 3. `download_url` soft TTL design

`shared/downloadLinkConfig.json` is the single source of truth:

```json
{
  "warningTtlHours": 12,
  "softTtlHours": 24
}
```

The backend's `classify(task)` reads this file at module load
time and exposes `getWarningTtlHours()` / `getSoftTtlHours()`
helpers. The values are also returned by
`GET /api/download-link/config` so the frontend does not need
to maintain its own copy.

State machine (per-task):

| Task shape | `download_url_status` | `should_refresh_download_url` |
|------------|----------------------|------------------------------|
| `Success + file_id`, no stored `download_url` | `absent` | `true` |
| `Success + file_id`, age `< warningTtlHours` | `fresh` | `false` |
| `Success + file_id`, age in `[warningTtlHours, softTtlHours)` | `aging` | `true` |
| `Success + file_id`, age `>= softTtlHours` | `stale` | `true` |
| `Success` without `file_id` | `unknown` | `false` |
| any non-`Success` status | `unknown` | `false` |

`age` is computed from `download_url_refreshed_at` when
present, falling back to `updated_at` for legacy rows that were
created before Phase G. The fallback only matters for rows that
already had a stored `download_url` before this phase shipped;
the local seed in `check:api` always writes a real
`download_url_refreshed_at`.

The contract is **advisory**: the user is always expected to
click `Re-fetch download link` themselves; the backend never
auto-refreshes. If the `<video>` element fails to load, the
detail panel surfaces a hint pointing the user at the refresh
button — but the actual call only happens on click.

---

## 4. Backend task response changes

Every task returned by the backend (list endpoint, single-task
endpoint, and the refresh endpoint) now includes the following
fields in addition to the Phase F fields:

| Field                          | Type     | Notes |
|--------------------------------|----------|-------|
| `download_url_present`         | `bool`   | `true` iff a `download_url` is stored locally |
| `download_url_status`          | `string` | one of `fresh` / `aging` / `stale` / `absent` / `unknown` |
| `download_url_age_hours`       | `number` | hours since the last successful refresh; `null` if unknown |
| `should_refresh_download_url`  | `bool`   | `true` for `absent` / `aging` / `stale` / unknown-age rows |
| `download_url_refreshed_at`    | `string` | ISO 8601 timestamp of the last successful refresh; `null` if never |

The `POST /api/video/file/:fileId/refresh` response shape is
backward-compatible: it keeps the Phase E
`download_url_present` boolean and `refreshed_at` timestamp, and
adds the four new fields above.

`GET /api/download-link/config` returns:

```json
{
  "warningTtlHours": 12,
  "softTtlHours": 24,
  "statuses": {
    "fresh": "fresh",
    "aging": "aging",
    "stale": "stale",
    "absent": "absent",
    "unknown": "unknown"
  },
  "source": "shared/downloadLinkConfig.json",
  "note": "Soft advisory only. The URL is not guaranteed to expire at these boundaries. The user must always click Refresh download link to fetch a new URL from MiniMax."
}
```

Database migration:

- `download_url_refreshed_at` is added as nullable TEXT.
- `download_url_status` is added with default `'unknown'`.
- Legacy rows keep their previous values; their freshness state
  is computed from `updated_at` and the current
  `Success + file_id + download_url` triple.
- The migration runs in `initDb()` and is guarded by
  `PRAGMA table_info(tasks)`, so it is safe to re-run.

---

## 5. Frontend task card and detail changes

- History card: when the task is `Success` and has a `file_id`,
  the existing `model / duration / resolution / file_id /
  download_url` summary line now also includes a colored
  `link: <status>` pill. The pill uses the same
  `fresh / aging / stale / absent / unknown` vocabulary as the
  detail panel.
- Task detail: a dedicated `下载链接状态` block is rendered
  between the existing `Fail reason` line and the action row.
  The block contains:
  - The status pill, with a Chinese description next to it.
  - An age label such as `2 小时前刷新`, or `30 天前刷新`. The
    label is suffixed with `。这不是 MiniMax 强制过期时间，仅为
    软提示。` to make the advisory nature explicit.
  - A red-bordered warning that points the user at the existing
    `Re-fetch download link` (or `Refresh download link` for
    `absent` URLs) button when
    `should_refresh_download_url` is `true`.
- Video player: the `<video>` element now has
  `onError={() => setVideoError(true)}` and
  `onLoadedData={() => setVideoError(false)}`. When the player
  errors out, the detail panel shows
  `如果视频无法播放，请尝试"重新获取下载链接"——可能当前
  download_url 已过期`. The state is reset every time the user
  opens a new task or refreshes a download link.
- No automatic refresh: the frontend never calls
  `POST /api/video/file/:fileId/refresh` without an explicit
  user click. The freshness block is descriptive, not
  prescriptive.

---

## 6. `check:api` new coverage

`npm run check:api` now runs 19 checks total (13 from
Phase E/F + 6 from Phase G):

1. `GET /api/download-link/config` returns 200 with finite
   `warningTtlHours < softTtlHours` and the five status
   strings.
2. `GET /api/tasks` returns the four freshness fields on
   every row and asserts that `download_url_status` is always
   one of the five allowed values.
3. `GET /api/tasks?q=local-seed-g-success-no-url` returns
   the seeded no-URL row with
   `download_url_present: false`,
   `download_url_status: 'absent'`, and
   `should_refresh_download_url: true`.
4. `GET /api/tasks?q=local-seed-g-success-fresh` returns the
   2-hour-old row with
   `download_url_present: true`,
   `download_url_status: 'fresh'`,
   `should_refresh_download_url: false`, and
   `download_url_age_hours < 24`.
5. `GET /api/tasks?q=local-seed-g-success-aging` returns the
   15-hour-old row with
   `download_url_status: 'aging'`,
   `should_refresh_download_url: true`, and
   `download_url_age_hours` in `[12, 24)`.
6. `GET /api/tasks?q=local-seed-g-success-stale` returns the
   30-hour-old row with
   `download_url_status: 'stale'`,
   `should_refresh_download_url: true`, and
   `download_url_age_hours >= 24`.

Additional safeguards:

- `seedFreshnessFixtures()` writes five obviously-fake rows
  (`local-seed-g-success-fresh`, `...-aging`, `...-stale`,
  `...-no-url`, `...-fail`) into the local SQLite DB before
  the server boots. The script's `download_url` placeholders
  are short `local-placeholder://...` strings that never
  appear in the public report; the script only asserts
  `present/absent` and the age / status values.
- The script aborts immediately if `CONFIRM_REAL_VIDEO=1` is
  set in the environment (exit code `2`).
- The script never reads, logs, or prints `MINIMAX_API_KEY`.
- The script never calls `POST /api/video/create` with a valid
  payload. The two create-path checks remain rejection paths
  only.
- The script shuts the backend down on exit (success or
  failure).
- Run output is appended to
  `reports/phase-g-api-regression.report.txt`, which is
  gitignored.

---

## 7. Did this phase create a new video task?

**No.** The new code paths are all read-only against the local
SQLite database. `POST /api/video/create` was not changed in
any way that would cause it to be called by the new code. The
`seedFreshnessFixtures()` helper writes only obviously-fake
`local-seed-g-*` rows and lives in the same gitignored SQLite
file as the rest of the local state.

---

## 8. Did this phase consume MiniMax video quota again?

**No.** The freshness state machine is a pure function of local
state and a config file. The new
`POST /api/video/file/:fileId/refresh` behavior only triggers
when the user explicitly clicks the existing refresh button,
and that endpoint is the same endpoint that Phase E
introduced — it only calls `POST /v1/files/retrieve` and does
not consume generation quota.

---

## 9. Did this phase use a real `file_id` to refresh a `download_url`?

**No.** The regression suite's
`POST /api/video/file/<known>/refresh` check from Phase E
remains a soft pass — it still records "no remote call made"
unless a real local `Success + file_id` row exists. Phase G does
not introduce any new remote call. The seeded rows use
fake `file-seed-g-*` ids that the test suite never passes to
the refresh endpoint.

---

## 10. Were any real `task_id` / `file_id` / `download_url` committed?

**No.** The only tracked files that talk about `task_id` /
`file_id` / `download_url` are this report, `README.md`, and
the in-tree source code. Every reference is a description of
the field, an example schema, a CSS class name, or the SQL
column name. The local seed uses obviously-fake values
(`local-seed-g-*` task ids, `file-seed-g-*` file ids,
`local-placeholder://...` download url placeholders) and the
seeded SQLite rows live in a gitignored file.

---

## 11. Was any key / IP / domain / passcode leaked?

**No.** A scan of the Phase G diff against the same patterns
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

## 12. What the system can do after Phase G

- Submit a text-to-video task and poll its status with bounded
  backoff.
- Show clear `file_id` and `download_url` presence indicators.
- Manually refresh a single task's status from the UI.
- Manually refresh a `Success + file_id` task's `download_url`
  without creating a new video task.
- Show a soft `fresh / aging / stale / absent / unknown`
  freshness pill on every task that has a `file_id`, both in
  the history list and in the task detail panel.
- Show an age label such as `2 小时前刷新` in the task detail
  panel.
- Surface a red-bordered warning in the task detail panel
  whenever the freshness status recommends a refresh, and
  point the user at the existing refresh button.
- Surface a `如果视频无法播放` hint whenever the `<video>`
  element fails to load, instead of failing silently.
- Browse the local task history with status filtering, keyword
  search, paginated results, and Today / Yesterday / Earlier
  grouping.
- Copy a task's `prompt` or its `prompt + model + duration +
  resolution + prompt_optimizer` JSON to the clipboard.
- Refill the create form with a selected task's parameters
  (without auto-submitting).
- Run an offline API regression suite via `npm run check:api`
  with 19 checks covering the Phase E / F / G contracts.

---

## 13. What the system still cannot do

- It cannot generate image-to-video, first/last frame, or
  subject-reference videos. These are explicitly out of scope
  for Phase G.
- It cannot run inside Docker, a CI pipeline, or a Tencent
  Cloud deployment slot. Phase G is a local-dev phase.
- It cannot auto-refresh a `download_url`. Every refresh
  requires a user click. The freshness pill is descriptive,
  not prescriptive.
- It cannot detect a `download_url` expiry at the moment it
  happens. The TTLs are advisory and computed from the last
  successful refresh timestamp. If the user refreshes a URL
  and then leaves the page open for 30 hours without
  re-opening the task, the pill will only update on the next
  fetch.
- It cannot refresh a `download_url` for a `file_id` that has
  no local SQLite record. The endpoint returns `404` in that
  case and tells the user to open the task from history
  first.
- It cannot poll beyond `maxAttempts` or
  `maxDurationMinutes`. When that happens, the user must
  refresh from history.

---

## 14. Next phase suggestions

- **Phase H — Real error categorization.** Map MiniMax error
  codes into user-friendly categories (quota, rate limit,
  invalid combo, server error) so the UI can recommend the
  right next action. The `fail_reason` field already exists on
  every failed task.
- **Phase I — Image-to-video.** A new generation surface that
  deserves its own design + failure-mode phase. The Phase F
  history affordances and the Phase G freshness pill will
  carry over for free.
- **Phase J — Optional Docker + Tencent Cloud deployment.**
  Keep this as a separate phase to avoid scope creep in
  Phase G.
- **Phase K — Dependency hygiene.** Address the inherited npm
  audit advisories in a controlled phase with a locked
  `package-lock.json`. Do not bundle this into Phase G.
- **Phase L — Configurable TTLs.** Promote
  `shared/downloadLinkConfig.json` to a per-user setting in
  `.env` so power users can tune the warning/soft boundaries
  to their MiniMax plan's actual link-expiry behaviour.

---

## 15. Open-source boundary

Files added or modified by Phase G:

- `shared/downloadLinkConfig.json` (new) — TTL config,
  advisory only.
- `server/db.js` — additive migration
  (`download_url_refreshed_at`, `download_url_status`); module
  export extended with `toIsoNow`.
- `server/services/downloadLinkFreshness.js` (new) — pure
  freshness state machine + `describeStatus` /
  `formatAgeLabel` helpers.
- `server/services/taskStore.js` — unchanged for Phase G
  (verified).
- `server/index.js` — `toSafeTaskPayload` includes the four
  freshness fields; refresh endpoint writes
  `download_url_refreshed_at` and `download_url_status`; new
  `GET /api/download-link/config` endpoint.
- `web/src/App.jsx` — new
  `DOWNLOAD_URL_STATUS_TEXT` /
  `DOWNLOAD_URL_STATUS_PILL_TEXT` maps, new
  `formatAgeLabel` helper, new `videoError` state, freshness
  pill on the history card, dedicated
  "下载链接状态" block in the task detail, video `onError`
  hint, hero subtitle updated to Phase G.
- `web/src/styles.css` — new `.freshness-block`,
  `.freshness-zh`, `.freshness-pill`, and the five
  `.freshness-<status>` color variants.
- `scripts/check-api-regression.js` — six new Phase G checks;
  new `seedFreshnessFixtures()` helper that writes fake
  `local-seed-g-*` rows into the local SQLite DB; report file
  renamed to
  `reports/phase-g-api-regression.report.txt`.
- `README.md` — new "Download link freshness" section with
  TTL table, state machine, hard rules, and frontend behavior;
  expanded `check:api` section; status block updated.
- `docs/PHASE_G_DOWNLOAD_LINK_EXPIRY_REPORT.md` (this report).

Files explicitly **not** changed or added:

- `.env` — still not tracked, still placeholder.
- `data/*.db` / `data/*.sqlite` — still not tracked.
- `reports/local/` — still not tracked.
- `node_modules/`, `dist/`, `logs/` — still not tracked.
- `reports/phase-g-api-regression.report.txt` — runtime
  artifact, ignored by `.gitignore`.
- `package.json` / `package-lock.json` — unchanged. Phase G
  adds no new npm runtime or dev dependencies.
- `shared/pollingConfig.json` — unchanged. Phase G does not
  touch polling.
- `server/services/minimaxClient.js` — unchanged. The client
  library is the same as in Phase E; only its callers were
  extended.
