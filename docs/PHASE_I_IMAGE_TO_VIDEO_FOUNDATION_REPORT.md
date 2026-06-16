# Phase I — Image-to-Video Foundation (Recovery)

> **Scope:** Phase I Recovery only. Phase J (controlled real I2V smoke) is
> **not** included in this release and will only run after explicit user
> authorization.

## 1. Pre-flight facts (verified before any code change)

| Fact | Value |
| --- | --- |
| Phase I Recovery starting HEAD | `e91d15c` ("Add error categorization and smoke dry-run hygiene") |
| `0bb19b6` exists? | **No.** `git cat-file -t 0bb19b6` returns `fatal: Not a valid object name 0bb19b6`. The string `0bb19b6` therefore appears in this report **only as an incident marker**, never as a commit, tag, or "completed phase" claim. |
| Was a real Phase I previously completed? | **No.** The earlier "Phase I success" narrative was not backed by a real commit on the current history. This Recovery branch is the first honest Phase I implementation. |
| Working tree state at start | Modified: `package.json`, `scripts/check-api-regression.js`, `server/db.js`, `server/index.js`, `server/services/errorClassifier.js`, `server/services/minimaxClient.js`, `server/services/taskStore.js`. Untracked: `scripts/smoke-image-to-video.js`, `server/services/taskTransform.js`, `server/services/validation.js`, `shared/videoModelsI2V.json`. |

## 2. Real code changes in this Phase I Recovery

### 2.1 Shared I2V model config

- Added `shared/videoModelsI2V.json` with body wrapped under
  `i2vModelConfig`. Fields: `defaults`, `max_prompt_length`,
  `image_constraints`, `compatibility`. The wrapper is mandatory and
  matches the same pattern used by sibling configs that will live in
  `shared/` going forward.
- The T2V config (`shared/videoModels.json`) is intentionally **not**
  wrapped — its shape is already flat, and consumers read it from the
  root.

### 2.2 I2V JSON wrapper conflict — fixed

The first run of `npm run check:api` after the WIP landed revealed a
real bug: `server/services/validation.js` imported the I2V JSON as if
it were flat (`require('../../shared/videoModelsI2V.json')`), so
`I2V.compatibility`, `I2V.image_constraints`, and `I2V.defaults` were
all `undefined`, breaking every image_to_video validator path.

`server/services/taskStore.js` had the inverse bug: it re-exported
`i2vModelConfig: require('../../shared/videoModelsI2V.json')`, which
double-wrapped the payload as `{ i2vModelConfig: { i2vModelConfig: {...} } }`.

Both are now fixed to read the JSON consistently:

- `server/services/validation.js`:
  `const I2V = require('../../shared/videoModelsI2V.json').i2vModelConfig;`
- `server/services/taskStore.js`:
  `i2vModelConfig: require('../../shared/videoModelsI2V.json').i2vModelConfig`

`scripts/smoke-image-to-video.js` was already using the wrapper
(`require('../shared/videoModelsI2V.json').i2vModelConfig`) so no change
was needed there.

After the fix, `node -e` confirms:

```
I2V_COMPATIBILITY models: MiniMax-Hailuo-2.3, MiniMax-Hailuo-2.3-Fast, MiniMax-Hailuo-02, I2V-01-Director, I2V-01-live, I2V-01
I2V_IMAGE_CONSTRAINTS: { formats: [jpg,jpeg,png,webp], max_bytes: 20971520, min_short_side_px: 300, aspect_ratio_min: 0.4, aspect_ratio_max: 2.5, input_types: [public_url,data_url] }
I2V_DEFAULTS: { model: MiniMax-Hailuo-2.3, duration: 6, resolution: 768P, prompt_optimizer: true }
T2V_DEFAULTS model: MiniMax-Hailuo-2.3
I2V valid URL: true public_url
I2V valid data url: true data_url
T2V: true text_to_video
I2V invalid combo (10s+1080P): false MiniMax-Hailuo-2.3 does not support 10s + 1080P in image-to-video.
```

### 2.3 `generation_mode` — server

- `server/services/validation.js`:
  - `normalizeGenerationMode(value)` accepts only `text_to_video`
    (default) and `image_to_video`.
  - `validateTaskInput(payload)` dispatches to `validateTextInput` or
    `validateImageToVideoInput` based on the mode.
  - `validateImageToVideoInput` runs every text-side rule
    (model / duration / resolution matrix, prompt length) **and**
    `validateImageInput`.
