# Release Notes — minimax-video-studio v0.2.1-alpha

> **Tag**: `v0.2.1-alpha` (annotated)
> **Commit**: `beacc0d` (Phase L land)
> **Date**: 2026-06-16
> **Repo**: https://github.com/conanxin/minimax-video-studio
> **Status**: Pre-release / personal-MVP / non-official
> **Recommended deployment baseline** — supersedes `v0.2.0-alpha`
> for new deployments.

---

## Summary

`v0.2.1-alpha` is a **maintenance release** that ships the
Phase L regression fix on top of the `v0.2.0-alpha` feature
surface. It contains **no new user-facing features, no new
dependencies, no new HTTP endpoints, no Docker, no CI/CD**.
Its sole purpose is to give operators a stable, clean
`check:api: 72/72 PASS` baseline to deploy to a Tencent Cloud
CVM (or any Linux box) without inheriting the lock-safety
deviation that v0.2.0-alpha honestly disclosed in §1 of its
own release notes.

If you are deploying for the first time, use `v0.2.1-alpha`.
If you cloned `v0.2.0-alpha` already, just `git pull` and
`git checkout v0.2.1-alpha` — see "Upgrade" below.

---

## Why v0.2.1-alpha exists

`v0.2.0-alpha` shipped a feature-complete (for an alpha) MVP
with T2V + I2V real-smoke-verified, the once-only I2V lock,
and `check:api` 68/71 PASS. Its release notes honestly
disclosed four "Known limits" items in §1 — three were
regression-test mismatches with the post-Phase-J.4 reality,
and the fourth was a test-script side effect that destroyed
the real once-only lock during `npm run check:api`.

`v0.2.1-alpha` exists to:

1. **Resolve all four known limits** of `v0.2.0-alpha`. The
   one-time `check:api` regression is now `72/72 PASS` (one
   new test was added; the four pre-existing FAILs are now
   PASS).
2. **Lock down the sticky-lock contract** so future phases
   that touch `check:api` cannot accidentally re-introduce
   the lock-deletion side effect.
3. **Give operators a single, well-understood commit** to
   deploy. The Phase L commit `beacc0d` is the recommended
   pin.

`v0.2.0-alpha` is preserved (still tagged, still releasable)
for reproducibility of the Phase J.4 single-submit record, but
new deployments should skip it and go straight to
`v0.2.1-alpha`.

---

## Changes since v0.2.0-alpha

### Code

- `scripts/check-api-regression.js`:
  - New `snapshotLockState` / `restoreLockState` /
    `assertLockUnchanged` helpers in
    `scripts/check-api-regression.js`.
  - "smoke:i2v dry-run" sub-test refactored to snapshot the
    real lock, run the dry-run, and assert byte-for-byte
    preservation (content + mode + size).
  - "smoke:i2v real+lock+test-mode" sub-test refactored to
    use a dedicated test-only lock path
    (`reports/local/i2v-real-smoke.test.lock`) and an
    explicit `I2V_SMOKE_LOCK_PATH` pin, so the smoke script
    reads/writes the test lock instead of the real one.
  - New explicit `CONFIRM_REAL_VIDEO=''` /
    `CONFIRM_REAL_I2V=''` in the dry-run sub-test's child
    `env`, so a parent shell with stale env vars cannot push
    the dry-run into the REAL branch.
  - New `assertLockUnchanged` checks in both sub-tests so
    any future regression that touches the real lock fails
    `check:api` loudly.
  - `assertNoDownloadUrlLeak` rewritten from a regex against
    the whole body to a structured walk that accepts the
    legitimate `download_url` field value, skips the official
    API base (`https://api.minimaxi.com/` /
    `https://www.minimaxi.com/`), skips test fixture
    obvious-fake hosts (`*.example.invalid`, anything
    containing `local-seed-`), and only flags 16+ char
    `http(s)://` fragments that appear in non-legitimate
    positions.
- `scripts/smoke-image-to-video.js`:
  - One-line change at the top of the file: `I2V_REAL_LOCK_PATH`
    now honours an `I2V_SMOKE_LOCK_PATH` env var. This is what
    makes the test-only-lock path above possible.

### Documentation

