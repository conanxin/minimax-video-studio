# Phase J.3 — I2V Smoke Harness Fix and Fixture Validation

> **Status:** PASS. This phase is a **purely offline** harness fix.
> No real MiniMax video task was created and no MiniMax video quota
> was consumed. The once-only local lock added in Phase J.2 is still
> in place and still honored.

## 1. What this phase did

This phase replaces the broken hand-written PNG encoder inside
`scripts/smoke-image-to-video.js` with a deterministic PNG fixture
that is produced and validated by two new helper scripts:

- `scripts/generate-i2v-fixture.js` — produces
  `test/fixtures/i2v-smoke-first-frame.png` (1024×768 RGBA, abstract
  gradient, no people, no text, no logos, no copyrighted content)
  using `pngjs` as a devDependency.
- `scripts/validate-i2v-fixture.js` — re-decodes the fixture and
  asserts: PNG magic, decoder success, width == 1024, height == 768,
  RGBA pixel buffer length == `width × height × 4`, file size ≤
  20 MB, short side ≥ 300 px, aspect ratio ∈ [0.40, 2.50], and
  MIME / extension agreement.

The smoke script `scripts/smoke-image-to-video.js` was rewritten to:

1. Remove the hand-written PNG chunk encoder
   (`buildMinimalPngDataUrl` + the private `crc32` helper).
2. Source `first_frame_image` from the validated fixture, building
   the `data:image/png;base64,...` URL from the fixture bytes at
   request time. The Data URL is **never** logged.
3. Run the fixture pre-flight in both the dry-run branch and the
   real-mode branch. Real-mode refuses to submit if the pre-flight
   fails (`refused_by_fixture`).
4. Continue to honor the Phase J.2 once-only local lock
   (`reports/local/i2v-real-smoke.lock`). Real-mode refuses to
   submit if the lock exists (`refused_by_lock`).
5. Add a test-only env var `I2V_SMOKE_TEST_LOCK_ONLY=1` that
   forces the real-mode code path through the fixture pre-flight
   and the lock pre-flight, and then exits. It is used by
   `npm run check:api` to exercise the lock gate without making
   any remote call.

`scripts/check-api-regression.js` was extended with 13 new offline
checks (regions 44–48):

| # | Check |
| --- | --- |
| 44 | `scripts/generate-i2v-fixture.js` exists |
| 44 | `scripts/validate-i2v-fixture.js` exists |
| 44 | `test/fixtures/i2v-smoke-first-frame.png` exists (size in bytes) |
| 45 | `smoke-image-to-video.js` does not include the hand-written PNG encoder |
| 45 | `smoke-image-to-video.js` does not include the hand-written PNG `crc32` helper |
| 45 | `smoke-image-to-video.js` sources `first_frame_image` from the fixture / pngjs |
| 46 | `npm run fixture:i2v:validate` exits 0 with `10/10 PASS` |
| 47 | `smoke:i2v` dry-run does not create the real-smoke lock |
| 47 | `smoke:i2v` dry-run logs `data_url_present=yes` |
| 47 | `smoke:i2v` dry-run does not echo a full Data URL |
| 48 | `smoke:i2v` real+lock+test-mode refuses via the once-only lock |
| 48 | `smoke:i2v` real+lock+test-mode did not call MiniMax |
| 48 | `smoke:i2v` real+lock+test-mode wrote a blocked-by-lock local report |

The total `check:api` count went from `58/58` to `71/71` with all
new checks PASS.

`package.json` gained two new script entries:

```json
"fixture:i2v:generate": "node scripts/generate-i2v-fixture.js",
"fixture:i2v:validate": "node scripts/validate-i2v-fixture.js"
```

`pngjs@7.0.0` was added as a `devDependency` and is the only new
dependency in this phase.

