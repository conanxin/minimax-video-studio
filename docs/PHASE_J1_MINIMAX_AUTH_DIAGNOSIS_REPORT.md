# Phase J.1 — MiniMax Auth Diagnosis (Without Video Generation)

> **Outcome:** auth-only diagnostic executed once against the Token Plan
> `remains` endpoint. **No MiniMax video task was created.** **No
> MiniMax video-generation quota was consumed.** The endpoint returned
> `base_resp.status_code = 1004` ("login fail") because the value
> currently stored in `.env` is a literal placeholder, not a real Token
> Plan subscription key. **The operator must replace
> `MINIMAX_API_KEY` in `.env` manually; this report does not change
> `.env` and does not guess a new key.**

## 1. What this phase did

1. Pulled the latest `main` (HEAD before this phase = `44c63b1`,
   "docs: add Phase J redacted failure report").
2. Audited `.env` for the **shape** of `MINIMAX_API_KEY`. The raw value
   was never read into the report, never echoed to the console, and
   never committed.
3. Confirmed `server/services/minimaxClient.js` builds the
   `Authorization` header correctly (one `Bearer ` prefix, no
   double-prefix, no internal whitespace, no surrounding quotes).
4. Added two new helpers — `normalizeMiniMaxApiKey()` and
   `buildAuthorizationHeader()` — and exported them so the
   diagnostic script can reuse the same code path the live I2V
   call uses.
5. Added a new script: `scripts/check-minimax-auth.js`, registered as
   `npm run check:minimax-auth`. It performs an **auth-only** call to
   `GET https://api.minimaxi.com/v1/token_plan/remains`, which is a
   read-only usage query and does **not** create any video task.
6. Ran the full non-consuming validation chain:
   - `npm install`
   - `npm run build`
   - `npm run smoke:video` (dry-run)
   - `npm run smoke:i2v` (dry-run)
   - `npm run check:api` → `58/58 checks passed`
   - `npm run check:minimax-auth` → see §6
7. Wrote this redacted report.

## 2. Why this phase pauses real I2V retry

`Phase J — Controlled Real Image-to-Video Smoke` returned
`base_resp.status_code = 1004` ("login fail") at the upstream
login step. That status code is the upstream's authentication
verdict on the request's `Authorization` header — it is **not** a
video-generation verdict, **not** a model verdict, and **not** a
quota verdict. Retrying the same code path with the same `.env` is
guaranteed to return the same `1004`; the only thing that can change
the answer is the value stored in `.env`. Per the Phase J.1 hard
constraints, this phase therefore:

- Does **not** set `CONFIRM_REAL_VIDEO=1`.
- Does **not** set `CONFIRM_REAL_I2V=1`.
- Does **not** submit any video-generation request.
- Does **not** consume any video-generation quota.
- Does **not** modify `.env`.
- Does **not** guess a new key.

## 3. Meaning of MiniMax `1004`

MiniMax `base_resp.status_code = 1004` with status_msg of the form
`login fail: Please carry the API secret key in the 'Authorization'
field of the request header` means **the upstream rejected the
credential sent in the request's `Authorization` header.** Common
causes, in operator order:

1. The value stored in `MINIMAX_API_KEY` is a placeholder, not a real
   Token Plan subscription key (see §4 — this matches the current
   `.env`).
2. The Token Plan key is for a different region than the host
   (`api.minimaxi.com` is the international endpoint; `api.minimax.cn`
   if any).
3. The key has been revoked or has expired.
4. The key is for a different product than Token Plan (e.g. a
   platform API key without the `token_plan` scope).
5. The value in `.env` accidentally includes the literal `Bearer `
   prefix, which would produce `Authorization: Bearer Bearer <key>`
   — see §5 below; **this is not the case here**, the diagnostic
   explicitly checks for it.

A `1004` against `GET /v1/token_plan/remains` is definitive on
points 1, 3, 4, and 5. It is **not** evidence that the
`/v1/video_generation` endpoint would behave differently — that
endpoint has its own auth model and would need its own gated smoke
after the key is replaced.

## 4. `.env` key shape audit (redacted)

The audit was performed by reading `.env` directly from disk via
`dotenv` and applying the new `normalizeMiniMaxApiKey()` helper.
The raw value was never printed. The audit produced:

| Field | Result |
| --- | --- |
| `MINIMAX_API_KEY` exists in `.env` | yes |
| `SITE_PASSCODE` exists in `.env` | yes |
| `MINIMAX_API_BASE` exists in `.env` | yes (`https://api.minimaxi.com`) |
| Raw value length (chars) | 40 |
| Raw value sha256[0:8] | `60fafd9c` |
| Starts with `Bearer ` prefix | no |
| Has surrounding `"` / `'` quotes | no |
| Has internal whitespace / newline | no |
| Looks like `sk-cp-*` Token Plan subscription key | no |
| Looks like `eyJ…` JWT | no |
| Looks like a placeholder string (e.g. `replace_with_…_key`, `change_me`) | **yes** |

The **placeholder flag is the root cause of the Phase J `1004`.**
The value currently in `.env` is a literal placeholder string
(`replace_with_<…>_token_plan_key`, 40 chars, `[a-z0-9_]` charset),
which is exactly the kind of value the Token Plan endpoint is
expected to reject. The Phase J report described the key as
"non-placeholder" because it was checked only for length /
charset, not for semantic content; this phase catches that gap
explicitly.

The raw value is **not** reproduced in this report. The sha256 short
hash `60fafd9c` and length `40` are stable fingerprints that uniquely
identify this placeholder string and are safe to publish.

## 5. Authorization header assembly check

`server/services/minimaxClient.js` now contains two new helpers
used by every request:

- `normalizeMiniMaxApiKey(raw)` — strips surrounding `"` / `'`
  quotes, trims outer whitespace, removes any internal whitespace
  (including newlines).
- `buildAuthorizationHeader(raw)` — runs `normalize…`, throws a
  configuration error if the result starts with `Bearer `, then
  returns `Bearer <key>`.

| Check | Result |
| --- | --- |
| `requestHeaders()` builds `Authorization` exactly once | yes |
| `Authorization` always starts with `Bearer ` | yes |
| `Authorization` never has a `Bearer Bearer` double prefix | yes |
| Helper throws if `.env` accidentally stores `Bearer <key>` | yes (script-level exit code 1, not a network call) |
| Logs anywhere print a full `Authorization` header | no (only redacted diagnostics) |
| Helper exported so the auth diagnostic reuses the same path | yes |

Because the current `.env` value is a literal placeholder, the
helper produces `Bearer <placeholder-literal>` in the request —
which is exactly the wrong key, but at least the header shape is
correct. The auth verdict belongs to the upstream, not to the
code path.

## 6. Token Plan `remains` auth-only check (redacted)

`npm run check:minimax-auth` was executed once. It issued a single
`GET https://api.minimaxi.com/v1/token_plan/remains` request with
the `Authorization` header built by `buildAuthorizationHeader()`
above. It produced:

| Field | Result |
| --- | --- |
| Endpoint | `GET https://api.minimaxi.com/v1/token_plan/remains` |
| HTTP status | `200` |
| `base_resp.status_code` | `1004` |
| `base_resp.status_msg` | `login fail: Please carry the API secret key in the 'Authorization' field of the request header` |
| `auth_ok` | `no` |
| `auth_reason` | `upstream_login_fail_1004` |
| `token_plan_endpoint_reachable` | `yes` |
| Network | `ok` (no DNS / TCP / TLS error) |
| Quota consumed | `No` (Token Plan `remains` is read-only) |
| Real `task_id` returned | `No` |
| Real `file_id` returned | `No` |
| Real `download_url` returned | `No` |

The Token Plan endpoint accepted the TCP / TLS / HTTP handshake and
returned a structured JSON error envelope. That confirms:

1. The host `api.minimaxi.com` is reachable from this machine.
2. The request format (`GET /v1/token_plan/remains`,
   `Authorization: Bearer *** `, `Content-Type: application/json`) is
   parseable by the upstream.
3. The credential is rejected upstream. Combined with §4, the
   rejection is caused by the placeholder value in `.env`, not by
   network, not by header shape, not by region mismatch (region
   would have produced a different status_msg), not by an
   accidental `Bearer ` prefix.

## 7. Was any video task created?

**No.** The diagnostic script only calls `GET /v1/token_plan/remains`.
It never calls `POST /v1/video_generation`, never calls
`GET /v1/query/video_generation`, and never calls
`GET /v1/files/retrieve`. No task row was inserted into SQLite.
The Phase J seeded `image_to_video` rows visible at `/api/tasks`
remain the only `image_to_video` rows in the system; none of them
were created by this phase.

