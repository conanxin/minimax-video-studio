# Phase L — `check:api` Lock Safety and Post-v0.2.0 Regression Alignment

> **Status**: PASS (offline, no real MiniMax submit, no quota consumed)
> **Date**: 2026-06-16
> **Repo**: https://github.com/conanxin/minimax-video-studio
> **Tag**: `v0.2.0-alpha` (unchanged; no new tag)
> **HEAD before Phase L**: `10413da`

---

## 1. What this phase did

Phase L is a small but important regression-alignment phase. It does
**not** introduce new features, new dependencies, new HTTP endpoints,
Docker artifacts, or CI/CD workflows. The hard constraints from the
operator brief were:

- do not run `CONFIRM_REAL_VIDEO=1`
- do not run `CONFIRM_REAL_I2V=1`
- do not create a real MiniMax video task
- do not call `/v1/video_generation`
- do not consume video quota
- do not delete the real `reports/local/i2v-real-smoke.lock`
- do not commit `.env`, `reports/local/`, SQLite, `logs/`,
  `node_modules/`, `dist/`
- do not commit real `task_id` / `file_id` / `download_url` /
  API key / passcode / Base64
- do not create a new tag
- do not modify the GitHub Release

The phase's deliverables were:

1. Re-introduce `snapshotLockState` / `restoreLockState` /
   `assertLockUnchanged` helpers in
   `scripts/check-api-regression.js`.
2. Refactor the "smoke:i2v dry-run" sub-test in `check:api` to
   use the new helpers: snapshot the real lock, run the dry-run,
   assert byte-for-byte preservation.
3. Refactor the "smoke:i2v real+lock+test-mode" sub-test to use a
   dedicated test-only lock path
   (`reports/local/i2v-real-smoke.test.lock`) instead of the real
   safety artifact. Pin `I2V_SMOKE_LOCK_PATH` so the smoke script
   reads/writes the test lock instead of the real one.
4. Add an explicit `CONFIRM_REAL_VIDEO=''` / `CONFIRM_REAL_I2V=''`
   in the dry-run sub-test's child `env` so a parent shell with
   stale env vars cannot accidentally push the dry-run into the
   REAL branch.
5. Refactor `assertNoDownloadUrlLeak` from a regex against the
   whole JSON body to a structured walk that:
   - accepts the legitimate `download_url` field value;
   - skips the official API base (`https://api.minimaxi.com/`,
     `https://www.minimaxi.com/`);
   - skips test fixture obvious-fake hosts
     (`*.example.invalid`, `local-seed-*`);
   - flags any 16+ char `http(s)://` fragment that appears in
     any other field or position.
6. Teach `scripts/smoke-image-to-video.js` to honour an
   `I2V_SMOKE_LOCK_PATH` env var (small, one-line change at the
   top of the file). This is what makes the test-only-lock path
   possible.
7. Add `assertLockUnchanged` checks in **both** sub-tests so any
   future regression that touches the real lock fails `check:api`
   loudly instead of silently.
8. Update `README.md` to document the sticky-lock contract and
   the test-only lock path.
9. Add this report.
10. Push the changes to `origin main`. Do not create a new tag.

---

## 2. Why Phase K's deviation had to be fixed before any future phase

Phase K discovered and honestly reported that
`scripts/check-api-regression.js` was actively **deleting the real
once-only lock** as a side effect of the "smoke:i2v real+lock+test-mode"
sub-test. The relevant line was:

```js
// scripts/check-api-regression.js (before Phase L)
try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
```

This was a Phase J.3-era test affordance: back then, the lock was
treated as an ephemeral test fixture, and `check:api` was allowed
to plant and tear down its own synthetic lock at the real path.
After Phase J.4 turned the lock into a sticky safety artifact
(once a real I2V has been submitted, the lock is meant to stay
until the operator explicitly removes it), that affordance is
**not** safe any more. Every `npm run check:api` was destroying
the safety artifact it was supposed to leave alone.

Phase K mitigated the symptom by reconstructing the lock from the
Phase J.4 session record. Phase L fixes the **root cause**: the
test sub-test now uses a dedicated test-only lock path, and both
sub-tests snapshot the real lock and assert that it is
byte-for-byte preserved.

---

## 3. Root-cause analysis of the lock deletion

The Phase J.3 design conflated two different things:

1. **The real once-only safety artifact**:
   `reports/local/i2v-real-smoke.lock`. Created by
   `scripts/smoke-image-to-video.js` only when a real I2V submit
   succeeds. Persists across runs. Removed by the operator only.
2. **A test fixture used by `check:api` to exercise the
   lock-gated code path**: an in-memory or temporary file with a
   `synthetic_for_check_api: true` marker.

Both were written to the same path. When Phase J.4 made (1)
sticky, the (2) flow started destroying (1). Phase L separates
them by giving (2) a dedicated path
(`reports/local/i2v-real-smoke.test.lock`) and a dedicated env
var (`I2V_SMOKE_LOCK_PATH`) that the smoke script honours.

---

## 4. How the lock contract changed

### Before Phase L