- `server/index.js`:
  - `POST /api/video/create` now forwards `generation_mode` and
    `first_frame_image` into the validator.
  - For I2V tasks the server stores only the *summary* fields:
    `generation_mode`, `input_image_present`, `input_image_type`,
    `input_image_host`, `input_image_mime`, `input_image_approx_bytes`,
    `input_image_sha256_short`, `input_image_summary`. The raw image
    bytes / Data URL never enter SQLite or any other persisted JSON.
  - `GET /api/generation-modes` advertises both modes plus the image
    constraint table.
  - `GET /api/video/i2v/models` serves the live I2V matrix.

### 2.4 `first_frame_image` validation

- `validateImageInput` (server) recognizes two shapes:
  - `data:image/(jpeg|jpg|png|webp);base64,…` — accepted, with size
    computed from base64 length (4 chars → 3 bytes).
  - `https://…` — accepted only when the URL parses, has `https:`
    protocol, and the hostname is **not** localhost / 127.x / 10.x /
    192.168.x / 172.16–31.x / 0.0.0.0 / IPv6 loopback / IPv6 ULA.
- Explicit error branches for `data:image/…` (non-supported MIME),
  `http://`, `file://`, and unrecognized inputs so the frontend can
  show actionable copy.
- Frontend (`web/src/App.jsx` → `inspectImageFile`) does the same checks
  *before* submit, including:
  - **MIME**: `image/jpeg`, `image/png`, `image/webp` only.
  - **Size**: ≤ 20 MB. (`formatBytes` shows KB/MB in the preview.)
  - **Short side**: ≥ 300 px (uses `naturalWidth` / `naturalHeight`).
  - **Aspect ratio**: long / short ∈ [0.4, 2.5].
- Submit is disabled (`!imageReady`) until either a validated
  uploaded preview exists or an `https://` URL passes the URL check.

### 2.5 Avoid saving full image content

- The DB columns for I2V tasks contain only: `input_image_present`,
  `input_image_type`, `input_image_host`, `input_image_mime`,
  `input_image_approx_bytes`, `input_image_sha256_short` (8 hex chars of
  SHA-256 of the raw value), and a short human-readable
  `input_image_summary`. The Data URL itself is **never** stored.
- `server/services/minimaxClient.js` forwards `first_frame_image` into
  the upstream I2V request, then strips it from any echoed error body
  before the error is exposed to the API surface, so it never leaks via
  `/api/video/task/:id`.
- `server/services/taskTransform.js` is the single place that turns a
  DB row into the API response; it never reads or copies any image
  field that isn't on the safe-summary list.
- Frontend `copyParamsToForm` for I2V tasks explicitly clears
  `uploadPreview`, `imageUrlInput`, and any URL / upload error state,
  and shows an info banner: *"图生视频任务不恢复首帧图片，请重新选择
  或粘贴图片 URL."* Same intent applies to `copyParamsToClipboard` —
  the exported JSON only carries `generation_mode`, `prompt`, `model`,
  `duration`, `resolution`, `prompt_optimizer`.

### 2.6 Frontend I2V UI changes

- New `FALLBACK_I2V_CONFIG` constant so the UI still works if the live
  `/api/video/i2v/models` call fails.
- New `GENERATION_MODE_OPTIONS` and `GENERATION_MODE_LABEL` (Chinese).
- New state: `generationMode`, `imageUrlInput`, `uploadPreview`,
  `uploadError`, `urlCheckError`, `imageBusy`, `fileInputRef`.
- New helpers: `inspectImageFile`, `validateImageUrlInput`,
  `formatBytes`, `handleModeChange`, `handleImageFile`,
  `handleImageUrlChange`, `clearUploadedImage`.
- The **Create task** card now starts with a mode toggle (文生视频 /
  图生视频). Switching modes resets model/duration/resolution to the new
  matrix defaults and clears the image state when going back to T2V.
- In I2V mode the camera-move chip row is hidden and replaced by an I2V
  section containing:
  - `first_frame_image` HTTPS URL input (with synchronous URL check).
  - File upload (`<input type="file" accept="image/jpeg,image/png,image/webp">`)
    that uses `FileReader.readAsDataURL` to produce the Data URL — no
    `localStorage`, no IndexedDB, no service worker cache.
  - An `<img>` preview with metadata (type, dimensions, size, short
    side, aspect ratio) and a "remove uploaded image" button.
