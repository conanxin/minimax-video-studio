# Phase H - Error Categorization and Smoke Dry-run Hygiene

> Public report for Phase H of `minimax-video-studio` (follow-up to
> Phase G). Phase H ships two changes that share the same hygiene
> theme: (1) a pure error-classification layer that turns any `Fail`
> task's `fail_reason`, `base_resp.status_code`, and HTTP status into
> a stable category plus a user-friendly message and a suggested next
> action; (2) a smoke-hygiene fix that stops the default
> `npm run smoke:video` from overwriting the public
> `docs/PHASE_A_API_SMOKE_REPORT.md` on every dry-run. It does **not**
> create any new MiniMax video task and does **not** consume any
> additional MiniMax quota.

---

## 1. What this phase did

- Added a new server module
  `server/services/errorClassifier.js` with a pure
  `classifyVideoError(input)` function. The function is stateless,
  has no I/O, has no new dependencies, and returns
  `{ error_category, severity, user_message, suggested_action, can_retry, retry_hint }`
  for any of eight categories: `quota`, `rate_limit`,
  `invalid_params`, `auth`, `server_error`, `network`, `timeout`,
  `unknown`. A second helper `classifyFromTask(task)` adapts a
  `tasks` row into the same shape.
- Extended `server/index.js` so `toSafeTaskPayload(task)` injects
  the six new fields (`error_category`, `error_severity`,
  `error_user_message`, `error_suggested_action`,
  `error_can_retry`, `error_retry_hint`) for every task returned
  by any endpoint. The fields are computed dynamically from the
  existing `fail_reason`; no SQLite migration is required.
- Extended the React UI (`web/src/App.jsx` +
  `web/src/styles.css`) so the task detail panel renders a new
  "错误类型" block whenever the selected task is `Fail`. The block
  shows the category pill, a severity tag, a Chinese user
  message, a suggested next action, a "是否适合重试" label, and a
  category-specific warning (`invalid_params` nudges the user
  toward the "用此参数填回表单" button; `quota` / `auth`
  emphasize fixing the root cause; `rate_limit` / `server_error`
  / `network` / `timeout` explicitly say the system will **not**
  auto-regenerate the task).
- Rewrote `scripts/smoke-text-to-video.js` so the default
  `CONFIRM_REAL_VIDEO != 1` path no longer touches the public
  `docs/PHASE_A_API_SMOKE_REPORT.md`. The script now:
  - prints a 5-line console summary
    (`final_status`, `real_quota_consumed`, `fail_reason`,
    `local_md`, `local_json`),
  - writes `reports/local/smoke-dry-run.local.md` and
    `reports/local/smoke-dry-run.local.json` (both gitignored
    under `reports/local/`),
  - keeps the real-smoke path
    (`CONFIRM_REAL_VIDEO=1` + `PHASE_C1=1`) writing
    `reports/local/phase-c1-real-smoke.local.{md,json}` and the
    public `docs/PHASE_C1_REAL_SMOKE_REPORT.md` exactly like
    before.
- Extended `scripts/check-api-regression.js` with ten new
  offline checks (seven unit-style assertions on
  `errorClassifier` plus three seed-driven `/api/tasks`
  coverage checks plus one smoke-hygiene check that records
  `docs/PHASE_A_API_SMOKE_REPORT.md` content + mtime, runs
  `smoke:video` dry-run, and asserts both are unchanged plus
  that the dry-run output never echoes a real key fragment).
  The report file is now `reports/phase-h-api-regression.report.txt`.
- Updated `README.md` with a new "Error categorization" section
  (full category table, response fields, frontend behavior), a
  new "Smoke hygiene" section (the two-layer smoke-report split,
  the new gitignored breadcrumbs, the regression check), and
  expanded `check:api` coverage list.

---

## 2. Why error categorization and smoke dry-run hygiene next, and not image-to-video

- Image-to-video, first/last frame, and subject reference are
  meaningful new product surfaces. Each one deserves a focused
  phase with its own design, failure modes, and quota budget.
