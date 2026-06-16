# Phase F - Task History UI, Filtering, Pagination, and Local Usability Polish

> Public report for Phase F of `minimax-video-studio` (follow-up to
> Phase E). Phase F turns the local `GET /api/tasks` endpoint and the
> frontend "Task history" panel into a small but real "video
> generation workbench" — paginated, filterable, searchable,
> time-grouped, with copy / fill-form affordances on the task
> detail. It does **not** create any new MiniMax video task and
> does **not** consume any additional MiniMax quota.

---

## 1. What this phase did

- Extended the SQLite query layer in `server/db.js` to support
  `status` filtering, `LIKE`-based keyword search across
  `prompt` / `model` / `task_id`, configurable `sort`, and a
  separate `countTasks` helper for total count.
- Replaced the Phase E flat-array `GET /api/tasks` endpoint with
  a paginated, filterable, searchable contract that returns
  `{ tasks, pagination, filters }`. `limit` is clamped to a
  maximum of `100` server-side; `status` and `sort` are
  validated against a small allow-list; `q` is bound through
  parameterized SQL.
- Rewrote the frontend "Task history" section to look like a
  generation workbench:
  - Toolbar with status chips (`全部` / `成功` / `失败` /
    `生成中`) and a `搜索 prompt / model / task_id` input with
    submit and clear actions.
  - Per-card summary with a prompt excerpt, a status pill, and
    a single-line `model / duration / resolution / file_id /
    download_url` summary, plus a `updated_at` line.
  - Time grouping into `Today` / `Yesterday` / `Earlier` based
    on the task's `updated_at`.
  - Empty states for both "no tasks yet" and "no tasks match the
    current filter".
  - "上一页 / 下一页" pagination that uses the backend's
    `pagination.hasMore` flag and keeps the current filter
    across page changes.
- Added three new buttons to the task detail panel:
  - **Copy Prompt** — copies the raw `prompt` to the clipboard.
  - **Copy task params** — copies a JSON object containing
    `prompt`, `model`, `duration`, `resolution`, and
    `prompt_optimizer` to the clipboard.
  - **Fill form with these params** — populates the create form
    with the task's parameters without auto-submitting.
  - The existing failed-task **Copy params to recreate** button
    is kept, and a red-bordered "重新提交会消耗 MiniMax 视频额度"
    warning is now shown beneath the action row.
- Extended `scripts/check-api-regression.js` with five new
  checks: `limit=5&offset=0` returns 200 with a pagination
  block, `status=Success` returns 200, `status=InvalidStatus`
  returns 400, `q=<sql-injection-attempt>` returns 200 (no data
  leak), and `limit=999` clamps to `<= 100`. The script also
  gained a `assertNoDownloadUrlLeak` helper and writes its run
  output to `reports/phase-f-api-regression.report.txt`
  (gitignored).
- Updated `README.md` to document the new
  `GET /api/tasks?limit&offset&status&q&sort` contract, the
  copy / fill-form affordances, the new empty states, and the
  expanded `check:api` coverage.
- Refreshed the project status block to mark Phase F as merged.

---

## 2. Why task history UI next, and not image-to-video

- Image-to-video, first/last frame, and subject reference are
  meaningful new product surfaces. Each one deserves a focused
  phase with its own design, failure modes, and quota budget.
  Bundling them with a UI polish phase would risk shipping
  something half-working.
- The local workbench is the surface users spend the most time
  in. After Phase E added `download_url` refresh and polling
  guardrails, the next visible pain point was the task history
  list: no filter, no search, no pagination, no time grouping,
  and the task detail panel only had a single "Copy params to
  recreate" button on failed tasks.
- The work is mostly UI + a small SQL/Express refactor — the
  kind of change that can be validated end-to-end without
  consuming any MiniMax quota. That is the right risk shape
  for a "polish" phase.
- Doing the polish first also makes the next generation-mode
  phase easier: the new modes will inherit the same task
  detail + history affordances for free, with no
  ad-hoc page-overflow fixes.

---

## 3. Backend `GET /api/tasks` shape

### Query parameters (all require `passcode`)

