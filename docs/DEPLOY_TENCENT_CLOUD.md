# Tencent Cloud Deployment (Generic)

This is a generic deployment document. Do not hardcode environment-specific values in code.

## 1) Prepare instance

```bash
sudo apt update
sudo apt install -y git
```

Use NVM and the version in `.nvmrc`.

## 2) Deploy

```bash
git clone <your_repo_url>
cd /path/to/minimax-video-studio
npm install
npm run build
cp .env.example .env
```

Edit `.env`:

```
MINIMAX_API_KEY=replace_with_your_minimax_token_plan_key
SITE_PASSCODE=change_me
PORT=8789
DATABASE_PATH=./data/minimax-video-studio.sqlite
MINIMAX_API_BASE=https://api.minimaxi.com
CONFIRM_REAL_VIDEO=0
```

```bash
npm run start
```

Check:
- `http://127.0.0.1:8789/api/health`
- Front page: `http://127.0.0.1:8789`

## 3) Optional systemd example

```ini
[Unit]
Description=MiniMax Video Studio
After=network.target

[Service]
Type=simple
User=your-linux-user
WorkingDirectory=/path/to/minimax-video-studio
EnvironmentFile=/path/to/minimax-video-studio/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 4) Notes

- Production domain + HTTPS + reverse proxy is intentionally out of scope for this MVP.
- Configure domain/proxy later in the next phase.
- Do not modify Caddy/Nginx/Apache files in this phase.
- Do not overwrite PORT; configure it in environment (`PORT`).