- The previous phases shipped a strong "happy path" — task
  creation, polling guardrails, history with freshness, copy /
  fill-form affordances — but the **failure** path was thin: a
  raw `fail_reason` string and a red "Fail reason:" line. Users
  who hit a quota error or a rate limit had to read the raw text
  to figure out what to do next.
- Phase H is a small, pure-function classifier plus a thin UI
  polish. It does not require any new MiniMax quota budget, does
  not change the create / poll / refresh path, and does not
  require any new dependency. That is the right risk shape for a
  "polish" phase.
- The smoke-hygiene half of Phase H is a long-overdue
  cleanup. `docs/PHASE_A_API_SMOKE_REPORT.md` is a public
  historical artifact; letting the smoke script mutate it on
  every dry-run was a recurring source of false-positive
  `git status` diffs (and once a near-leak of a real key
  fragment). Fixing it now, while the file is small, is cheaper
  than carrying the debt into the next generation-mode phase.

---

## 3. Error categories

The classifier is a pure function of three inputs: the HTTP
status (if known), the MiniMax `base_resp.status_code` (if
known), and the textual `fail_reason` / `status_msg` / `message`.
The category precedence is: explicit HTTP status first, then
keyword match in the textual fields, then `unknown` as the safe
fallback.

| `error_category` | Trigger (example) | `can_retry` | `severity` |
|-------------------|-------------------|-------------|------------|
| `quota` | `out of quota`, `insufficient balance`, `token plan`, 额度 / 余额 | `false` (must top up first) | `error` |
| `rate_limit` | `rate limit`, `too many requests`, HTTP 429, 限流 | `true` | `warning` |
| `invalid_params` | `invalid`, `unsupported model`, `prompt too long`, 参数 / 不支持 | `true` | `warning` |
| `auth` | HTTP 401/403, `unauthorized`, `forbidden`, `invalid api key` | `false` (must fix key first) | `error` |
| `server_error` | HTTP 5xx, `internal error`, `service unavailable` | `true` | `warning` |
| `network` | `ECONNRESET`, `ETIMEDOUT`, `fetch failed`, 网络 | `true` | `warning` |
| `timeout` | `polling reached max attempts`, `timed out`, 超时 | `true` (no auto-regenerate) | `info` |
| `unknown` | anything else | `false` | `warning` |

Hard rules:

- The classifier never echoes a real `download_url`, `task_id`,
  `file_id`, or `MINIMAX_API_KEY`. The `user_message` /
  `suggested_action` / `retry_hint` strings are stable
  templates, not copies of the raw error text.
- The `unknown` category is the safe fallback. It must never
  auto-retry, auto-fill, or auto-anything; the user is expected
  to read the raw `fail_reason` and decide for themselves.
- Re-submitting a task (filling the form with the task's
  parameters and clicking Submit) **does** create a new video
  task and consume MiniMax quota. The classifier's
  `retry_hint` always says this, regardless of category.

---

## 4. Frontend task detail changes

The "错误类型" block is rendered between the existing
"Fail reason:" line and the freshness / video blocks. It
contains:

- The category pill, e.g. `quota`, `invalid_params`, `auth`,
  `network`, `timeout`, `rate_limit`, `server_error`,
  `unknown`. Each has a dedicated color via
  `.error-pill.error-<category>` in `web/src/styles.css`.
- A severity tag, e.g. `info` / `warning` / `error`, in
  matching color.
- A Chinese `user_message` line.
- A `建议:` line with the suggested next action.
- A `是否适合重试:` line (`适合` / `不建议（需先处理根因）`).
- A `retry_hint` line that always reminds the user that
  re-submitting consumes quota and the system will not
  auto-regenerate.
- A category-specific red-bordered warning:
  - `invalid_params` → "请点击下方"用此参数填回表单"按钮，把
    参数复制回创建表单并修改模型 / 时长 / 分辨率或缩短
    Prompt。"
  - `rate_limit` / `server_error` / `network` / `timeout` →
    "本系统不会自动重新生成。请稍后从任务历史刷新状态；如
    确认需要新视频，再手动点击 Submit（会消耗额度）。"
  - `quota` / `auth` → "请先检查 MiniMax 额度或 API Key，确认
    无误后再考虑重新提交（会消耗额度）。"