- `README.md`: status block updated to recommend
  `v0.2.1-alpha`; new "Releases" section listing both tags
  with links to their respective release notes.
- `docs/PHASE_K_RELEASE_AND_DEPLOYMENT_READINESS_REPORT.md`:
  pre-existing, now historical (Phase K discovered the
  deviation that Phase L fixed).
- `docs/PHASE_L_CHECK_API_LOCK_ALIGNMENT_REPORT.md` (new in
  v0.2.1-alpha): the authoritative report on the lock fix
  and the helper-API contract.
- `docs/RELEASE_NOTES_v0.2.1-alpha.md` (this file).

### Check counts

- `v0.2.0-alpha`: `check:api` 68/71 PASS (3 known FAILs).
- `v0.2.1-alpha`: `check:api` 72/72 PASS (1 new test added;
  3 previously-FAILing tests now PASS; 0 FAILs).

### Sticky I2V lock

- `v0.2.0-alpha`: `npm run check:api` would **delete** the
  real once-only lock (test-affordance side effect).
- `v0.2.1-alpha`: `npm run check:api` is byte-for-byte
  non-destructive on the real once-only lock. A new check
  explicitly asserts this.

---

## What works (unchanged from v0.2.0-alpha)

- Text-to-video (`POST /api/video/create`, `mode=text_to_video`).
- Image-to-video (`POST /api/video/create`,
  `mode=image_to_video`) with first-frame image input.
- Polling guardrails — `maxAttempts=60`,
  `maxDurationMinutes=20`, `initialIntervalMs=10000`,
  `maxIntervalMs=30000`.
- Manual `Refresh task status` and `Refresh download link`
  buttons (the latter re-queries MiniMax for the current
  `download_url` without consuming additional generation
  quota).
- Soft download-link freshness indicators: `fresh` / `aging` /
  `stale` / `absent` / `unknown`.
- Per-task error categorization (`error_category` /
  `error_severity` / `error_user_message` /
  `error_suggested_action` / `error_can_retry` /
  `error_retry_hint`).
- Task history: filter by `status`, keyword search, pagination
  (`limit` / `offset`), time-grouped rendering (Today /
  Yesterday / Earlier), and copy-prompt / copy-params /
  fill-form affordances.
- SQLite-backed local task store.
- `npm run check:api` offline regression: `72/72 PASS`.
- `npm run check:minimax-auth` auth-only probe against
  `https://www.minimaxi.com/v1/token_plan/remains`. Does
  **not** call `/v1/video_generation` and consumes **no**
  video quota.
- I2V fixture: 1024×768 RGBA PNG generated by
  `scripts/generate-i2v-fixture.js`, validated 10/10 PASS by
  `scripts/validate-i2v-fixture.js`.

---

## Known limits (carried over, not regressed)

1. **No public reverse proxy / HTTPS layer.** The Tencent
   Cloud runbook ships a systemd unit and a local
   health-check only. Fronting the service with Nginx / Caddy
   + Let's Encrypt is a future phase (probably "Phase N") and
   is **not** in v0.2.1-alpha.
2. **SQLite is operator-local.** It is not replicated, not
   backed up by the project, and not designed for multi-host
   concurrency.
3. **No multi-user auth.** A single `SITE_PASSCODE` gates the
   web UI; there is no per-user identity, no session, no
   RBAC. This is a personal-MVP, not a multi-tenant product.
4. **No subject reference / first-last-frame conditioning.**
   The canonical T2V + I2V MVP is the only generation mode
   in scope.
5. **Real submits have happened and quota has been consumed.**
   T2V: 1 task. I2V: 1 task. Both were operator-authorized
   and single-shot. Any further real smoke will consume
   additional quota.
6. **The once-only lock is enforced by the smoke script
   only.** A motivated operator can still bypass it by
   hand-editing the smoke script or by calling the MiniMax
   API directly with the same key. The lock is a guardrail,
   not a wall.
7. **Test affordance contract:** future PRs that touch
   `check:api` or `smoke-image-to-video.js` must use the
   `snapshotLockState` / `restoreLockState` /
   `assertLockUnchanged` helpers (and the
   `I2V_SMOKE_LOCK_PATH` env var) for any lock-related
   test fixture, **not** `fs.unlinkSync(realLockPath)` or
   `fs.writeFileSync(realLockPath, ...)`. The new
   `assertLockUnchanged` checks in `check:api` will fail
   loudly if this contract is broken.

