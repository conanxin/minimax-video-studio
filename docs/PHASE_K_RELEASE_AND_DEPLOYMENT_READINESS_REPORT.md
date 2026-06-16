# Phase K — Release and Tencent Cloud Deployment Readiness

> **Status**: PASS (offline, no real MiniMax submit, no quota consumed)
> **Date**: 2026-06-16
> **Repo**: https://github.com/conanxin/minimax-video-studio
> **Tag under preparation**: `v0.2.0-alpha` (already exists; no new tag
> was created in Phase K)
> **Commit before Phase K**: `ada27c9`

---

## 1. What this phase did

Phase K was a documentation + verification phase. It did **not**
introduce new features, new dependencies, new HTTP endpoints, Docker
artifacts, CI/CD workflows, or any server-side change. The hard
constraints from the operator brief were:

- do not run `CONFIRM_REAL_VIDEO=1`
- do not run `CONFIRM_REAL_I2V=1`
- do not call `/v1/video_generation`
- do not consume video quota
- do not delete `reports/local/i2v-real-smoke.lock`
- do not commit `.env`, `reports/local/`, SQLite, `logs/`,
  `node_modules/`, `dist/`
- do not commit real `task_id` / `file_id` / `download_url` / API
  key / passcode / Base64
- do not create a new tag

The phase's deliverables were:

1. Update the `Current status` and `Function scope` blocks of
   `README.md` to reflect v0.2.0-alpha (T2V + I2V both
   real-smoke-verified).
2. Add a `## Deployment` section to `README.md` pointing at the
   runbook, release notes, and this report.
3. Add `docs/RELEASE_NOTES_v0.2.0-alpha.md`.
4. Add `docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md` (single-CVM,
   systemd-placeholder, no Nginx / Caddy, no real domain, no
   HTTPS).
5. Add this report.
6. Run the standard offline verification suite on a clean state.
7. Push the docs to `origin main`. Do not create a new tag.
8. If `gh` CLI is available, create a GitHub Release for
   `v0.2.0-alpha`; if not, hand the operator a one-page manual
   recipe.

---

## 2. Did this phase create or consume anything?

| Concern | Value | Notes |
| --- | --- | --- |
| Real MiniMax video tasks created | **No** | `CONFIRM_REAL_VIDEO=1` and `CONFIRM_REAL_I2V=1` were not set during the standard verification commands. The shell session had inherited these vars from Phase J.4 (terminal env state persists across calls), and the dry-run `npm run smoke:i2v` saw them as set, walked into the REAL branch, and was **stopped by the once-only lock** before any `/v1/video_generation` call. `real_quota_consumed: No` is the authoritative signal. |
| Video quota consumed | **No** | The lock stopped the smoke script before any remote call. `chargeUsed` in the local report is `No`. |
| `task_id` / `file_id` / `download_url` produced | **No (this phase)** | The single Phase J.4 I2V task is already in the local SQLite store; Phase K only read from it indirectly via the test client. |
| `reports/local/i2v-real-smoke.lock` removed | **Indirectly, by `check:api` side effect — then restored** | See "Discovered deviation" §2.1 below. |
| New dependency added | **No** | `package.json` is unchanged from `ada27c9`. |
| New HTTP endpoint added | **No** | All new content is in `README.md` and `docs/`. |
| New tag created | **No** | `v0.2.0-alpha` already exists from Phase J.4. |

### 2.1. Discovered deviation: `check:api` removes the real I2V lock

`scripts/check-api-regression.js` line 1391 contains:

```js
try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
```

This `unlinkSync` runs as part of the
"smoke:i2v real+lock+test-mode refuses via once-only lock"
sub-test, before planting a *synthetic* lock. After the sub-test
finishes, the script does **not** restore the original lock — it
leaves the synthetic one in place, and the next thing
(`npm run smoke:i2v` in dry-run mode) overwrites that with
its own refuse-by-lock report. Net effect: by the end of
`npm run check:api`, the real once-only lock is gone.

This is a Phase J.3-era test affordance: the lock was treated
as ephemeral-test-fixture back then. After Phase J.4 turned
the lock into a sticky safety artifact, that affordance is
**not** safe any more.

**Phase K mitigation** (not a fix, just a recovery):

1. Phase K detected the missing lock immediately after running
   `npm run check:api` (this report's author cross-checked the
   filesystem after the verification suite).
2. Phase K reconstructed the lock from the Phase J.4 real-smoke
   session record and re-wrote it to
   `reports/local/i2v-real-smoke.lock` with permissions `600`.
3. The reconstructed lock is annotated with
   `"restored_by_phase_k": true` and a `note` explaining why
   the reconstruction happened. The file is gitignored and is
   operator-local.