The existing `Fill form with these params`, `Copy params to
recreate`, and the failed-task warning are kept as-is. The
"错误类型" block adds a top-of-card recommendation but does
**not** auto-submit and does **not** change the existing
button behavior.

---

## 5. Smoke dry-run hygiene fix

Before Phase H:

- `npm run smoke:video` in default (non-`CONFIRM_REAL_VIDEO=1`)
  mode rendered `renderPhaseAReport()` and wrote it to
  `docs/PHASE_A_API_SMOKE_REPORT.md`. The file was a public
  historical artifact but was being mutated on every
  developer machine on every dry-run.
- The script also tried to mask `MINIMAX_API_KEY`, but the
  masking helper produced a `repl..._key` fragment on some
  real keys, which is exactly the kind of partial leakage the
  open-source boundary is supposed to prevent.

After Phase H:

- `npm run smoke:video` in default mode renders
  `renderDryRunReport(context)` and writes it to
  `reports/local/smoke-dry-run.local.md` (plus a matching
  `.local.json`). Both paths are gitignored under
  `reports/local/`. The console also prints a 5-line summary.
- `docs/PHASE_A_API_SMOKE_REPORT.md` is no longer touched by
  the smoke script in any mode. It is a historical artifact
  and is updated only by a dedicated phase (e.g. the
  Phase A hand-off).
- Real smoke (`CONFIRM_REAL_VIDEO=1`) still writes
  `reports/local/phase-c1-real-smoke.local.{md,json}`. The
  public `docs/PHASE_C1_REAL_SMOKE_REPORT.md` is only updated
  when `PHASE_C1=1` is also set, exactly like in Phase C.1.
- The dry-run output no longer echoes any
  `MINIMAX_API_KEY` value. The output line for the key is
  `api_key_present: yes (masked elsewhere)`, which is true
  by definition and contains no real fragment.

---

## 6. `check:api` new coverage

`npm run check:api` now runs 29 checks total (19 from
Phase E/F/G + 10 from Phase H):

1. `errorClassifier({ fail_reason: 'out of quota' })` returns
   `error_category: 'quota'`.
2. `errorClassifier({ status: 429 })` returns
   `error_category: 'rate_limit'`.
3. `errorClassifier({ fail_reason: 'unsupported model' })`
   returns `error_category: 'invalid_params'`.
4. `errorClassifier({ status: 401 })` returns
   `error_category: 'auth'`.
5. `errorClassifier({ status: 503 })` returns
   `error_category: 'server_error'`.
6. `errorClassifier({ fail_reason: 'fetch failed' })` returns
   `error_category: 'network'`.
7. `errorClassifier({ fail_reason: 'polling reached max
   attempts' })` returns `error_category: 'timeout'`.
8. `GET /api/tasks?status=Fail quota row` returns
   `error_category: 'quota'`,
   `error_severity: 'error'`, `error_can_retry: false`.
9. `GET /api/tasks?status=Fail invalid_params / auth / network
   rows` return the matching `error_category` for each.
10. `npm run smoke:video` (dry-run) leaves
    `docs/PHASE_A_API_SMOKE_REPORT.md` content + mtime
    unchanged, and its console output never echoes a real
    key fragment.

Additional safeguards:

- `seedFixtures()` writes 9 obviously-fake rows
  (`local-seed-g-*` Phase G freshness + 4 new
  `local-seed-h-fail-*` Phase H error-category rows) into the
  local SQLite DB before the server boots. All
  `download_url` placeholders are short
  `local-placeholder://...` strings that never appear in
  the public report; the script only asserts
  `present/absent` and the age / category values.
- The script aborts immediately if `CONFIRM_REAL_VIDEO=1`
  is set in the environment (exit code `2`).
- The script never reads, logs, or prints
  `MINIMAX_API_KEY`.