| Param    | Type    | Default        | Notes |
|----------|---------|----------------|-------|
| `limit`  | integer | `20`           | Clamped to a maximum of `100` server-side; non-positive values fall back to `20` |
| `offset` | integer | `0`            | Non-negative integer; non-finite or negative values fall back to `0` |
| `status` | string  | (unset)        | One of `Preparing`, `Queueing`, `Processing`, `Success`, `Fail`; anything else returns `400` |
| `q`      | string  | (unset)        | Whitespace-trimmed `LIKE` keyword matched against `prompt`, `model`, and `task_id`; bound through `?` parameters in `sqlite3` |
| `sort`   | string  | `updated_desc` | One of `updated_desc`, `created_desc`; anything else returns `400` |

### Response

```json
{
  "tasks": [
    {
      "id": 1,
      "task_id": "...",
      "prompt": "...",
      "model": "MiniMax-Hailuo-2.3",
      "duration": 6,
      "resolution": "768P",
      "prompt_optimizer": true,
      "status": "Success",
      "file_id": "...",
      "download_url": "...",
      "fail_reason": null,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 42,
    "hasMore": true
  },
  "filters": {
    "status": "Success",
    "q": "windmill",
    "sort": "updated_desc"
  }
}
```

### Hard guarantees

- No `passcode` → `401` (unchanged from Phase E).
- `limit > 100` → clamped to `<= 100` before responding.
- `status` outside the allow-list → `400` with an explicit
  allowed list in the `error` string.
- `sort` outside the allow-list → `400` with an explicit
  allowed list in the `error` string.
- `q` is always bound through `?` parameters in the prepared
  statement, so SQL injection attempts return an empty or
  partial result set rather than leaking data.
- The `MINIMAX_API_KEY` is never included in the response.
  `download_url` may be present for `Success + file_id` tasks
  to power the video player; this is intentional and is
  documented in Phase E. Public reports do not include real
  `download_url` values.

---

## 4. Frontend task history panel

The new panel has the following structure (top to bottom):

- **Header** with title `Task history` and a `Refresh list`
  button that re-queries the current filter at the current
  offset (and is disabled while a request is in flight).
- **Toolbar**:
  - Status chip group: `全部` / `成功` / `失败` / `生成中`.
    Selecting a chip updates the active filter; the underlying
    `生成中` chip maps to the backend `Processing` status.
  - Search input with `搜索` and (when a value is present)
    `清空` buttons. The search is committed on submit, so
    typing alone does not re-query.
- **Summary line** showing the current filter (status + keyword)
  and `共 N 条 · 第 A–B 条`.
- **Empty state** with one of two messages:
  - No filter active and no tasks →
    `还没有任务。创建一个文生视频任务后会显示在这里。`
  - Filter active and no match →
    `没有匹配的任务，试试清空筛选条件。`
- **Grouped lists**:
  - `Today` / `Yesterday` / `Earlier` headers (in that order).
  - Per-card layout: prompt excerpt (up to 80 characters with
    `…` ellipsis and a full `title` attribute), a status pill,
    and a `model / duration / resolution / file_id / download_url`
    summary line, followed by an `updated_at` line.
  - Selected task is visually distinguished (green border +
    glow) as in Phase E.
- **Pagination footer** with `上一页` / `下一页` and a
  `第 N 页 · 每页 20 条` indicator.

The `Copy Prompt` / `Copy task params` / `Fill form with these
params` actions live in the task **detail** panel (next to
`Refresh task status`); see §5.

---

## 5. Task detail copy / fill-form affordances

The task detail panel now exposes four action buttons in
addition to the Phase E refresh actions:

| Button                    | Visible when          | Effect |
|---------------------------|-----------------------|--------|
| `Copy Prompt`             | any selected task     | Copies the raw `prompt` string to the clipboard |
| `Copy task params`        | any selected task     | Copies a JSON object containing `prompt`, `model`, `duration`, `resolution`, `prompt_optimizer` to the clipboard |
| `Fill form with these params` | any selected task | Populates the create form (model, duration, resolution, `prompt_optimizer`, prompt) without auto-submitting |
| `Copy params to recreate` | `Fail` status only    | Same effect as the previous Phase E button; kept for clarity on failed tasks |

For failed tasks a red-bordered warning is shown beneath the
action row:

> 任务失败。重新提交会消耗 MiniMax 视频额度，请确认参数后再点击 Submit。

For successful tasks with a `download_url` the existing video
player, `Download video` link, and `Re-fetch download link`
button continue to work unchanged.

For successful tasks with a `file_id` but no `download_url` the
`Refresh download link` button continues to work unchanged.

