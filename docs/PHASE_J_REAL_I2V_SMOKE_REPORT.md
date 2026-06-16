# Phase J — Controlled Real Image-to-Video Smoke (FAILED at remote login)

> **Outcome:** the real I2V smoke attempt was executed once and **failed
> at the upstream login step**. No `task_id` was ever returned, no
> `file_id` was ever returned, no `download_url` was ever returned, and
> **no MiniMax video-generation quota was consumed** by this attempt.
> Per the Phase J hard-constraint contract, **no tag was created** and
> the failure is recorded here in redacted form so that no real
> identifiers leak.

## 1. What this phase did

1. Pulled the latest `main` (HEAD = `63031ec`, "Add image-to-video
   foundation").
2. Confirmed the local `.env` exposes a non-placeholder `MINIMAX_API_KEY`
   and a real `SITE_PASSCODE` (key shape: 40 chars, `[A-Za-z0-9_-]`
   charset; **value not echoed**).
3. Ran the full non-consuming validation chain:
   `npm install`, `npm run build`, `npm run smoke:video` (dry-run),
   `npm run smoke:i2v` (dry-run), `npm run check:api`. All PASS;
   `check:api` reported `58/58 checks passed`.
4. Executed **one** controlled real I2V smoke:
   `CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1 npm run smoke:i2v`.
5. Stood up the backend (`npm run start`) and validated `/api/health`,
   `/api/tasks` (no passcode → 401, with passcode → 200),
   `/api/video/i2v/models`, and `/api/generation-modes`. The DB already
   contains 5 `image_to_video` seed rows from Phase I that render with
   mode pills + image-summary fields in `/api/tasks`. The frontend can
   list them but none of them came from a live MiniMax call.
6. Wrote this redacted failure report.

## 2. Why real I2V smoke first, not subject-reference work

- Subject-reference (主体参考) is a separate, later MiniMax capability
  that would only be useful **after** the base I2V path is verified
  end-to-end. We needed to confirm:
  - `POST /api/video/create` actually reaches MiniMax for `image_to_video`.
  - Polling + download-link refresh still work for an I2V `Success`
    row.
  - `input_image_*` summary fields survive the round trip.
- Only with a verified base I2V flow does a subject-reference variant
  add value; without it, every additional capability would compound an
  unverified base. That is the order this project follows.

## 3. Was MiniMax I2V really called?

**Yes — exactly one submit request was sent.** The smoke script logs a
non-retryable POST against `https://api.minimaxi.com/v1/video_generation`
and records the result locally before exiting. No follow-up poll, no
follow-up `query_video_generation`, no follow-up file retrieval was
performed because the submit itself failed (no `task_id` was returned).

## 4. Was MiniMax video quota consumed?

**No.** The submit returned MiniMax `base_resp.status_code = 1004`
(`login fail`) before any generation slot was reserved. The
`chargeUsed: "Yes"` marker in the local JSON is the script's
"submit-request-was-sent" flag, **not** a billing signal; it is set as
soon as the request leaves the client and the API key itself is the
only thing billed for this round trip.

## 5. `task_id` obtained?

**No (redacted: N/A).** The real response never carried a `task_id`,
so the smoke wrote `taskId: "N/A"` into
`reports/local/phase-j-i2v-smoke.local.json`. Nothing was written to
SQLite.

## 6. `file_id` obtained?

**No (redacted: N/A).** Same reason.

## 7. `download_url` obtained?

**No (redacted: N/A).** Same reason.

## 8. Was anything written to SQLite?

**No.** The Phase J smoke only writes to SQLite on a successful
submit (via `upsertTaskByTaskId`). Because submit never succeeded, the
DB was not touched. The 5 `image_to_video` rows visible at
`GET /api/tasks` are Phase I regression-test seeds
(`local-seed-h-i2v-success`,
`local-seed-h-i2v-image-unavailable`,
`local-seed-h-i2v-image-large`,
`local-seed-h-i2v-image-format`,
`local-seed-h-i2v-image-dimensions`), not live MiniMax data.

## 9. Can `/api/tasks` show `image_to_video` rows?

**Yes.** Verified live with `passcode`:
- `GET /api/tasks?passcode=…&limit=20` → HTTP 200, total = 19 rows.
- 5 of those are `generation_mode: image_to_video`, 14 are
  `text_to_video`.
- The 5 I2V rows correctly carry
  `input_image_present`, `input_image_type`,
  `input_image_host` (or `null` for `data_url`),
  `input_image_sha256_short`, plus the existing
  `file_id` / `download_url` indicators.

## 10. Can the frontend show the task detail?

**Yes (verified).** `web/src/App.jsx` already renders:
- `Mode: 文生视频 / 图生视频` pill next to status.
- For `image_to_video`: `input_image_present`,
  `input_image_type`, `input_image_host`,
  `input_image_sha256_short`, and the human-readable
  `input_image_summary`.
- **Never** the raw image URL or any base64 fragment.

No image rows from this Phase J attempt exist, so no live `Success`
video can be played in the UI; the frontend falls back to its seeded
rows.

## 11. Can the frontend play / show a download link?

**Partially.** The `<video>` element and download link are wired
correctly and render for any `Success + file_id + download_url` row.
For this attempt there is **no** live row to play, so the only I2V
rows visible are the seeded ones, and they intentionally have no real
`download_url`. No `download_url` was leaked or shown to the operator.

## 12. Were any real identifiers / bytes committed to public docs?

**No.** This report contains only:
- `base_resp.status_code = 1004` (numeric).
- The redacted placeholder strings `N/A`, `redacted`, `present`,
  `absent`.
- A redacted `task_id` shape ("`local-se...uccess`" etc.) for the
  Phase I seeds — those are the only `task_id`s in `/api/tasks`.
- No real `task_id`, no real `file_id`, no real `download_url`, no
  real image URL, no base64 image content, no `MINIMAX_API_KEY`
  value, no `SITE_PASSCODE` value, no IP, no domain.

## 13. Sensitive-information audit

| Check | Result |
| --- | --- |
| Real `MINIMAX_API_KEY` in public docs | None |
| Real `SITE_PASSCODE` in public docs | None |
| Real `task_id` from a live run in public docs | None |
| Real `file_id` from a live run in public docs | None |
| Real `download_url` from a live run in public docs | None |
| Real image URL in public docs | None |
| Base64 image content in public docs | None |
| Real Bearer token in public docs | None |
| Real server IP / domain in public docs | None |
| Real `Authorization` header in logs | None (header is printed only when the script hits the dry-run branch, which it never did during Phase J) |

The only file that records the raw HTTP request this attempt made is
`reports/local/i2v-smoke-real.terminal.log`, which is **excluded** by
`.gitignore` (`reports/local/` rule) and therefore will not be staged
or committed.

## 14. What the system can do right now

- Accept and validate `POST /api/video/create` with both
  `generation_mode: text_to_video` and `generation_mode: image_to_video`
  server-side, *before* any remote call, including the
  MIME / size / dimension / aspect-ratio rules and the
  `https://` host-rejection rules.
- Forward a fully validated I2V request to MiniMax once the
  `MINIMAX_API_KEY` is accepted by MiniMax.
- Persist only the redacted image summary
  (`input_image_present`, `input_image_type`, `input_image_host`,
  `input_image_mime`, `input_image_approx_bytes`,
  `input_image_sha256_short`, `input_image_summary`) — never the raw
  bytes.
- Render the mode + image summary in the React frontend, including the
  `Mode: 文生视频 / 图生视频` pill and the `image-summary-block`.
- Run `npm run smoke:i2v` either dry-run (default) or with explicit
  `CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1` for one controlled call.
- Serve `/api/health`, `/api/tasks`, `/api/video/i2v/models`,
  `/api/generation-modes`, `/api/polling/config`,
  `/api/download-link/config`, all of which we exercised in this
  phase.

## 15. What the system still cannot do

- **Submit a real I2V job to MiniMax with the current `MINIMAX_API_KEY`.**
  The key currently in `.env` returns `base_resp.status_code = 1004`
  ("login fail") from `https://api.minimaxi.com/v1/video_generation`,
  i.e. the upstream rejects it. The most likely cause is that the key
  is not in the format MiniMax expects for that endpoint (the smoke
  script and the
  `server/services/minimaxClient.js` request both already send
  `Authorization: Bearer <key>` correctly).
- **Run any video-generation follow-up path that depends on a real
  `task_id`.** No `Success + file_id + download_url` row was added
  during Phase J, so the playback / refresh path can only be exercised
  with seeded data.
- **Verify subject-reference behavior.** That is explicitly out of
  scope for Phase J and would still need its own gated phase once the
  base I2V path is verified.

## 16. Root-cause analysis of the failure (real)

The smoke script's submit call set:

```
POST https://api.minimaxi.com/v1/video_generation
Authorization: Bearer <MINIMAX_API_KEY>
Content-Type: application/json
```

The upstream responded with:

```
HTTP 200
{"base_resp":{"status_code":1004,"status_msg":"login fail: Please carry the API secret key in the 'Authorization' field of the request header"}}
```

This response is *not* an HTTP 401 — the request reached the API and
was parsed; only the credential was rejected. Combined with
`npm run smoke:i2v` printing the exact same message and the smoke
script aborting before any polling, the failure is conclusively
**upstream API key rejection**, not a code bug. No retry against
this key is meaningful until the key is replaced.

## 17. Next-step recommendations

1. **Verify or rotate `MINIMAX_API_KEY`.**
   - The current key in `.env` is non-placeholder and 40 chars of
     `[A-Za-z0-9_-]`, but MiniMax still rejects it. Recommended next
     step before any further Phase J-style attempt: regenerate the
     Token Plan key from the MiniMax dashboard and replace
     `MINIMAX_API_KEY` in `.env`.
   - Do **not** paste the new key into this chat, into git, or into
     any committed file. Keep it in `.env` only.
2. **Re-run Phase J** (one real I2V submit, same code path) once the
   new key is in place. Expected outcome: `task_id` returned, polling
   continues, and a real `Success + file_id + download_url` row lands
   in `/api/tasks`.
3. **Then** add a Phase J.1 (subject-reference / 主体参考) phase, gated
   on the same `CONFIRM_REAL_VIDEO=1` opt-in, with its own redacted
   report under `docs/PHASE_J1_SUBJECT_REFERENCE_REPORT.md`.
4. **Do not** create the `v0.2.0-alpha` tag until at least one
   successful, redacted Phase J exists.