- The script never calls `POST /api/video/create` with a
  valid payload. The two create-path checks remain rejection
  paths only.
- The script shuts the backend down on exit (success or
  failure).
- Run output is appended to
  `reports/phase-h-api-regression.report.txt`, which is
  gitignored.

---

## 7. Did this phase create a new video task?

**No.** The new code paths are all read-only against the
local SQLite database. `POST /api/video/create` was not
changed in any way that would cause it to be called by the
new code. The `seedFixtures()` helper writes only
obviously-fake `local-seed-g-*` and `local-seed-h-*` rows
and lives in the same gitignored SQLite file as the rest
of the local state.

---

## 8. Did this phase consume MiniMax video quota again?

**No.** The error classifier is a pure function of local
state and a few keyword patterns. It does not call MiniMax.
The smoke dry-run is a true dry run (no `CONFIRM_REAL_VIDEO=1`)
and now writes only to gitignored local paths.

---

## 9. Were any real `task_id` / `file_id` / `download_url` committed?

**No.** The only tracked files that talk about `task_id` /
`file_id` / `download_url` are this report, `README.md`, and
the in-tree source code. Every reference is a description of
the field, an example schema, a CSS class name, or the SQL
column name. The local seed uses obviously-fake values
(`local-seed-g-*` / `local-seed-h-*` task ids, fake
`file-seed-*-*` file ids, `local-placeholder://...`
download url placeholders) and the seeded SQLite rows live
in a gitignored file.

---

## 10. Was any key / IP / domain / passcode leaked?

**No.** A scan of the Phase H diff against the same patterns
used in `scripts/check-open-source.js` returns zero hits:

- No real `MINIMAX_API_KEY`. The smoke dry-run no longer
  echoes any key fragment at all.
- No real `Bearer ...` token.
- No real internal IP. The only IP reference is the local
  loopback `127.0.0.1` used by `check:api` to talk to the
  locally-bootstrapped backend.
- No real private domain. The only domain reference is the
  public MiniMax base URL `https://api.minimaxi.com`,
  present only as a default in code and documentation.
- No real passcode. All `SITE_PASSCODE` references resolve
  to `change_me` or to the field name itself.

---

## 11. What the system can do after Phase H

- Submit a text-to-video task and poll its status with bounded
  backoff.
- Show clear `file_id` and `download_url` presence indicators.
- Manually refresh a single task's status from the UI.
- Manually refresh a `Success + file_id` task's `download_url`
  without creating a new video task.
- Show a soft `fresh / aging / stale / absent / unknown`
  freshness pill on every task that has a `file_id`, both in
  the history list and in the task detail panel.
- Show an age label such as `2 小时前刷新` in the task
  detail panel.
- Surface a red-bordered warning in the task detail panel
  whenever the freshness status recommends a refresh.
- Surface a `如果视频无法播放` hint whenever the `<video>`
  element fails to load.
- Show a stable `error_category` / `error_severity` /
  `error_user_message` / `error_suggested_action` /
  `error_can_retry` / `error_retry_hint` block on every
  `Fail` task, with a category-specific recommendation.
- Run `npm run smoke:video` in dry-run mode without
  ever touching any tracked file.
- Run an offline API regression suite via
  `npm run check:api` with 29 checks covering the Phase E /
  F / G / H contracts, including the new smoke-hygiene
  check.

---

## 12. What the system still cannot do

- It cannot generate image-to-video, first/last frame, or
  subject-reference videos. These are explicitly out of
  scope for Phase H.
- It cannot run inside Docker, a CI pipeline, or a Tencent
  Cloud deployment slot. Phase H is a local-dev phase.
- It cannot auto-refresh a `download_url`. Every refresh
  requires a user click.
- It cannot auto-regenerate a failed task. The error
  classifier and the frontend copy make this explicit
  across all categories.
- It cannot refresh a `download_url` for a `file_id` that
  has no local SQLite record. The endpoint returns `404`
  in that case.
- It cannot poll beyond `maxAttempts` or
  `maxDurationMinutes`. When that happens, the user must
  refresh from history; the error classifier tags this as
  `timeout` and explicitly says "no auto-regenerate".