## 8. Was any video quota consumed?

**No.** Token Plan `remains` is a read-only usage query. It does not
bill against the video-generation quota. This phase billed nothing.

## 9. Does the operator need to replace the key manually?

**Yes.** The current `MINIMAX_API_KEY` in `.env` is a literal
placeholder string of the form
`replace_with_<…>_token_plan_key` (40 chars, sha256[0:8] =
`60fafd9c`). This phase does **not** modify `.env` and does
**not** guess a replacement value. The operator must:

1. Open the MiniMax / Token Plan dashboard.
2. Generate a fresh Token Plan subscription key (the same product
   that bills `/v1/video_generation`).
3. Replace the value of `MINIMAX_API_KEY` in `.env` with that
   fresh key, stored as a **bare value**, with no `Bearer ` prefix
   and no surrounding quotes.
4. Do **not** paste the new key into this chat, into git, or into
   any committed file.
5. Re-run `npm run check:minimax-auth`. If it returns `auth_ok:
   yes`, the auth path is healthy and the operator may decide
   whether to proceed to a Phase J retry (which still requires
   explicit `CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1` opt-in).

## 10. Sensitive-information audit

| Check | Result |
| --- | --- |
| Real `MINIMAX_API_KEY` in this report | None (only `sha256[0:8] = 60fafd9c` and length 40) |
| Real `SITE_PASSCODE` in this report | None (existence only) |
| Real `Authorization` header in this report | None (only the literal `Bearer *** shape) |
| Real `task_id` in this report | None |
| Real `file_id` in this report | None |
| Real `download_url` in this report | None |
| Real image URL in this report | None |
| Base64 image content in this report | None |
| Full Token Plan `remains` response body in this report | None (only `base_resp` echoed; `data` keys listed without values) |
| MiniMax account-level identifiers in this report | None |
| `.env` modified by this phase | No |
| `.env` staged in `git add` by this phase | No (`.env` is gitignored) |

The only artifacts that touched disk this phase are:

- `server/services/minimaxClient.js` (helper additions, no
  secrets).
- `scripts/check-minimax-auth.js` (new file, no secrets).
- `package.json` (one new script entry, no secrets).
- `docs/PHASE_J1_MINIMAX_AUTH_DIAGNOSIS_REPORT.md` (this file, no
  secrets).
- `reports/local/*.local.{md,json}` (gitignored, never staged).
- `data/minimax-video-studio.sqlite` (gitignored, never staged; no
  new rows from this phase).

## 11. Next-step recommendations

1. **Replace `MINIMAX_API_KEY` in `.env` manually.** Use a real
   Token Plan subscription key, stored bare (no `Bearer ` prefix,
   no surrounding quotes). This is a hard prerequisite for any
   Phase J retry.
2. **Re-run `npm run check:minimax-auth`** after replacing the key.
   - If it returns `auth_ok: yes`, the auth path is healthy.
   - If it still returns `1004`, the upstream still rejects the
     key — investigate region / product scope / key status in the
     MiniMax dashboard before retrying.
3. **Do not** proceed to a Phase J retry until the auth-only check
   returns `auth_ok: yes`. A retry against the same `.env` is
   guaranteed to return the same `1004`.
4. **Do not** create the `v0.2.0-alpha` tag until at least one
   successful, redacted Phase J exists.
5. Optional follow-up phases (still gated on a working key):
   - Phase J Retry — re-run the controlled real I2V smoke, same
     redacted report format.
   - Phase J.2 — subject-reference (主体参考) capability, gated on
     `CONFIRM_REAL_VIDEO=1` and a separate opt-in flag.
   - Phase J.3 — first-frame-image-as-public-URL flow, if
     desired.

## 12. Why this phase did not run the real I2V smoke

The Phase J.1 brief is explicit: this phase diagnoses auth only,
never consumes quota, never sets the real-video opt-ins. The
`smoke:i2v` dry-run branch (`final_status: skipped`, `real_quota_consumed:
No`) was the only path exercised this phase. The real-I2V branch
(`runRealI2VSmoke`) was **not** entered, and the
`reports/local/phase-j-i2v-smoke.local.{md,json}` files dated
`2026-06-16T18:13` are the previous Phase J attempt only — they
were not regenerated this phase.