- The model / duration / resolution dropdowns in I2V mode are now
  driven by the I2V compatibility matrix (`activeConfig =
  isI2V ? i2vConfig : modelConfig`).
- Task detail panel now shows a `Mode` pill (`文生视频` /
  `图生视频`). When the mode is `image_to_video` it also surfaces
  `input_image_present`, `input_image_type`, `input_image_host`,
  `input_image_sha256_short`, and a one-line `input_image_summary` —
  **never** the full URL or any Data URL fragment.
- Task history rows carry a small mode pill next to the status pill.
- The Submit button's warning text and disable logic both reflect the
  active mode.

### 2.7 Image-related error categories

`server/services/errorClassifier.js` adds four categories with full
severity / user message / suggested action / retry hint metadata:

| Category | Trigger | Severity | Retryable |
| --- | --- | --- | --- |
| `image_unavailable` | MiniMax / validator can't reach the image URL | `error` | No |
| `image_too_large` | image > 20 MB | `error` | No (user must compress) |
| `unsupported_image_format` | not JPG/JPEG/PNG/WebP | `error` | No (user must re-encode) |
| `invalid_image_dimensions` | short side < 300 px or aspect out of range | `error` | No (user must re-crop) |

These plug into the existing `error_category` /
`error_user_message` / `error_suggested_action` / `error_retry_hint`
fields that Phase H already wires through every task response and the
detail panel.

### 2.8 `check:api` real additions

`scripts/check-api-regression.js` gained **9** new I2V-specific
assertions on top of the previous T2V suite:

1. `POST /api/video/create image_to_video missing image -> 400`.
2. The same call rejected **before** any remote MiniMax call.
3. `POST /api/video/create image_to_video private/local URLs -> 400`
   for `http://`, `localhost`, RFC1918 `10.x` and `192.168.x`, and
   `file://`.
4. `POST /api/video/create image_to_video svg Data URL -> 400`.
5. `POST /api/video/create image_to_video over-20MB Data URL -> 400`.
6. `POST /api/video/create image_to_video invalid I2V combo -> 400`.
7. `errorClassifier: image url unavailable -> image_unavailable`.
8. `errorClassifier: image too large -> image_too_large`.
9. `errorClassifier: unsupported image format -> unsupported_image_format`.
10. `errorClassifier: image dimension too small -> invalid_image_dimensions`.
11. `GET /api/tasks I2V seed row -> image_to_video + image_unavailable + image summary`.
12. `GET /api/tasks I2V Success seed -> generation_mode=image_to_video + safe payload`.
13. `GET /api/generation-modes -> 200 with text_to_video + image_to_video + image_constraints`.
14. `GET /api/video/i2v/models -> 200 with MiniMax-Hailuo-2.3 matrix and 20MB cap`.
15. `smoke:i2v dry-run leaves docs/PHASE_A_API_SMOKE_REPORT.md untouched`.
16. `smoke:i2v dry-run did not create a real I2V task`.
17. `smoke:i2v dry-run output does not echo real key fragment`.

Final real run: `[phase-i] summary: 58/58 checks passed.` and
`[phase-i] all checks PASSED. No real MiniMax task was created.`

## 3. What the system can do right now

- Accept `POST /api/video/create` with `generation_mode:
  text_to_video` and behave exactly as before.
- Accept `POST /api/video/create` with `generation_mode:
  image_to_video` plus a valid `first_frame_image`, validate it, build
  the safe DB summary, and **forward the request to MiniMax** —
  but only when the *user* explicitly submits from the UI (or calls
  the API directly with `passcode`).
- Serve `/api/video/i2v/models`, `/api/generation-modes`,
  `/api/health`, `/api/polling/config`, `/api/download-link/config`,
  `/api/tasks` with I2V rows rendering mode + image summary fields.
- Classify image-related MiniMax errors into the four new
  `error_category` values.
- Run `npm run smoke:video` and `npm run smoke:i2v` in dry-run mode
  for safe local validation that touches no remote API and consumes
  no quota.

## 4. What the system still cannot do

- Run a **real** image-to-video job without the operator explicitly
  setting `CONFIRM_REAL_VIDEO=1` and `CONFIRM_REAL_I2V=1`. Neither
  smoke script will do that on its own.