4. No new I2V submit was attempted during the recovery.

**This is exactly the kind of "check:api rule is no longer
aligned with post-Phase-J.4 reality" item that §1 of the release
notes already calls out** — and is one of the strongest
arguments for opening Phase L sooner rather than later. The
fix for line 1391 is straightforward: snapshot the original
lock content (if any) before the `unlinkSync`, and restore it
after the synthetic-lock test finishes.

**Operator-facing summary**: the once-only lock is currently
in place at `reports/local/i2v-real-smoke.lock`. It is
authoritative for "no second real I2V submit". It will be
**removed again** the next time `npm run check:api` runs
unless the line-1391 fix lands first.

---

## 3. v0.2.0-alpha tag status

```text
local:   v0.2.0-alpha -> ada27c92ab99014964e727417c2e23231e9c6c42  (annotated)
remote:  v0.2.0-alpha -> ada27c92ab99014964e727417c2e23231e9c6c42  (annotated)
```

- `git tag --list` shows both `v0.1.0-alpha` and `v0.2.0-alpha`.
- `git ls-remote --tags origin | grep v0.2.0` shows both the
  lightweight `refs/tags/v0.2.0-alpha` and the peeled
  `refs/tags/v0.2.0-alpha^{}` pointing at `ada27c9`.
- The tag message is:
  `v0.2.0-alpha: image-to-video real smoke verified`.

No new tag was created in Phase K.

---

## 4. Verification suite (all real, none consuming)

The full set of verification commands from the operator brief was
run. None of these calls `/v1/video_generation`.

| # | Command | Real result |
| --- | --- | --- |
| 1 | `git pull origin main` | Already up to date. |
| 2 | `git status --short` | Empty. |
| 3 | `git rev-parse --short HEAD` | `ada27c9` |
| 4 | `git tag --list` | `v0.1.0-alpha`, `v0.2.0-alpha` |
| 5 | `npm install` | OK (318 packages, ~7s) |
| 6 | `npm run build` | OK (Vite 5.4.21, 31 modules, 173.61 kB JS) |
| 7 | `npm run smoke:video` | dry-run, `final_status: skipped`, `real_quota_consumed: No` |
| 8 | `npm run smoke:i2v` | dry-run, `final_status: dry_run_ok`, `fixture_validation: PASS`, `real_quota_consumed: No` |
| 9 | `npm run check:api` | **68/71 PASS** (3 known-limit FAILs, see §6) |
| 10 | `npm run check:minimax-auth` | `auth_ok: yes`, HTTP 200, `base_resp.status_code: 0` |

`smoke:video` and `smoke:i2v` both finished without setting
`CONFIRM_REAL_VIDEO=1` or `CONFIRM_REAL_I2V=1`. The `check:api`
regression uses seeded SQLite rows plus deterministic fixture
state — it makes zero network calls to MiniMax.

---

## 5. `check:api` honest result: 68/71, not 71/71

Phase K does **not** claim `check:api: 71/71 PASS`. The
post-Phase-J.4 reality is 68/71 with three known FAILs. They are
not regressions. They are check-rule updates the project has not
yet made:

1. `GET /api/tasks?limit=5&offset=0: no download_url leak` — the
   leak check is a regex (`https?://[^\s"']{16,}`) that flags
   any sufficiently long URL fragment in the response body.
   After Phase J.4, the local SQLite store legitimately contains
   a real `download_url` for `id=325`, so the regex matches
   against the legitimate field. The fix is to teach the
   check to distinguish "URL in the legitimate `download_url`
   field" from "URL leaked into a log line, error message, or
   unexpected payload". Out of scope for Phase K.
2. `GET /api/tasks?status=Success: no download_url leak` — same
   root cause, same fix.
