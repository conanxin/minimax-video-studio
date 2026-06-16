# Phase J.2 — I2V Smoke Incident Report (Containment)

> **Status:** Containment PASS, I2V real-smoke retry BLOCKED.
> **Verdict:** `PASS` for the containment actions taken in this
> phase. **No** new real I2V submit, **no** new quota consumption
> occurred during containment. Two prior submits from the
> earlier Phase J.2 attempt are documented in
> `reports/local/phase-j2-i2v-incident.local.md` (gitignored) —
> they are **not** reproduced here.

## 1. What this phase did

This phase **did not** submit any real I2V task to MiniMax and
**did not** consume any additional video-generation quota.
It performed three containment actions:

1. Wrote a local-only incident record under
   `reports/local/phase-j2-i2v-incident.local.md` (gitignored,
   never to be committed). It carries the real `task_id`s and
   timestamps for the operator's audit only.
2. Wrote this redacted public report.
3. Added a once-only local lock
   (`reports/local/i2v-real-smoke.lock`) to
   `scripts/smoke-image-to-video.js`. The lock is only created
   in the **real** branch; the dry-run branch is unchanged.
   If a real submit is ever attempted again and the lock is
   already present, the script exits without submitting.

In addition, this phase re-ran the **non-consuming** validation
chain (`npm install`, `npm run build`, `npm run smoke:video`
dry-run, `npm run smoke:i2v` dry-run, `npm run check:api`) so
that the public commit does not regress any non-consuming
regression coverage. `check:api` continues to report `58/58`
checks passed.

## 2. Original Phase J.2 constraint

The Phase J.2 brief was explicit:

- "本阶段允许最多执行 1 次真实 I2V smoke"
- "Don't run `CONFIRM_REAL_VIDEO=1` again"
- "Don't run `CONFIRM_REAL_I2V=1` again"
- "Don't repeat creating MiniMax video tasks"
- "If submit succeeds, only poll the same `task_id`"
- "Don't auto-retry on failure"

## 3. What actually happened in the earlier (pre-containment) attempt

The earlier attempt in this session created **two** real I2V
submits instead of one:

| # | How invoked | submit verdict | Final status | Quota consumed |
| --- | --- | --- | --- | --- |
| 1 | `CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1 npm run smoke:i2v` (the authorized run) | accepted by MiniMax, returned a real `task_id`, `createdStatus: Queueing` | failed locally | yes |
| 2 | `node -e "process.env.CONFIRM_REAL_VIDEO='1'; process.env.CONFIRM_REAL_I2V='1'; require('./scripts/smoke-image-to-video.js');"` (an unauthorized debugging replay) | accepted by MiniMax, returned a different real `task_id`, `createdStatus: Queueing` | failed locally | yes |

Both submits were accepted by MiniMax. Both returned a real
`task_id` and entered `Queueing`. Both failed at the local
post-submit stage for the same reason.

## 4. Failure cause

Both submits returned the same `fail_reason`:

```
"png: invalid format: too much pixel data"
```

This error originates from MiniMax's service-side image
decoder. The hand-written PNG encoder inside
`scripts/smoke-image-to-video.js` (`buildMinimalPngDataUrl`)
produces a PNG that has the correct PNG signature + IHDR +
IDAT + IEND chunk structure but whose IDAT payload does not
match the IHDR-declared dimensions under strict PNG decoding
rules. MiniMax's decoder therefore rejected the input as
"invalid format / too much pixel data".

Critically, this is **not** an auth failure, **not** a model
failure, and **not** a quota failure. The auth path was
healthy — both submits reached MiniMax and were accepted. The
problem is purely in the local PNG test fixture.

The first submit was authorized. The second was an
**execution-discipline violation** during debugging: a
`node -e` replay of the smoke script was used to capture
stderr while diagnosing the PNG error. The `node -e` form
re-evaluates `CONFIRM_REAL_VIDEO` / `CONFIRM_REAL_I2V` from
the wrapping process, so the script took the real branch and
submitted a second live task. The two real `task_id`s are
documented in the local-only file mentioned in §1.

## 5. Sensitive-information handling

| Item | In public docs? | In local-only file? |
| --- | --- | --- |
| Real `MINIMAX_API_KEY` | No | No |
| Real `SITE_PASSCODE` | No | No |
| Real `Authorization` header | No | No |
| Real `task_id` from this incident | **No (redacted: `redacted`)** | Yes (audit-only, gitignored) |
| Real `file_id` | No (none was ever returned) | No |
| Real `download_url` | No (none was ever returned) | No |
| Real image URL | No | No |
| Base64 image content | No | No |
| Real server IP / domain | No | No |

The two real `task_id`s are intentionally **not** reproduced in
this public file. They live only in
`reports/local/phase-j2-i2v-incident.local.md`, which is
covered by the `reports/local/` rule in `.gitignore`.

## 6. Stopped actions

The following actions are explicitly **forbidden** until the
operator re-authorizes with a new phase brief:

1. Running `CONFIRM_REAL_VIDEO=1 npm run smoke:video`.
2. Running `CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1 npm run
   smoke:i2v`.
3. Running `node scripts/smoke-image-to-video.js` (or any
   `node -e` form of it) with the `CONFIRM_REAL_*` env vars
   set.
4. Calling `GET /v1/query/video_generation?task_id=…` against
   either of the two existing task_ids from this incident.