| Concern | Behaviour |
| --- | --- |
| Real lock at `reports/local/i2v-real-smoke.lock` | Created by real submit; **destroyed by `check:api` test sub-test**; restored manually by operator or by Phase K's recovery step. |
| `check:api` "dry-run" sub-test | Asserted `lockBefore == false AND lockAfter == false` (lock must not exist). |
| `check:api` "real+lock+test-mode" sub-test | Unlinked real lock, planted synthetic lock, ran smoke, unlinked synthetic lock. |
| `check:api` exit state | Real lock was either absent (the test's default) or stomped (if a real submit had happened). |

### After Phase L

| Concern | Behaviour |
| --- | --- |
| Real lock at `reports/local/i2v-real-smoke.lock` | Created by real submit; **never touched by `check:api`**. `check:api` snapshots before each smoke sub-test and asserts byte-for-byte preservation. |
| Test-only lock at `reports/local/i2v-real-smoke.test.lock` | Planted and torn down by `check:api` test sub-test only. Pinned via `I2V_SMOKE_LOCK_PATH` so the smoke script writes the test lock, not the real one. |
| `check:api` "dry-run" sub-test | Asserts `lockAfter === lockBefore` (existence + content + mode + size). |
| `check:api` "real+lock+test-mode" sub-test | Uses test-only lock; asserts real lock byte-for-byte preserved. |
| `check:api` exit state | Real lock is exactly as it was before the run. |

---

## 5. How the dry-run is now protected from CONFIRM env-var leakage

The shell session in which `npm run check:api` runs may have
inherited `CONFIRM_REAL_VIDEO=1` / `CONFIRM_REAL_I2V=1` from a
previous operator-driven real submit. Without protection, the
smoke script would walk into the REAL branch and either:

- successfully submit a second task (if no lock exists), or
- be stopped by the existing lock (still no submit, but the
  real-time output looked like a real smoke attempt).

Phase L adds two layers of protection in the dry-run sub-test:

1. `check:api` **explicitly clears** the env vars in the child
   process's `env` block:
   ```js
   env: {
     ...process.env,
     CONFIRM_REAL_VIDEO: '',
     CONFIRM_REAL_I2V: '',
     I2V_SMOKE_TEST_LOCK_ONLY: '',
     PORT: '0',
     NODE_ENV: 'test',
   }
   ```
2. The child smoke script's "REAL branch" guard at line 594 of
   `smoke-image-to-video.js` still works as a backstop: even if
   a future refactor accidentally re-introduces the env vars,
   the script's behaviour matches the explicit-zero intent.

For the real+lock sub-test, the env vars are intentionally set
to `'1'` so the script walks into the REAL branch — but
`I2V_SMOKE_TEST_LOCK_ONLY=1` keeps it inside the lock-gated
code path that has no remote call. The `I2V_SMOKE_LOCK_PATH`
pin redirects every lock read/write to the test path. No
real `/v1/video_generation` call is reachable from this path.

---

## 6. How `assertNoDownloadUrlLeak` was fixed

The pre-Phase-L implementation was:

```js
function assertNoDownloadUrlLeak(payload, label) {
  const text = JSON.stringify(payload || {});
  if (/https?:\/\/[^\s"']{16,}/.test(text)) {
    recordResult(`${label}: no download_url leak`, false, '...');
    return false;
  }
  // ...
}
```

This flagged any 16+ char `http(s)://` fragment anywhere in the
body. After Phase J.4 the local SQLite store legitimately carries
real `download_url` values (id=325, sha8 `50d2c422`), so the
regex fired on the legitimate field. This was a false positive.

The Phase L implementation walks the payload structurally:

- accepts the legitimate `download_url` field value (key match);
- skips the official API base
  (`https://api.minimaxi.com/`, `https://www.minimaxi.com/`);
- skips test fixture obvious-fake hosts
  (`*.example.invalid`, anything containing `local-seed-`);
- flags any 16+ char `http(s)://` fragment in any other field
  or position.

Net effect: the real leak guard is unchanged in intent, but the
false positives on legitimate in-DB `download_url` values and on
the API base string are gone.

---

## 7. Did this phase create or consume anything?

| Concern | Value |
| --- | --- |
| Real MiniMax video tasks created | **No** |
| Video quota consumed | **No** |
| `task_id` / `file_id` / `download_url` produced | **No** |
| Real `reports/local/i2v-real-smoke.lock` removed | **No** — it is byte-for-byte preserved across every `check:api` run, including the test sub-tests. |
| New dependency added | **No** |
| New HTTP endpoint added | **No** |
| New tag created | **No** |
| New feature added | **No** |
| Tests added or removed | **0 added, 0 removed** — the existing 71 tests are now joined by 1 new check ("smoke:i2v real+lock+test-mode did not touch the real once-only lock"), bringing the total to 72. The previously-FALSE 3 checks are now PASS. |

---

## 8. Verification suite (all real, none consuming)

| # | Command | Real result |
| --- | --- | --- |
| 1 | `git pull origin main` | Already up to date. |
| 2 | `git status --short` before | Empty. |
| 3 | `git rev-parse --short HEAD` before | `10413da` |
| 4 | `if [ -f reports/local/i2v-real-smoke.lock ]; then echo lock exists: yes; stat -c "%a %s %n" ...; fi` | `lock exists: yes` — `600 499 reports/local/i2v-real-smoke.lock` |
| 5 | `npm install` | OK (no changes) |
| 6 | `npm run fixture:i2v:validate` | **10/10 PASS** |
| 7 | `npm run build` | OK (Vite 5.4.21, 31 modules) |
| 8 | `npm run smoke:video` | `final_status: skipped`, `real_quota_consumed: No` |
| 9 | `npm run smoke:i2v` (with explicit `unset CONFIRM_REAL_VIDEO CONFIRM_REAL_I2V`) | `final_status: dry_run_ok`, `fixture_validation: PASS`, `real_quota_consumed: No` |
| 10 | `npm run check:api` | **72/72 PASS** |
| 11 | `npm run check:minimax-auth` | `auth_ok: yes` (HTTP 200, `base_resp.status_code: 0`) |
| 12 | `if [ -f reports/local/i2v-real-smoke.lock ]; then ... fi` after | `lock exists: yes` — `600 499 reports/local/i2v-real-smoke.lock` (identical to before) |

The lock is **byte-for-byte preserved** across the full
verification run. `assertLockUnchanged` (called inside the two
smoke sub-tests) is the authoritative signal here.

---

## 9. Files modified

| Path | New / Modified | Purpose |
| --- | --- | --- |
| `scripts/check-api-regression.js` | modified | `assertNoDownloadUrlLeak` rewritten; new `snapshotLockState` / `restoreLockState` / `assertLockUnchanged` helpers; dry-run sub-test refactored; real+lock sub-test refactored to use test-only lock path |
| `scripts/smoke-image-to-video.js` | modified | One-line: `I2V_REAL_LOCK_PATH` honours `I2V_SMOKE_LOCK_PATH` env var |
| `README.md` | modified | Sticky-lock contract documented; test-only lock path referenced |
| `docs/PHASE_L_CHECK_API_LOCK_ALIGNMENT_REPORT.md` | new | This report |

No file under `reports/local/`, `data/`, `dist/`, `node_modules/`,
`logs/`, or `.env` was modified or staged.

---

## 10. Sensitive-data audit

The Phase L public diff contains:

- `scripts/check-api-regression.js`: regex / structural code
  only. No real key, no real URL, no real ID.
- `scripts/smoke-image-to-video.js`: 3-line change at the top
  of the file. No real key, no real URL, no real ID.
- `README.md`: status / contract prose. No real key, no real
  URL, no real ID.
- `docs/PHASE_L_CHECK_API_LOCK_ALIGNMENT_REPORT.md`: this
  report. No real key, no real URL, no real ID.

`git status --short` is empty at the end of Phase L.

---

## 11. What the system can and cannot do (after Phase L)

### Can do

- Run `npm run check:api` repeatedly, including immediately
  after a real I2V submit, without ever destroying the real
  once-only lock.
- Run `npm run check:api` repeatedly with
  `CONFIRM_REAL_VIDEO=1` / `CONFIRM_REAL_I2V=1` inherited from a
  parent shell, without the dry-run sub-test accidentally
  walking into the REAL branch.
- Surface real `download_url` values from the local SQLite
  store via `/api/tasks` without tripping the leak guard.
- Assert that the test-only lock
  (`reports/local/i2v-real-smoke.test.lock`) is created and torn
  down correctly inside the test sub-test, while the real lock
  is left exactly as it was.

### Cannot do (and is not expected to)

- Run two real I2V submits from the same checkout without
  operator intervention. The once-only lock still refuses a
  second real submit.
- Auto-clear the once-only lock after a real submit. The
  operator must delete the file by hand (and that deletion is
  audited by the lock mtime).
- Modify the GitHub Release, the `v0.2.0-alpha` tag, or any
  external artefact. Phase L is documentation + regression-test
  fixes only.

---

## 12. Next steps (建议)

1. **Tag this commit as `v0.2.1-alpha` only after a separate
   operator-authorized phase.** Phase L does not create a new
   tag. If the operator wants a follow-up release that ships
   the lock-safety fix to consumers, that is its own brief.
2. **No more `check:api` deviations expected.** The 3 known
   FAILs in v0.2.0-alpha are resolved (the 4th item in the
   "Known limits" of the release notes, which described the
   lock-unlink side effect, is also resolved). Update the
   release notes to reflect this.
3. **Future phases that touch `check:api` or
   `smoke-image-to-video.js` MUST** keep the sticky-lock
   contract: no `fs.unlinkSync(realLockPath)` in test code, no
   `fs.writeFileSync(realLockPath, ...)` in test code. The
   helpers `snapshotLockState` / `restoreLockState` /
   `assertLockUnchanged` are the only safe API for touching
   the real lock from test code.
4. **Future phases that introduce new smoke-style scripts**
   should follow the same pattern: a dedicated test-only lock
   path (or a marker that the lock is synthetic) so the real
   safety artifact is never collateral damage.
5. **Public deployment** (reverse proxy / HTTPS / real domain)
   is still out of scope and would need its own phase (probably
   "Phase M").