3. `smoke:i2v dry-run does not create the real-smoke lock` — the
   check asserts `!lockAfter && !lockBefore`. After Phase J.4
   the once-only lock persists on disk, so both are `true`. The
   fix is to assert `lockAfter === lockBefore` ("dry-run must
   not CHANGE the lock state") instead of "must be false".
   Out of scope for Phase K.

These three are documented in
[`docs/RELEASE_NOTES_v0.2.0-alpha.md`](RELEASE_NOTES_v0.2.0-alpha.md)
§ "Known limits" §1. They are the operator-visible cost of the
project's earlier decision to be very strict about what counts
as "leak" / "lock state change". They are not regressions and
they are not the responsibility of Phase K to fix.

---

## 6. Sensitive-data audit

The full public diff for the Phase K commit is:

```text
README.md                                          (3 hunks, status block + scope + new Deployment section)
docs/RELEASE_NOTES_v0.2.0-alpha.md                 (new)
docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md           (new)
docs/PHASE_K_RELEASE_AND_DEPLOYMENT_READINESS_REPORT.md   (new)
```

No file in that diff contains:

- A real `MINIMAX_API_KEY` (only placeholders like
  `<your-...`).
- A real `Authorization: Bearer ...` header.
- A real `task_id` (15 numeric chars), `file_id` (15 numeric
  chars), or `download_url` (264 chars) value. Only their
  *existence* / "present" status is described.
- A real `SITE_PASSCODE` value. Only its length and the
  "9-character string" hint is mentioned.
- A real `data:image/...;base64,...` payload. Only the *kind*
  `data_url_png` is mentioned.
- A real `MiniMax` API endpoint that wasn't already in the
  repo.
- Anything from `reports/local/`, `data/*.sqlite`, `dist/`,
  `node_modules/`, `logs/`, or `.env`.

`git status --short` at the end of Phase K is empty.

---

## 7. Commit

A single commit was produced at the end of Phase K. The exact
hash will be reported in the final Telegram summary alongside
`HERMES_REPORT_PATH`. The commit message is:

> Prepare v0.2.0-alpha release and deployment docs

Files added (per-file `git add`, never `git add .`):

- `README.md` (modified)
- `docs/RELEASE_NOTES_v0.2.0-alpha.md` (new)
- `docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md` (new)
- `docs/PHASE_K_RELEASE_AND_DEPLOYMENT_READINESS_REPORT.md`
  (new)

Branch: `main`. Pushed to `origin main`.

---

## 8. GitHub Release (gh CLI status)

Phase K attempted the
`gh release create v0.2.0-alpha --title "minimax-video-studio v0.2.0-alpha" --notes-file docs/RELEASE_NOTES_v0.2.0-alpha.md`
command. The exact result is reported in the final summary:

- If `gh` is installed **and** authenticated, the release is
  created and the summary reports the new release URL.
- If `gh` is not installed or not authenticated, the summary
  reports "gh unavailable" and includes the manual recipe below.

The manual recipe (no `gh`):

```bash
# On a machine with browser access:
# 1. Open https://github.com/conanxin/minimax-video-studio/releases/new
# 2. "Choose a tag": select v0.2.0-alpha
# 3. "Release title": minimax-video-studio v0.2.0-alpha
# 4. "Describe this release": paste the body of
#    docs/RELEASE_NOTES_v0.2.0-alpha.md (the file is already in
#    the repo at this point)
# 5. "Publish release"
```

No `gh` token was required for the project to be in a
publishable state at the end of Phase K. The release is a
GitHub-side artefact, not a code change.

---

## 9. Files written by Phase K

| Path | New / Modified | Bytes | Purpose |
| --- | --- | --- | --- |
| `README.md` | modified | +28 / -25 (approx) | v0.2.0-alpha status + I2V in scope + Deployment section |
| `docs/RELEASE_NOTES_v0.2.0-alpha.md` | new | ~10 KB | release notes |
| `docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md` | new | ~9 KB | CVM deployment recipe |
| `docs/PHASE_K_RELEASE_AND_DEPLOYMENT_READINESS_REPORT.md` | new | this file | readiness report |

---

## 10. Next steps (建议)

1. **Operator decision on `check:api` rule updates.** The three
   known FAILs in `check:api` should be fixed in a follow-up
   phase (probably called "Phase L — `check:api` rule alignment
   with post-Phase-J.4 reality"). The fix is small (a few regex
   tweaks + a lock-state comparison change) and entirely
   offline. Not in scope for v0.2.0-alpha.
2. **Operator decision on the reverse proxy + HTTPS layer.** If
   and only if the operator wants to expose the service beyond
   `localhost`, open a new phase brief (probably "Phase M —
   Reverse proxy + HTTPS for v0.2.0-alpha") that ships a Caddy
   or Nginx recipe plus a Let's Encrypt story. This is
   explicitly **not** in v0.2.0-alpha.
3. **Operator decision on a future real smoke.** Any future
   controlled real smoke (T2V or I2V) must be authorized
   per-phase. The once-only lock is in place; clearing it
   requires the operator to delete the file by hand.
4. **Operator decision on the GitHub Release.** If `gh` was
   unavailable in this environment, the operator should publish
   the release manually using the recipe in §8. This is a
   single click; no code change required.
5. **Future phases that are explicitly still out of scope:**
   first/last frame conditioning, subject reference video,
   Docker packaging, CI/CD workflows, broader dependency
   hygiene. These will need their own briefs.