---

## 13. Next phase suggestions

- **Phase I — Image-to-video.** A new generation surface
  that deserves its own design + failure-mode phase. The
  Phase F history affordances, the Phase G freshness
  pill, and the Phase H error classification will carry
  over for free.
- **Phase J — Optional Docker + Tencent Cloud deployment.**
  Keep this as a separate phase to avoid scope creep in
  Phase H.
- **Phase K — Dependency hygiene.** Address the inherited
  npm audit advisories in a controlled phase with a locked
  `package-lock.json`. Do not bundle this into Phase H.
- **Phase L — Configurable error thresholds.** Promote the
  eight `error_category` triggers into a shared config so
  operators can tune the keyword patterns per deployment
  without code changes.
- **Phase M — Sentry-style local error log.** Persist the
  most recent `Fail_reason` + `error_category` pairs in
  `reports/local/error-events.local.jsonl` (gitignored) so
  a developer can grep the local error history without
  re-running real smoke.

---

## 15. Open-source boundary

Files added or modified by Phase H:

- `server/services/errorClassifier.js` (new) — pure
  classifier with 8 categories, no I/O, no new
  dependencies.
- `server/index.js` — `toSafeTaskPayload` injects the six
  `error_*` fields; module-level `require` for the
  classifier.
- `web/src/App.jsx` — new "错误类型" block in the task
  detail panel; category pill, severity tag, and
  category-specific warnings for `invalid_params` /
  `quota` / `auth` / `rate_limit` / `server_error` /
  `network` / `timeout`.
- `web/src/styles.css` — new `.error-category-block`,
  `.error-pill`, `.severity-tag`, and the seven
  `.error-pill.error-<category>` color variants.
- `scripts/smoke-text-to-video.js` — replaced
  `renderPhaseAReport` / `writePhaseAReport` with
  `renderDryRunReport` / `writeDryRunReports`; dry-run now
  writes only to `reports/local/smoke-dry-run.local.*`
  and prints a 5-line console summary. Real smoke
  behavior (with `PHASE_C1=1`) is unchanged.
- `scripts/check-api-regression.js` — ten new Phase H
  checks (7 unit-style on `errorClassifier`, 2 on
  `GET /api/tasks` error_category coverage, 1 on smoke
  dry-run hygiene); `seedFreshnessFixtures` renamed to
  `seedFixtures` and extended with 4 `local-seed-h-*`
  error-category rows; report file renamed to
  `reports/phase-h-api-regression.report.txt`; `[phase-g]`
  log tags updated to `[phase-h]`.
- `README.md` — new "Error categorization" and "Smoke
  hygiene" sections; expanded `check:api` coverage list;
  status block updated.
- `docs/PHASE_H_ERROR_CATEGORIZATION_REPORT.md` (this
  report).

Files explicitly **not** changed or added:

- `.env` — still not tracked, still placeholder.
- `data/*.db` / `data/*.sqlite` — still not tracked.
- `reports/local/` — still not tracked (matches
  `reports/local/` in `.gitignore`).
- `node_modules/`, `dist/`, `logs/` — still not tracked.
- `reports/phase-h-api-regression.report.txt` — runtime
  artifact, ignored by `.gitignore`.
- `package.json` / `package-lock.json` — unchanged. Phase H
  adds no new npm runtime or dev dependencies.
- `shared/pollingConfig.json` — unchanged. Phase H does not
  touch polling.
- `shared/downloadLinkConfig.json` — unchanged. Phase H
  does not touch freshness.
- `server/services/minimaxClient.js` — unchanged. The
  client library is the same as in Phase E.
- `docs/PHASE_A_API_SMOKE_REPORT.md` — unchanged. The
  smoke script no longer touches this file; the file is a
  historical artifact and is only updated by a dedicated
  phase.
- `docs/PHASE_C1_REAL_SMOKE_REPORT.md` — unchanged. The
  real-smoke path with `PHASE_C1=1` is preserved as-is.