`README.md` was updated with a dedicated "I2V smoke harness
(Phase J.3)" section, including the fixture generator / validator /
dry-run / real-mode contract and the once-only lock behavior. The
"Current status" and "Phase J" sections were refreshed to reflect
the J.2 incident containment and the J.3 harness fix.

## 2. Why this phase exists

Phase J.2 created two real MiniMax I2V submits instead of the one
authorized. Both submits were accepted by MiniMax (real `task_id`
returned in both cases), and both failed at the local post-submit
stage with the same error envelope:

```
failReason: "png: invalid format: too much pixel data"
```

The root cause was a hand-written PNG encoder inside
`scripts/smoke-image-to-video.js::buildMinimalPngDataUrl` that
declared IHDR `width = 3`, `height = 2` but wrote an IDAT stream
of `height × (1 + baseW × 3)` rows × `baseW` pixels — i.e. the IDAT
payload contained `768` rows × `3` pixels × `3` bytes of pixel data,
but a strict PNG decoder interprets the IHDR-declared geometry as
`3` × `2` and rejects the extra data as `too much pixel data`.

Because the encoder was local, MiniMax never produced the standard
`base_resp.status_code: 1004` login-failure verdict; instead, the
service-side PNG decoder rejected the image *after* MiniMax had
already accepted the submit and reserved a generation slot. So
two submits were billed and zero useful work was produced.

This phase removes the broken encoder entirely, sources the
`first_frame_image` from a deterministic pngjs-generated fixture,
and adds an offline pre-flight validator that catches this class
of bug locally before any real submit is attempted.

## 3. New fixture strategy

The fixture is generated from scratch by
`scripts/generate-i2v-fixture.js` and committed to
`test/fixtures/i2v-smoke-first-frame.png`:

| Property | Value |
| --- | --- |
| Dimensions | 1024 × 768 (RGBA) |
| Color type | 6 (RGBA, 8-bit per channel) |
| File size | ≈ 378 KB (well below the 20 MB cap) |
| sha256[0:8] | `45583417` |
| Content | abstract two-band horizontal gradient with a soft diagonal sine modulation; **no** people, **no** text, **no** logos, **no** copyrighted material |
| Producer | `pngjs@7.0.0` via `PNG.sync.write` |
| Independent cross-check | PNG signature + IHDR fields re-parsed by an external Python script using only `struct` |

The fixture is reproducible: re-running
`npm run fixture:i2v:generate` overwrites the file with byte-identical
output because the generator uses pure deterministic pixel math.

## 4. Offline fixture validation

`npm run fixture:i2v:validate` is a self-contained 10-check pipeline
that re-decodes the fixture and refuses to PASS unless all of the
following are true:

| # | Check | Example |
| --- | --- | --- |
| 1 | fixture exists | `test/fixtures/i2v-smoke-first-frame.png (378549 bytes)` |
| 2 | PNG magic bytes | `0x89 0x50 0x4e 0x47 ... present` |
| 3 | `pngjs` decode | `decoded in-memory` |
| 4 | width == 1024 | `got=1024` |
| 5 | height == 768 | `got=768` |
| 6 | RGBA pixel buffer length | `expected=3145728 actual=3145728` |
| 7 | file size ≤ 20 MB | `bytes=378549 cap=20971520` |
| 8 | short side ≥ 300 px | `short_side=768` |
| 9 | aspect ratio ∈ [0.40, 2.50] | `aspect=1.333` |
| 10 | extension / MIME agreement | `ext=.png color_type=6` |

The validator exits 0 only on `10/10 PASS` and is invoked by:

- `npm run fixture:i2v:validate` — manual run by the operator.
- `npm run smoke:i2v` (dry-run) — inline, before any payload is
  built.
- `npm run smoke:i2v` (real-mode, before any submit) — inline.
- `npm run check:api` region 46 — exit-code only.

## 5. Smoke harness pre-flight guards

Real-mode (`CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1 npm run smoke:i2v`)
refuses to submit if any of the following are true:

1. Fixture pre-flight fails → `refused_by_fixture`, exit 0, no
   `task_id` returned, no remote call made.
2. `reports/local/i2v-real-smoke.lock` is present → `refused_by_lock`,
   exit 0, no `task_id` returned, no remote call made.

Both refusals write a local-only markdown breadcrumb under
`reports/local/` (gitignored):

- `reports/local/i2v-smoke-blocked-by-fixture.local.md`
- `reports/local/i2v-smoke-blocked-by-lock.local.md`

These breadcrumbs explain how to re-authorize (regenerate the
fixture / delete the lock) but do **not** themselves count as
evidence that the submit happened.

## 6. Once-only local lock (Phase J.2 still in force)

The lock contract is unchanged from Phase J.2:

- `reports/local/i2v-real-smoke.lock` is written by the smoke
  harness after a real submit attempt (success or failure).
- A subsequent real-mode run that finds the lock present exits
  with `refused_by_lock` and **never** enters the network call
  path.
- The lock carries `created_at`, `finished_at`, masked
  `task_id_masked`, `final_status`, and `fail_reason_kind`. It
  never carries the raw `task_id`, the raw `Authorization`
  header, the raw `MINIMAX_API_KEY`, or any base64 image content.
- The lock can only be re-authorized by **explicit operator
  action**: deleting the file. There is no CLI flag and no env
  var that bypasses the lock.

## 7. Test-mode path for `check:api`

`scripts/check-api-regression.js` region 48 exercises the
real-mode lock gate **without** making any remote call by setting
all three of:

- `CONFIRM_REAL_VIDEO=1`
- `CONFIRM_REAL_I2V=1`
- `I2V_SMOKE_TEST_LOCK_ONLY=1`

With these flags, the smoke script:

1. Runs the fixture pre-flight (region 46 covers this separately).
2. Reads the lock file. If present, exits with `refused_by_lock`
   and writes the `i2v-smoke-blocked-by-lock.local.md` breadcrumb.
3. **Never** enters `runRealI2VSmoke`. **Never** calls
   `createImageToVideo`. **Never** calls MiniMax.

The check plants a synthetic lock file (with
`synthetic_for_check_api: true`) before invoking the script, and
deletes it on the way out so the next operator run is not blocked.

## 8. Sensitive-information audit

| Item | In this report | In committed code | In committed fixture |
| --- | --- | --- | --- |
| Real `MINIMAX_API_KEY` | No | No | No |
| Real `SITE_PASSCODE` | No | No | No |
| Real `Authorization` header | No | No | No |
| Real `task_id` from this phase | None created | None created | N/A |
| Real `file_id` | None created | None created | N/A |
| Real `download_url` | None created | None created | N/A |
| Real image URL | None created | None created | N/A |
| Base64 image content | No | No | No (only the abstract gradient fixture is committed; its bytes are not logged) |
| Real server IP / domain | No | No | N/A |
| Lock file contents | None | None | N/A (gitignored) |
| Fixture bytes / sha256 | Only sha256[0:8] | None logged | The bytes themselves, but the fixture is abstract gradient by design |

The fixture is committed because it is a deterministic abstract
gradient with no people, no text, no logos, no copyrighted
material, and a sha256[0:8] of `45583417`. It is small (≈ 378 KB),
well under the MiniMax 20 MB cap, and within the documented
`image_constraints` (short side 768 px ≥ 300 px; aspect 1.333
∈ [0.40, 2.50]).

## 9. Did this phase create any new video tasks?

**No.**

## 10. Did this phase consume any video quota?

**No.** The auth check, the dry-run, the real-mode test (with
`I2V_SMOKE_TEST_LOCK_ONLY=1`), and `check:api` together made zero
real submit calls. The `I2V_SMOKE_TEST_LOCK_ONLY=1` path is the
only "real-mode" code path exercised in this phase; it never
reaches `runRealI2VSmoke`.

## 11. Did this phase query any existing `task_id`?

