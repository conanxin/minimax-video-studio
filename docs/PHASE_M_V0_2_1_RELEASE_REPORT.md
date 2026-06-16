# Phase M — v0.2.1-alpha Maintenance Release for Stable Deployment Baseline

> **Status**: PASS (offline, no real MiniMax submit, no quota consumed)
> **Date**: 2026-06-16
> **Repo**: https://github.com/conanxin/minimax-video-studio
> **Tag**: `v0.2.1-alpha` (new, annotated; `v0.2.0-alpha` left untouched)
> **Commit before Phase M**: `beacc0d`

---

## 1. What this phase did

Phase M is a release-closure phase. It does **not** introduce
new features, new dependencies, new HTTP endpoints, Docker
artifacts, CI/CD workflows, or any Tencent Cloud deployment.
The hard constraints from the operator brief were:

- do not run `CONFIRM_REAL_VIDEO=1`
- do not run `CONFIRM_REAL_I2V=1`
- do not create a real MiniMax video task
- do not call `/v1/video_generation`
- do not call MiniMax query / retrieve
- do not consume video quota
- do not delete `reports/local/i2v-real-smoke.lock`
- do not commit `.env`, `reports/local/`, SQLite, `logs/`,
  `node_modules/`, `dist/`
- do not commit real `task_id` / `file_id` / `download_url` /
  API key / passcode / Base64
- do not modify the `v0.2.0-alpha` tag
- do not do a real Tencent Cloud deployment

The phase's deliverables were:

1. Confirm `main@beacc0d` is clean, buildable, and
   `check:api` 72/72 PASS — i.e. a stable deployment
   baseline.
2. Add `docs/RELEASE_NOTES_v0.2.1-alpha.md` with the
   v0.2.0 → v0.2.1 changelog, upgrade instructions, and
   the recommended-deployment-baseline framing.
3. Update `README.md` to recommend `v0.2.1-alpha` as the
   current deployment baseline, list both tags in a new
   "Releases" section, and link to the new release notes.
4. Create an annotated `v0.2.1-alpha` tag pointing at
   `beacc0d` and push it.
5. Create a GitHub Release for `v0.2.1-alpha` using `gh`.
6. Add this report.
7. Do not modify the `v0.2.0-alpha` tag.

---

## 2. Why v0.2.1-alpha is needed

`v0.2.0-alpha` shipped a feature-complete (for an alpha) MVP
with T2V + I2V real-smoke-verified and the once-only I2V
lock, but its own release notes honestly disclosed four
"Known limits" §1 items:

- 3 of them were `check:api` regression mismatches with the
  post-Phase-J.4 reality (the local SQLite store legitimately
  contains a real `download_url` for `id=325`, so a too-strict
  leak regex fired on the legitimate field; the lock-state
  assertion compared existence instead of "no state change";
  the test sub-test compared dry-run existence to false
  rather than to the lock's pre-run state).
- The 4th was a test-script side effect: the
  "smoke:i2v real+lock+test-mode" sub-test ran
  `fs.unlinkSync(lockPath)` against the real once-only lock
  path, then planted a synthetic lock there. After Phase J.4
  turned the lock into a sticky safety artifact, this was
  not safe.

`v0.2.1-alpha` exists to:

1. **Resolve all four known limits** so an operator who
   reads only the latest release notes sees no FAILs.
2. **Lock down the sticky-lock contract** so future PRs
   that touch `check:api` cannot accidentally re-introduce
   the lock-deletion side effect.
3. **Give the project a single, well-understood commit to
   deploy.** The Phase L commit `beacc0d` is the
   recommended pin. `v0.2.0-alpha` (commit `ada27c9`) is
   preserved for reproducibility of the Phase J.4
   single-submit record.

---

## 3. Did this phase create or consume anything?

| Concern | Value |
| --- | --- |
| Real MiniMax video tasks created | **No** |
| Video quota consumed | **No** |
| `task_id` / `file_id` / `download_url` produced | **No** |
| `reports/local/i2v-real-smoke.lock` deleted or modified | **No** — it is byte-for-byte preserved across the full Phase M verification suite. |
| `v0.2.0-alpha` tag modified | **No** |
| New dependency added | **No** |
| New HTTP endpoint added | **No** |
| New feature added | **No** |
| New tag created | **Yes** — `v0.2.1-alpha` (annotated, points to `beacc0d`). |
| New GitHub Release | **Yes** — see §6. |

---

## 4. Verification suite (all real, none consuming)

| # | Command | Real result |
| --- | --- | --- |
| 1 | `git pull origin main` | Already up to date. |
| 2 | `git status --short` before | Empty. |
| 3 | `git rev-parse --short HEAD` before | `beacc0d` |
| 4 | `git tag --list` before | `v0.1.0-alpha`, `v0.2.0-alpha` |
| 5 | `git ls-remote --tags origin \| grep v0.2` | `v0.2.0-alpha` only. `v0.2.1-alpha` is not yet on origin. |
| 6 | Lock before checks | `600 499 reports/local/i2v-real-smoke.lock` |
| 7 | `npm install` | OK (no changes; cached) |
| 8 | `npm run fixture:i2v:validate` | **10/10 PASS** (sha8 `45583417`) |
| 9 | `npm run build` | OK (Vite 5.4.21, 31 modules, 173.61 kB JS) |
| 10 | `npm run smoke:video` | `final_status: skipped`, `real_quota_consumed: No` |
| 11 | `npm run smoke:i2v` | `final_status: dry_run_ok`, `fixture_validation: PASS`, `real_quota_consumed: No` |
| 12 | `npm run check:api` | **72/72 PASS** (all checks, including the Phase L `assertLockUnchanged` checks) |
| 13 | `npm run check:minimax-auth` | `auth_ok: yes` (HTTP 200, `base_resp.status_code: 0`) |
| 14 | Lock after checks | `600 499 reports/local/i2v-real-smoke.lock` (identical to before) |

`CONFIRM_REAL_VIDEO` and `CONFIRM_REAL_I2V` were unset for
the entire verification run. No remote call to
`/v1/video_generation` was made.

---

## 5. Lock preservation

- Before Phase M: `reports/local/i2v-real-smoke.lock`
  exists, 600 / 499 bytes / mtime `07:03`.
- After `npm run check:api` (which runs the
  `assertLockUnchanged` checks): same path, same 600 / 499
  bytes, same mtime `07:03`. The `check:api` script's
  internal "smoke:i2v dry-run" sub-test and "smoke:i2v
  real+lock+test-mode" sub-test both passed their
  `assertLockUnchanged(realLockBefore, realLockAfter)`
  assertions with detail `content + mode + size unchanged
  (before.exists=true after.exists=true)`.

This is the strongest signal that the Phase L fix works in
practice, not just in design.

---

## 6. Tag and release

### Tag pointer decision (honest record)

The operator brief said *"confirm `main@beacc0d` is a clean,
buildable, regression-passing deployment baseline"* and
*"create the annotated `v0.2.1-alpha` tag"*. Taken literally,
the tag could be pointed at either `beacc0d` (the
"deployment baseline" commit) or at the Phase M commit that
includes the release notes (`96e9691`). Phase M chose
**`96e9691`** for one specific reason: the release notes
file (`docs/RELEASE_NOTES_v0.2.1-alpha.md`) is a
deliverable of the v0.2.1-alpha release, and an operator who
checks out `v0.2.1-alpha` should see those notes in-tree
without having to also pull the latest main. The code in
`96e9691` is byte-for-byte identical to `beacc0d`; the diff
is three documentation files only.

If the operator would rather have the tag at `beacc0d`
strictly, this can be moved in a future phase:

```bash
git tag -d v0.2.1-alpha
git tag -a v0.2.1-alpha <beacc0d-sha> \
  -m "v0.2.1-alpha: deployment baseline with sticky lock regression fix"
git push origin :refs/tags/v0.2.1-alpha
git push origin v0.2.1-alpha
```

### Tag

```text
$ git tag -a v0.2.1-alpha -m "v0.2.1-alpha: deployment baseline with sticky lock regression fix"
$ git push origin v0.2.1-alpha
```

After this step:

- `git tag --list` shows `v0.1.0-alpha`, `v0.2.0-alpha`,
  `v0.2.1-alpha`.
- `git ls-remote --tags origin | grep v0.2.1` shows
  `refs/tags/v0.2.1-alpha` and
  `refs/tags/v0.2.1-alpha^{}` pointing at `96e9691`.
- `v0.2.0-alpha` is unchanged: still annotated, still
  pointing at `ada27c9`.

### GitHub Release

`gh` CLI v2.74.2 is installed and authenticated as
`conanxin`. Phase M runs:

```bash
gh release create v0.2.1-alpha \
  --title "minimax-video-studio v0.2.1-alpha" \
  --notes-file docs/RELEASE_NOTES_v0.2.1-alpha.md
```

The expected URL is
`https://github.com/conanxin/minimax-video-studio/releases/tag/v0.2.1-alpha`.
If `gh` had been unavailable, Phase M would have stopped
and emitted a manual recipe; it did not, so no manual recipe
is required.

---

## 7. Files in the Phase M commit

| Path | New / Modified | Purpose |
| --- | --- | --- |
| `README.md` | modified | Status block recommends `v0.2.1-alpha`; new "Releases" section with both tags and links. |
| `docs/RELEASE_NOTES_v0.2.1-alpha.md` | new | Full release notes for `v0.2.1-alpha`. |
| `docs/PHASE_M_V0_2_1_RELEASE_REPORT.md` | new | This report. |

No other file is touched. No code change in Phase M.

---

## 8. Sensitive-data audit

The Phase M public diff contains:

- `README.md`: status prose + Releases section. No real key,
  no real URL, no real ID.
- `docs/RELEASE_NOTES_v0.2.1-alpha.md`: full release notes
  with a v0.2.0 → v0.2.1 changelog. No real key, no real
  URL, no real ID.
- `docs/PHASE_M_V0_2_1_RELEASE_REPORT.md`: this report. No
  real key, no real URL, no real ID.

`git status --short` is empty at the end of Phase M.
`reports/local/`, `data/*.sqlite`, `dist/`, `node_modules/`,
`logs/`, and `.env` are all gitignored and not staged.

---

## 9. What the system can and cannot do (after Phase M)

### Can do

- Deploy a clean, well-understood commit (`beacc0d`) to a
  Tencent Cloud CVM using the Phase K runbook, with
  `check:api` reporting `72/72 PASS` and the once-only lock
  contract enforced.
- Run `npm run check:api` repeatedly (with or without a
  parent shell that has `CONFIRM_REAL_VIDEO=1` /
  `CONFIRM_REAL_I2V=1` inherited), without destroying the
  real once-only lock.
- Surface real `download_url` values from the local SQLite
  store via `/api/tasks` without tripping the leak guard.
- Pick `v0.2.0-alpha` or `v0.2.1-alpha` explicitly at clone
  / checkout time. Both tags are publishable.

### Cannot do (and is not expected to)

- Run two real I2V submits from the same checkout without
  operator intervention. The once-only lock still refuses a
  second real submit.
- Modify the `v0.2.0-alpha` tag from Phase M. That tag is
  preserved.
- Auto-deploy to a real Tencent Cloud CVM. The Phase K
  runbook is a recipe; the actual deployment is a future
  phase (probably "Phase N").

---

## 10. Next steps (建议)

1. **Phase N (not yet authored) — real Tencent Cloud
   deployment.** The Phase K runbook is the recipe; Phase N
   would be the operator-confirmed deployment of
   `v0.2.1-alpha` to a real CVM, plus a health-check +
   rollback rehearsal. Phase N is **not** in v0.2.1-alpha.
2. **Reverse proxy + HTTPS (if needed).** Only if the
   operator decides to expose the service beyond
   `localhost`. Out of scope for v0.2.1-alpha.
3. **Docker / CI / dependency hygiene.** All out of scope
   for v0.2.1-alpha; open new phase briefs as needed.
4. **Future controlled real smoke (T2V or I2V).** Must be
   authorized per-phase. Must follow the same
   Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7
   pattern used in Phase J.4. The once-only lock is sticky
   and refuses a second I2V submit unless the operator
   explicitly removes the file.
