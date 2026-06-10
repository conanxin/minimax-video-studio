# minimax-video-studio

MiniMax Token Plan text-to-video studio MVP (non-official).

This repository is an open-source starter for cloning and local development. It is not an official MiniMax product.

> You need your own MiniMax Token Plan API Key to run real generation.

Current status:
- `v0.1.0-alpha` has been published.
- Phase C.1 real smoke test is verified once.
- Default smoke checks are non-consuming (dry run).

## Features

- Text-to-video task creation through backend API
- Task status polling every 10 seconds
- Task history listing and detail view
- Task compatibility validation before submit
- Video playback + download link when available
- Simple page passcode protection (`SITE_PASSCODE`)
- SQLite task storage
- Offline-friendly local setup

## Function scope

Current MVP scope remains text-to-video only:

- ✅ Text-to-video
- ❌ Image-to-video
- ❌ First/last frame conditioning
- ❌ Subject reference video

## Project structure

- `server/` - Express backend, MiniMax adapter, SQLite DB
- `web/` - Vite + React frontend
- `scripts/` - smoke and local import scripts
- `docs/` - deployment and phase reports
- Root configs: `.env.example`, `.nvmrc`, `package.json`

## Local development (multi-machine flow)

```bash
cd D:/Codex/minimax-video-studio
git clone <your-repo-url>
npm install
cp .env.example .env
```

Edit `.env`:

- `MINIMAX_API_KEY` = your MiniMax Token Plan key
- `SITE_PASSCODE` = your local passcode
- (optional) `MINIMAX_API_BASE` = `https://api.minimaxi.com` by default
- `CONFIRM_REAL_VIDEO` = `0` (default)

```bash
npm run dev
```

- Frontend: <http://127.0.0.1:8789>
- Health check: <http://127.0.0.1:8789/api/health>

### Multi-machine continuation

- Keep `.env` private on every machine.
- Run `npm install` to sync dependencies.
- Run `git pull` then copy `env` values, install, then launch.
- `data/` and SQLite files are created locally but ignored in repo.

## Scripts

- `npm run dev`
- `npm run dev:server`
- `npm run dev:web`
- `npm run build`
- `npm run start`
- `npm run smoke:video`
- `npm run import:local-smoke`
- `npm run check:open-source`

## Env vars

| Name | Description | Example |
| --- | --- | --- |
| `MINIMAX_API_KEY` | MiniMax API key for backend requests | `replace_with_your_minimax_token_plan_key` |
| `SITE_PASSCODE` | Simple page passcode | `change_me` |
| `PORT` | Service port (default 8789) | `8789` |
| `DATABASE_PATH` | SQLite path | `./data/minimax-video-studio.sqlite` |
| `MINIMAX_API_BASE` | MiniMax API base URL | `https://api.minimaxi.com` |
| `CONFIRM_REAL_VIDEO` | `0` for dry-run smoke, `1` to call real API | `0` |

## MiniMax Token Plan key

1. Open MiniMax Token Plan console
2. Get a valid Token Plan API key
3. Put the key in `.env` as `MINIMAX_API_KEY`
4. Never commit real keys or `.env`

## Smoke test

- `npm run smoke:video` runs smoke output and does **not** consume quota by default.
- Set `CONFIRM_REAL_VIDEO=1` for one controlled real run only.

```bash
# default dry-run
a set "CONFIRM_REAL_VIDEO=0";
npm run smoke:video

# controlled call
$env:CONFIRM_REAL_VIDEO = "1"
npm run smoke:video
```

## Text-to-video parameter compatibility matrix

### Model defaults

- Model: `MiniMax-Hailuo-2.3`
- Duration: `6`
- Resolution: `768P`
- `prompt_optimizer`: `true`

### Supported combinations

- `MiniMax-Hailuo-2.3`
  - `6s`: `768P`, `1080P`
  - `10s`: `768P`
- `MiniMax-Hailuo-02`
  - `6s`: `768P`, `1080P`
  - `10s`: `768P`
- `T2V-01-Director`
  - `6s`: `720P`
- `T2V-01`
  - `6s`: `720P`

### Validation rules

- Illegal model/duration/resolution combos return HTTP 400.
- Invalid prompt length (`> 2000`) returns HTTP 400.
- `POST /api/video/create` returns recommendation text on reject.
- Frontend blocks unsupported combinations before submit.

## Task status

- Preparing: `Preparing`
- Queueing: `Queueing`
- Processing: `Processing`
- Success: `Success`
- Fail: `Fail`

Frontend displays Chinese descriptions for the same statuses.

## Local smoke import

If a real smoke result exists in `reports/local/phase-c1-real-smoke.local.json`, import it into SQLite:

```bash
npm run import:local-smoke
```

This script keeps local records only and does not commit local JSON artifacts.

## Tencent Cloud deployment guide (generic)

See [docs/DEPLOY_TENCENT_CLOUD.md](docs/DEPLOY_TENCENT_CLOUD.md) for:

- clone/install/build/start workflow
- `.env` placement
- `systemd` sample with placeholder paths

## GitHub open-source publishing

Recommended process:

1. Ensure repository initialized and committed
2. Ensure `.env`, database files, logs, and node_modules are not tracked
3. Push to public GitHub repository
4. Keep `.env.example` only, not real secrets

## Open-source boundary

- Can publish:
  - Source code
  - README and docs
  - scripts and non-sensitive config templates
- Must not publish:
  - `.env`
  - real API keys
  - real database files
  - logs
  - any local path or IP/domain details from your environment

## Roadmap

- Add image-to-video
- Add first-frame / last-frame mode
- Add subject reference
- Prompt template library
- Local gallery enhancements
- Tencent Cloud domain + HTTPS + reverse proxy in next phase
- Optional Docker packaging

## Current limits

- This is a local MVP for personal usage and multi-machine continuation.
- It is intentionally minimal and safe by default.
- `download_url` may expire and refresh logic can be enhanced later.
