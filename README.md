# minimax-video-studio

MiniMax Token Plan text-to-video studio MVP (non-official).

This repository is an open-source starter for cloning and local development. It is not an official MiniMax product.

> You need your own MiniMax Token Plan API Key to run real generation.

## Features

- Text-to-video task creation through backend API
- Task status polling every 10 seconds
- Task history listing
- Video playback + download after completion
- Simple page passcode protection (`SITE_PASSCODE`)
- SQLite task storage
- Offline-friendly local setup

## Function scope (Phase A + Phase B)

Phase C is focused on hardening; no feature expansion:

- Text-to-video only
- No image-to-video
- No first/last frame conditioning
- No subject reference video

## Project structure

- `server/` - Express backend, MiniMax adapter, SQLite DB
- `web/` - Vite + React frontend
- `scripts/` - smoke test scripts
- `docs/` - deployment and phase reports
- Root configs: `.env.example`, `.nvmrc`, `package.json`

## Local development (multi-machine flow)

```bash
git clone <your-repo-url>
cd minimax-video-studio
nvm use   # or install the version in .nvmrc
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

## Scripts

- `npm run dev`
- `npm run dev:server`
- `npm run dev:web`
- `npm run build`
- `npm run start`
- `npm run smoke:video`

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

`npm run smoke:video` validates the API chain and writes:

- `docs/PHASE_A_API_SMOKE_REPORT.md`

Important:

- Real smoke test consumes MiniMax video quota.
- Default execution does **not** consume quota.
- Set `CONFIRM_REAL_VIDEO=1` to run real generation:

```bash
set CONFIRM_REAL_VIDEO=1
npm run smoke:video
```

(PowerShell: `$env:CONFIRM_REAL_VIDEO = "1"` )

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

## Roadmap

- Add image-to-video
- Add first-frame / last-frame mode
- Add subject reference
- Prompt template library
- Local gallery enhancements
- Tencent Cloud domain + HTTPS + reverse proxy in next phase
- Optional Docker packaging

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
  - any real server IPs/domains from local environment

## Limits

- This is a local MVP for personal usage and multi-machine continuation.
- It is intentionally minimal and safe by default; do not add unrequested features.