The clipboard calls use `navigator.clipboard.writeText` first
and fall back to a temporary `<textarea>` + `execCommand('copy')`
for environments where the modern API is unavailable. Failures
are reported in the existing `hint` line, never by throwing.

---

## 6. `check:api` new coverage

`npm run check:api` now exercises 13 checks total. The new
Phase F checks are:

1. `GET /api/tasks?limit=5&offset=0` with passcode → `200`
   with a `pagination` block (`limit`, `offset`, `total`).
2. `GET /api/tasks?status=Success` with passcode → `200`.
3. `GET /api/tasks?status=InvalidStatus` with passcode → `400`.
4. `GET /api/tasks?q=<sql-injection-attempt>` with passcode →
   `200`; the script asserts the body is a valid task list
   (proving the keyword went through parameterized SQL and did
   not break the query).
5. `GET /api/tasks?limit=999` with passcode → `200` and
   `pagination.limit <= 100`.

Additional safeguards:

- The script now uses a separate `assertNoDownloadUrlLeak`
  helper for any endpoint that might return a `download_url`,
  asserting the response body does not contain a URL fragment
  with `http(s)://` and 16+ characters.
- The script aborts immediately if `CONFIRM_REAL_VIDEO=1` is
  set in the environment (exit code `2`).
- The script never reads, logs, or prints `MINIMAX_API_KEY`.
- The script never calls `POST /api/video/create` with a valid
  payload. The two create-path checks are rejection paths only.
- The script shuts the backend down on exit (success or
  failure).
- Run output is appended to
  `reports/phase-f-api-regression.report.txt`, which is
  gitignored.

---

## 7. Did this phase create a new video task?

**No.** All new code paths are read-only against the local
SQLite database and only update the local view. The new
`GET /api/tasks` query parameters do not call MiniMax in any
way. `POST /api/video/create` was not changed in this phase.

---

## 8. Did this phase consume MiniMax video quota again?

**No.** This phase ships no code path that creates a new
MiniMax text-to-video task. The dry-run smoke flow continues
to be the only path the developer would normally use, and it
remains a true dry run.

---

## 9. Local acceptance results

The acceptance steps run during the Phase F hand-off were:

1. `npm install` — installs the same 316 packages as the
   Phase E hand-off. No new runtime dependencies were added.
2. `npm run build` — vite build completes (`built in < 1s`).
3. `npm run smoke:video` — `Final status: skipped`,
   `Real quota consumed: No`. This is a true dry run.
4. `npm run check:api` — all 13 regression checks PASS on
   the first run. The script reports
   `summary: 13/13 checks passed` and exits with code `0`.

After the automated checks the developer is expected to start
the server, open the page, enter `SITE_PASSCODE`, and confirm
manually that:

1. The page renders.
2. After entering `SITE_PASSCODE`, the task history list
   appears (empty or populated, depending on local SQLite
   state).
3. The status filter chips work — selecting `成功` / `失败` /
   `生成中` narrows the list to tasks of that status.
4. The search input narrows the list to tasks whose
   `prompt` / `model` / `task_id` contains the keyword.
5. The `上一页` / `下一页` buttons paginate within the
   current filter and respect `pagination.hasMore`.
6. Clicking a task card opens its detail in the detail panel.
7. `Copy Prompt` and `Copy task params` populate the
   clipboard.
8. `Fill form with these params` puts the task's parameters
   into the create form without auto-submitting.
9. An illegal combination (e.g. `MiniMax-Hailuo-2.3` + `6s` +
   `4K`) and a 3000-character prompt are still rejected
   client-side and server-side without reaching MiniMax.

---

## 10. Were any real `task_id` / `file_id` / `download_url` committed?

**No.** The only tracked files that talk about `task_id` /
`file_id` / `download_url` are this report, `README.md`, and
the in-tree source code. Every reference is a description of
the field, an example schema, a CSS class name, or the SQL
column name. No real values are present in this document, in
`README.md`, or in any other tracked file added by this
phase.

---

## 11. Was any key / IP / domain / passcode leaked?

**No.** A scan of the Phase F diff against the same patterns
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

## 12. What the system can do after Phase F

- Submit a text-to-video task and poll its status with bounded
  backoff.
- Show clear `file_id` and `download_url` presence indicators.
- Manually refresh a single task's status from the UI.
- Manually refresh a `Success + file_id` task's `download_url`
  without creating a new video task.
- Browse the local task history with status filtering, keyword
  search, and paginated results, grouped by `Today` /
  `Yesterday` / `Earlier`.