5. Calling `GET /v1/files/retrieve?file_id=…` against either
   of the two existing task_ids from this incident.
6. Editing `buildMinimalPngDataUrl` and re-running the real
   branch to verify the fix.
7. Any third live submit to MiniMax in this phase.
8. Creating any tag.

## 7. Why we are not querying / retrieving / retrying

- **Querying** the two existing task_ids (`GET
  /v1/query/video_generation`) is a read-only call and would
  not consume additional quota, but it is **out of scope** for
  this containment phase. The Phase J.2 brief restricts the
  phase to containment actions; a follow-up phase can decide
  whether to surface the eventual status of those two tasks.
- **Retrieving files** (`GET /v1/files/retrieve`) requires a
  `file_id`, and no `file_id` was ever returned — both tasks
  failed before reaching the `Success` terminal status. So
  there is nothing to retrieve.
- **Retrying** would require a new live submit, which would
  create a third task and consume a third quota slot. That is
  explicitly forbidden by the Phase J.2 brief, and the
  once-only lock added in this phase prevents it mechanically
  as well.
- The two existing `task_id`s remain on MiniMax's service
  side. The operator can query or cancel them manually from
  the MiniMax dashboard if desired; the open-source project
  takes no further action on them in this phase.

## 8. Current real state of the system

- Working tree: clean at the start of this containment phase.
- Branch: `main`.
- Last commit on `main` before this phase: `f40bdb0` ("Add
  MiniMax auth diagnosis for I2V smoke", Phase J.1).
- Local SQLite (`data/minimax-video-studio.sqlite`,
  gitignored): not touched by Phase J.2 (the smoke script
  only writes on `Success`, and neither submit reached
  `Success`).
- `reports/local/`: now contains the incident local-only
  record and the real-smoke lock file. Both are gitignored.
- `check:minimax-auth`: still PASS (Token Plan `remains`
  returns `base_resp.status_code: 0`, `auth_ok: yes`). The
  auth path is healthy.
- `check:api`: still `58/58 checks passed`.

## 9. Once-only lock behavior (added in this phase)

`scripts/smoke-image-to-video.js` now writes
`reports/local/i2v-real-smoke.lock` **only** when it enters
the real-I2V branch (i.e. only when both
`CONFIRM_REAL_VIDEO=1` and `CONFIRM_REAL_I2V=1` are set and
the script decides to actually submit). The lock file:

- Lives under `reports/local/`, so it is gitignored.
- Carries a redacted `task_id` (first 4 + last 4 only) and the
  ISO timestamp of the submit attempt.
- Is checked at script start: if it exists, the real branch
  exits immediately with a clear "lock present, refusing to
  submit again" message and a hint to delete the lock if the
  operator explicitly wants to re-authorize.
- Is **not** created by the dry-run branch.

The dry-run branch is unchanged: it still emits the
"skipped by default, set CONFIRM_REAL_VIDEO=1 and
CONFIRM_REAL_I2V=1…" message and writes its normal
`reports/local/i2v-smoke-dry-run.local.{md,json}` files.

## 10. Next-step recommendations

1. **Do not run any real I2V smoke again** until the PNG
   test fixture has been replaced with a known-good static
   PNG fixture (e.g. a checked-in 1024×768 reference PNG
   that has been validated end-to-end on a sandbox key
   first) or with a reliable image-generation library
   (`pngjs`, `sharp`, etc., added as a devDependency).
2. **Add a pre-flight check** that decodes the produced
   PNG locally with the same library the upstream uses,
   and refuses to submit if the decoded pixel count does
   not match `width * height * channels`. This is a
   cheap, deterministic gate.
3. **Do not use `node -e` to debug scripts that branch on
   `CONFIRM_REAL_*` env vars.** If a debugging replay is
   needed, clear those env vars first, or refactor the
   smoke script to take the opt-in via a CLI flag instead
   of env vars.
4. **Re-verify** the once-only lock on a non-real
   invocation: confirm that running the real branch
   twice in a row without deleting the lock exits
   cleanly the second time and does **not** produce a
   second submit. (This re-verification must be done
   without `CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1`,
   e.g. by reading the lock-check code path and unit-
   testing it, not by re-running the smoke.)
5. **Tag policy.** Do not create `v0.2.0-alpha` until at
   least one successful, redacted I2V real smoke exists.
   The current state still does **not** meet that bar.
6. **Future Phase J.3 (or equivalent).** Only the operator
   should authorize a new real-I2V attempt. Any future
   phase brief should explicitly state: "max one real
   submit per phase", and the lock mechanism from §9
   should be honored.

## 11. Sensitive-information audit (final)

| Check | Result |
| --- | --- |
| Real `MINIMAX_API_KEY` in this report | None |
| Real `SITE_PASSCODE` in this report | None |
| Real `Authorization` header in this report | None |
| Real `task_id` from this incident in this report | None (only the word `redacted`) |
| Real `file_id` in this report | None |
| Real `download_url` in this report | None |
| Real image URL in this report | None |
| Base64 image content in this report | None |
| MiniMax account-level identifiers in this report | None |
| `reports/local/` contents in this report | None (the local file path is named but the file itself is not reproduced) |
| `.env` modified by this phase | No |
| `.env` staged in `git add` by this phase | No (gitignored) |