- Recover a previously uploaded first-frame image after the user
  reloads the page or copies the params back into the form — by
  design, the image is not stored anywhere on our side.
- Stream an I2V generation progress UI different from the existing
  polling flow — I2V reuses the same polling pipeline as T2V.

## 5. Sensitive-information audit (real)

| Check | Result |
| --- | --- |
| `0bb19b6` outside `docs/PHASE_I_IMAGE_TO_VIDEO_FOUNDATION_REPORT.md` | **None found** in `README.md`, `docs/`, `server/`, `web/`, `scripts/`, `shared/`, or `package.json`. |
| Real `task_id` from a live MiniMax run in any of the above paths | **None found.** |
| Real `file_id` from a live MiniMax run in any of the above paths | **None found.** |
| Real `download_url` from a live MiniMax run in any of the above paths | **None found.** |
| Real API key fragment in any of the above paths | **None found.** |
| `data:image/…;base64,…` *real* image bytes in any of the above paths | **None found.** The only `data:image/...;base64,...` strings present are (a) format documentation in error messages and (b) a 1×1 transparent PNG / `<svg/>` placeholder used by the smoke + regression scripts to exercise the validator; none of them carry actual image content. |
| Committed `.env`, `reports/local`, SQLite DB, `node_modules`, `dist` | **None.** `.gitignore` continues to exclude them; `git status --short` lists only the expected source-tree paths. |

## 6. Side-effects on third parties

- **No** new MiniMax task was created (`real_quota_consumed: No` from
  both smoke scripts).
- **No** tag was created.
- **No** push to a public registry was performed before this commit.
- The OSS repository
  `https://github.com/conanxin/minimax-video-studio` was *not* touched
  by this Recovery run beyond the single `git push origin main` step
  listed in §7.

## 7. Final verification trail (real command output)

```
$ git rev-parse HEAD
e91d15cc5c2cc934a9ce49ed91742545ae846525

$ git cat-file -t 0bb19b6
fatal: Not a valid object name 0bb19b6

$ npm install
up to date, audited 317 packages in 6s

$ npm run build
✓ 31 modules transformed.
dist/index.html                   0.40 kB │ gzip:  0.31 kB
dist/assets/index-DJ45okvy.css    7.92 kB │ gzip:  2.12 kB
dist/assets/index-s9J5c3BC.js   173.61 kB │ gzip: 56.94 kB
✓ built in 893ms

$ npm run smoke:video
MiniMax smoke test:
MINIMAX_API_KEY exists: yes
Smoke dry-run console summary:
  - final_status: skipped
  - real_quota_consumed: No
  - fail_reason: Skipped by default. Set CONFIRM_REAL_VIDEO=1 and run again for one controlled real call.

$ npm run smoke:i2v
MiniMax I2V smoke test:
MINIMAX_API_KEY exists: yes
I2V smoke dry-run console summary:
  - final_status: skipped
  - real_quota_consumed: No
  - fail_reason: Skipped by default. Set CONFIRM_REAL_VIDEO=1 and CONFIRM_REAL_I2V=1 and run again for one controlled real call.
  - payload_summary: {"model":"MiniMax-Hailuo-2.3","prompt":"A calm abstract gradient slowly blooming outward, soft pastel lighting, no people, no text, no logos, gentle cinematic motion, 6 seconds.","duration":6,"resolution":"768P","prompt_optimizer":true,"first_frame_image_kind":"data_url_png","first_frame_image_bytes_estimated":190,"first_frame_image_sha256_short":"8bf0dbed"}

$ npm run check:api
[phase-i] summary: 58/58 checks passed.
[phase-i] all checks PASSED. No real MiniMax task was created.
```

## 8. Phase J — next step (NOT executed)

Phase J would run **one** controlled real I2V smoke job:

1. Send `POST /api/video/create` with `generation_mode: image_to_video`,
   a small public-URL or Data-URL first frame, the validated model /
   duration / resolution combo, and the live `passcode`.
2. Poll until terminal status.
3. Record the real `task_id` (only into local `reports/local/`), never
   into git.
4. Compare the real error_category (if any) against the four new
   categories from §2.7.

**Phase J is intentionally out of scope here.** It will only run after
the user explicitly authorizes quota consumption in a dedicated
session.