**No.** No `GET /v1/query/video_generation?task_id=…` calls.
No `GET /v1/files/retrieve?file_id=…` calls. The two `task_id`s
left over from the Phase J.2 incident remain on the MiniMax
service side untouched; the operator can query or cancel them
manually from the MiniMax dashboard if desired, but the
open-source project takes no further action on them in this
phase.

## 12. Did this phase commit any sensitive identifiers?

**No.** See §8 above.

## 13. What the system can do right now

- Accept and validate `POST /api/video/create` with both
  `generation_mode: text_to_video` and `generation_mode:
  image_to_video` server-side, including the MIME / size /
  dimension / aspect-ratio rules and the `https://` host-rejection
  rules.
- Build a deterministic PNG fixture from scratch, validate it
  offline (`10/10` checks), and use its bytes as the
  `first_frame_image` for a controlled real I2V smoke.
- Run `npm run smoke:i2v` in dry-run mode without ever touching
  MiniMax, without ever creating the lock file, and without ever
  logging the raw Data URL.
- Run `npm run check:api` end-to-end (`71/71` checks) including
  the new fixture / dry-run / lock-gate coverage.
- Run `npm run check:minimax-auth` to verify that
  `MINIMAX_API_KEY` reaches the Token Plan `remains` endpoint
  without `1004` (`auth_ok: yes`).
- Run `npm run fixture:i2v:generate` /
  `npm run fixture:i2v:validate` independently.

## 14. What the system still cannot do

- **Run a successful controlled real I2V smoke against the current
  `MINIMAX_API_KEY`.** Phase J.2 made the last two attempts, both
  failed at the PNG-decode stage, both were billed against the
  Token Plan, and the once-only lock now prevents any new attempt
  unless the operator explicitly deletes the lock. Phase J.3
  fixes the harness but does **not** lift the lock and does
  **not** run a third real submit.
- **Cancel or query the two task_ids from Phase J.2.** They remain
  on the MiniMax service side; only the operator can act on them
  via the MiniMax dashboard.

## 15. Next-step recommendations

1. **Do not** run `CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1 npm run
   smoke:i2v` in this phase. The once-only lock from Phase J.2 is
   still in place. Even if the lock is removed, the operator must
   explicitly authorize the next phase (e.g. `Phase J.4 —
   Controlled I2V Retry`).
2. **Phase J.4 — Controlled I2V Retry (gated)** — only the
   operator should authorize this. The Phase J.4 brief must:
   - explicitly state `max one real submit per phase`;
   - require the operator to delete
     `reports/local/i2v-real-smoke.lock` before invoking the
     smoke, as a visible re-authorization step;
   - require `npm run fixture:i2v:validate` to return `10/10 PASS`
     immediately before the real submit;
   - require the real-mode code path to remain unchanged so the
     once-only lock is re-applied after the attempt (success or
     failure).
3. **Tag policy.** Do not create `v0.2.0-alpha` until at least one
   successful, redacted I2V real smoke exists. The current state
   still does **not** meet that bar.
4. **Future harness improvements.** Add a CI step that runs
   `npm run fixture:i2v:validate` on every PR. Consider also
   running `npm run check:api` in CI with the lock-test path so
   the once-only guard is exercised on every change.

## 16. Sensitive-information audit (final)

| Check | Result |
| --- | --- |
| Real `MINIMAX_API_KEY` in this report | None |
| Real `SITE_PASSCODE` in this report | None |
| Real `Authorization` header in this report | None |
| Real `task_id` from this phase in this report | None created |
| Real `file_id` from this phase in this report | None created |
| Real `download_url` from this phase in this report | None created |
| Real image URL in this report | None |
| Base64 image content in this report | None |
| Real server IP / domain in this report | None |
| `.env` modified by this phase | No |
| `.env` staged in `git add` by this phase | No (gitignored) |
| `reports/local/` contents staged by this phase | No (gitignored) |