---

## Safety controls (unchanged from v0.2.0-alpha, plus the
lock contract)

- **Smoke dry-run by default.** `npm run smoke:video` and
  `npm run smoke:i2v` never call `POST /v1/video_generation`
  unless the operator sets `CONFIRM_REAL_VIDEO=1` (and
  `CONFIRM_REAL_I2V=1` for I2V).
- **Once-only local lock.** A real I2V submit drops
  `reports/local/i2v-real-smoke.lock`. The smoke script
  refuses to submit again if the lock exists. (This lock is
  a **sticky safety artifact**: `npm run check:api` will
  not touch it. See "Test affordance contract" above.)
- **Offline fixture validation.** Real I2V submits run
  `npm run fixture:i2v:validate` first; the smoke script
  aborts on any fixture check failure.
- **Redacted public docs.** No public report or commit
  includes full `task_id` / `file_id` / `download_url` /
  image URL / `data:image/...;base64,...` /
  `MINIMAX_API_KEY` / `Authorization` header /
  `SITE_PASSCODE`. Full values live only in gitignored
  `reports/local/*` files.
- **No new external surface.** No new dependencies beyond
  the Phase J.3 devDeps (`pngjs` is the only Phase J-era
  devDependency), no new HTTP endpoints, no new auth
  surface.
- **Test affordance isolation.** `npm run check:api` uses a
  dedicated test-only lock path
  (`reports/local/i2v-real-smoke.test.lock`) so its
  internal sub-tests cannot affect the real safety
  artifact.

---

## Deployment baseline

If you are deploying for the first time, use `v0.2.1-alpha`:

```bash
git clone https://github.com/conanxin/minimax-video-studio.git
cd minimax-video-studio
git checkout v0.2.1-alpha
cp .env.example .env
chmod 600 .env
$EDITOR .env          # fill MINIMAX_API_KEY + SITE_PASSCODE
npm install
npm run build
npm run start
curl http://localhost:8789/api/health
```

Follow the full step-by-step at
[`docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md`](TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md).
The runbook is unchanged from v0.2.0-alpha and works
identically for v0.2.1-alpha.

If you are upgrading from v0.2.0-alpha:

```bash
cd minimax-video-studio
git fetch --tags origin
git checkout v0.2.1-alpha
npm install
npm run build
# Restart your process manager (systemd / nohup / tmux / etc.)
curl http://localhost:8789/api/health
npm run check:api     # expect: 72/72 PASS
```

Schema compatibility: the local SQLite store from
v0.2.0-alpha is forward-compatible with v0.2.1-alpha. The
`reports/local/i2v-real-smoke.lock` is per-machine and
survives across both releases. If you want a future real
I2V smoke on this CVM, delete the lock file by hand after
reading the sticky-lock contract above.

---

## Verifying this release without consuming quota

```bash
git checkout v0.2.1-alpha
npm install
npm run fixture:i2v:validate   # expect: 10/10 PASS
npm run build                  # expect: vite build OK
npm run smoke:video            # expect: dry-run, real_quota_consumed: No
npm run smoke:i2v              # expect: dry_run_ok, fixture_validation: PASS
npm run check:api              # expect: 72/72 PASS
npm run check:minimax-auth     # expect: auth_ok: yes
```

None of the above calls `/v1/video_generation` and none
consumes video quota.

---

## Next steps (suggested, not committed)

- **Phase N** (not yet authored): actual deployment to a
  Tencent Cloud CVM. The Phase K runbook is a recipe; Phase N
  would be the operator-confirmed deployment + health-check
  + rollback rehearsal. Out of scope for v0.2.1-alpha.
- A future phase for **Nginx / Caddy + Let's Encrypt reverse
  proxy** if the operator decides to expose the service
  beyond `localhost`. Out of scope for v0.2.1-alpha.
- A future phase for **Docker packaging + CI/CD**, only if
  the operator wants them. Out of scope for v0.2.1-alpha.
- A future controlled real smoke (T2V or I2V) **must** be
  authorized per-phase and **must** follow the same
  Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7
  pattern used in Phase J.4.