- Copy a task's `prompt` or its `prompt + model + duration +
  resolution + prompt_optimizer` JSON to the clipboard.
- Refill the create form with a selected task's parameters
  (without auto-submitting).
- Run an offline API regression suite via `npm run check:api`
  that exercises the new task-list filtering, pagination,
  search, and limit-clamping endpoints in addition to the
  Phase E endpoints.
- Continue to run the default dry-run smoke via
  `npm run smoke:video` without ever consuming quota.

---

## 13. What the system still cannot do

- It cannot generate image-to-video, first/last frame, or
  subject-reference videos. These are explicitly out of scope
  for Phase F.
- It cannot run inside Docker, a CI pipeline, or a Tencent
  Cloud deployment slot. Phase F is a local-dev phase.
- It cannot auto-regenerate a failed task. The fill-form
  button only populates the form; the user must click
  `Submit` manually.
- It cannot refresh a `download_url` for a `file_id` that
  has no local SQLite record. The endpoint returns `404` in
  that case and tells the user to open the task from history
  first.
- It cannot poll beyond `maxAttempts` or
  `maxDurationMinutes`. When that happens, the user must
  refresh from history.

---

## 14. Next phase suggestions

- **Phase G — Download link expiry detection.** Add a soft
  TTL on `download_url` (e.g. "this link is older than N
  hours, you may want to refresh") and surface it in the
  task detail panel. The refresh endpoint is already in
  place.
- **Phase H — Real error categorization.** Map MiniMax
  error codes into user-friendly categories (quota, rate
  limit, invalid combo, server error) so the UI can
  recommend the right next action.
- **Phase I — Image-to-video.** A new generation surface,
  deserves its own design + failure-mode phase. Will
  inherit the Phase F task history + detail affordances
  for free.
- **Phase J — Optional Docker + Tencent Cloud deployment.**
  Keep this as a separate phase to avoid scope creep in
  Phase F.
- **Phase K — Dependency hygiene.** Address the inherited
  npm audit advisories in a controlled phase with a locked
  `package-lock.json`. Do not bundle this into Phase F.

---

## 15. Open-source boundary

Files added or modified by Phase F:

- `server/db.js` — new `buildTaskQuery`, `getRecentTasks`,
  `countTasks` helpers; module export extended.
- `server/services/taskStore.js` — `listTasks` accepts
  `status`, `q`, `sort`; new `countFilteredTasks` helper.
- `server/index.js` — `GET /api/tasks` rewritten with the new
  paginated, filterable, searchable contract; new
  `ALLOWED_STATUSES`, `TASK_LIST_DEFAULT_LIMIT`,
  `TASK_LIST_MAX_LIMIT` constants.
- `web/src/App.jsx` — new toolbar, history groups, empty
  states, pagination, copy / fill-form actions, helper
  utilities (`summarizePrompt`, `groupTasksByDate`,
  `copyTextToClipboard`, etc.); hero subtitle updated to
  reference Phase F.
- `web/src/styles.css` — new `.history-toolbar`,
  `.history-status-filter`, `.history-search`,
  `.history-summary`, `.history-groups`,
  `.history-group-title`, `.history-item-main`,
  `.history-item-prompt`, `.history-item-meta`,
  `.history-item-time`, `.status-pill`, `.history-pagination`,
  `.pagination-info`, `.empty-state`, `.chip.active`
  classes.
- `scripts/check-api-regression.js` — five new checks
  (pagination, status filter, status validation, search
  SQL-safety, limit clamping); new
  `assertNoDownloadUrlLeak` helper; report file renamed to
  `reports/phase-f-api-regression.report.txt`.
- `README.md` — new "Task history filtering, pagination,
  and search" and "Task detail copy / fill-form
  affordances" sections; expanded `check:api` coverage
  section; status block updated.
- `docs/PHASE_F_TASK_HISTORY_UI_REPORT.md` (this report).

Files explicitly **not** changed or added:

- `.env` — still not tracked, still placeholder.
- `data/*.db` / `data/*.sqlite` — still not tracked.
- `reports/local/` — still not tracked.
- `node_modules/`, `dist/`, `logs/` — still not tracked.
- `reports/phase-f-api-regression.report.txt` — runtime
  artifact, ignored by `.gitignore`.

The dependency set is unchanged: Phase F adds no new npm
runtime or dev dependencies. The `package.json` and
`package-lock.json` were not modified by this phase.
