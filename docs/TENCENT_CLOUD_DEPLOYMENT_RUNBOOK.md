# Tencent Cloud CVM Deployment Runbook (v0.2.0-alpha)

> **Status**: Operator-facing, copy-pasteable, placeholder-grade.
> **Scope**: Single Tencent Cloud CVM (Ubuntu / Debian), local
> `localhost`-only exposure, **no** reverse proxy, **no** HTTPS,
> **no** real domain, **no** Nginx / Caddy / Apache.
> **Repo**: https://github.com/conanxin/minimax-video-studio
> **Tag**: `v0.2.0-alpha`

This runbook intentionally stops short of public-internet exposure.
Fronting the service with a reverse proxy + HTTPS is a separate phase
and **not** in scope for v0.2.0-alpha. Treat this as a "get the
service running on a private CVM" recipe.

---

## 0. What you need

- A Tencent Cloud CVM (any 2 vCPU / 2 GB / 40 GB shape is plenty;
  this MVP is small). Public or private IP is fine — the service
  will only listen on the CVM's loopback for now.
- A working user that can `sudo` once, then run the service as a
  non-root user.
- A MiniMax Token Plan **API Key** (Bearer-style, no `Bearer`
  prefix, no surrounding quotes). **Never** commit it. **Never**
  paste it into a chat. **Never** include it in a runbook.
- A passcode of your choice for the local web UI (e.g. a random
  9-character string).

> All `<PLACEHOLDER>` strings in this runbook are YOUR values.
> They are NOT real, they are not committed anywhere, and you must
> replace them locally with your own.

---

## 1. Clone the repository

```bash
# Use YOUR username / SSH alias here. Replace with the HTTPS form
# if you prefer not to set up SSH keys.
git clone https://github.com/conanxin/minimax-video-studio.git
cd minimax-video-studio
git checkout v0.2.0-alpha
```

Verify the tag points where the release notes say it does:

```bash
git rev-parse --short HEAD           # expect: ada27c9 (or the actual v0.2.0-alpha commit)
git describe --tags --exact-match    # expect: v0.2.0-alpha
```

---

## 2. Create `.env` (manually)

```bash
cp .env.example .env
chmod 600 .env
$EDITOR .env
```

Fill in **only** the two values below. Leave the rest at the
defaults in `.env.example`.

```dotenv
# .env (gitignored, never commit)
MINIMAX_API_KEY=<your-minimax-token-plan-key-here>
SITE_PASSCODE=<your-9-char-passcode>
```

Hard rules:

- Do NOT prefix the key with `Bearer ` — the server adds that
  prefix on its own.
- Do NOT wrap the key in quotes.
- Do NOT include trailing whitespace or newlines inside the value.
- Do NOT commit `.env`. It is in `.gitignore` and must stay there.

Verify the file exists and is permission-locked:

```bash
ls -la .env
# expect: -rw------- 1 <user> <user> ... .env
```

Verify the server can read it (no value will be printed):

```bash
npm run check:minimax-auth
# expect: auth_ok: yes
# expect: no full key in the output
```

If `auth_ok` is `no`, fix `.env` (most common cause: an
accidental `Bearer ` prefix or a stale key). Do **not** continue
to step 3 until `auth_ok: yes`.

---

## 3. Install + build

```bash
npm install
npm run build
```

`npm run build` produces `dist/index.html` + `dist/assets/*`. The
backend (`server/index.js`) does **not** need the build output to
start, but the production frontend bundle does. If you skip
`npm run build`, the dev server still works for local poking.

---

## 4. Smoke before exposing anything

These are all dry-run. None of them calls `/v1/video_generation`
and none of them consumes video quota.

```bash
npm run fixture:i2v:validate   # expect: 10/10 PASS
npm run smoke:video            # expect: dry-run, real_quota_consumed: No
npm run smoke:i2v              # expect: dry_run_ok, fixture_validation: PASS
npm run check:api              # expect: 68/71 PASS (3 known-limit FAILs, see release notes)
```

If any of the four does not match the expectation, stop. The most
likely cause is a missing or wrong `MINIMAX_API_KEY` in `.env`.
Do **not** start the service in a broken state.

---

## 5. Start the service (foreground, for the first time)

```bash
npm run start
# expect: "MiniMax studio backend running on :8789"
# expect: "Health check: http://localhost:8789/api/health"
```

In another shell, on the **same** CVM:

```bash
curl -i http://localhost:8789/api/health
# expect: HTTP/1.1 200 OK

curl -i http://localhost:8789/api/tasks
# expect: HTTP/1.1 401 Unauthorized

curl -i -H "x-site-passcode: <your-9-char-passcode>" \
  http://localhost:8789/api/tasks?limit=5
# expect: HTTP/1.1 200 OK + a JSON body
```

If all three match, the service is healthy. **Stop the foreground
process** (Ctrl-C) before moving to the systemd step. You will
not run `npm run start` under your interactive shell in
production.

---

## 6. systemd unit (placeholder-grade)

This unit is intentionally minimal. It does **not** enable a
reverse proxy, does **not** request a certificate, and does
**not** open any inbound port beyond `127.0.0.1:8789`.

Replace the placeholders with your own values:

- `<APP_USER>` — the non-root user that owns the cloned repo
- `<APP_GROUP>` — usually the same as `<APP_USER>`
- `<REPO_DIR>` — absolute path to the cloned repo, e.g.
  `/home/ubuntu/minimax-video-studio`

Create `/etc/systemd/system/minimax-video-studio.service`:

```ini
[Unit]
Description=minimax-video-studio (v0.2.0-alpha)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<APP_USER>
Group=<APP_GROUP>
WorkingDirectory=<REPO_DIR>
EnvironmentFile=<REPO_DIR>/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node server/index.js
Restart=on-failure
RestartSec=5
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=<REPO_DIR>/data <REPO_DIR>/reports /tmp
# Limit accidental large writes
MemoryMax=512M
TasksMax=256

[Install]
WantedBy=multi-user.target
```

> ⚠️ Path / version notes:
> - `/usr/bin/env node` will resolve to whichever `node` is on the
>   PATH of `<APP_USER>`. If you used `fnm` / `nvm`, set
>   `Environment=NODE_ENV=production` and use the absolute path
>   to that node (e.g.
>   `/home/<APP_USER>/.local/share/fnm/node-versions/v20.x.y/installation/bin/node`).
> - `ProtectSystem=strict` is fine here because the service
>   only writes to `data/` and `reports/`, both of which are
>   explicitly `ReadWritePaths`.
> - `MemoryMax=512M` is generous for this MVP. Tighten it once
>   you have observed steady-state RSS.

Enable + start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable minimax-video-studio.service
sudo systemctl start minimax-video-studio.service
sudo systemctl status minimax-video-studio.service
# expect: active (running)
```

---

## 7. Health check from a sidecar / cron / oncall

The simplest health check is a curl on the loopback. Example
shell snippet you can drop into a 1-minute cron or a one-shot
script:

```bash
curl -fsS http://127.0.0.1:8789/api/health \
  || echo "minimax-video-studio health check FAILED at $(date -Iseconds)"
```

If you want a richer probe, hit `/api/tasks` with the passcode
and assert the response is a JSON object with a `tasks` array and
a `pagination` block. Do **not** hit `/v1/video_generation` from
a health check — that would consume quota.

---

## 8. Out of scope (do NOT do these in v0.2.0-alpha)

- ❌ Expose `:8789` to the public internet directly.
- ❌ Configure Nginx / Caddy / Apache reverse proxy in front of
  the service. This is a future phase and **not** in scope.
- ❌ Apply for or configure a real domain.
- ❌ Request a Let's Encrypt certificate.
- ❌ Modify any pre-existing system service (Caddy / Nginx /
  Apache / SSHD / firewalld / iptables / ufw) on the CVM.
- ❌ Run a real MiniMax smoke (`CONFIRM_REAL_VIDEO=1` or
  `CONFIRM_REAL_I2V=1`) from the deployment script.
- ❌ Commit `.env` or any of the real `task_id` / `file_id` /
  `download_url` produced by a real smoke.

If you need any of the above, open a new phase brief and get
explicit operator authorization first.

---

## 9. What "success" looks like

You have a green deployment when:

1. `systemctl status minimax-video-studio.service` shows
   `active (running)`.
2. `curl -i http://127.0.0.1:8789/api/health` returns 200.
3. `curl -i http://127.0.0.1:8789/api/tasks` returns 401.
4. `curl -i -H "x-site-passcode: <your-passcode>" http://127.0.0.1:8789/api/tasks?limit=5`
   returns 200 with a JSON body whose `tasks` is an array and
   whose `pagination` has `total` / `limit` / `offset`.
5. `npm run check:minimax-auth` shows `auth_ok: yes`.
6. No real MiniMax task has been submitted from this CVM unless
   the operator explicitly authorized a Phase J.4-style
   controlled real smoke (which is **not** part of the
   deployment).

---

## 10. Rollback

The deployment is "just a systemd unit pointing at a git checkout."
Rollback is:

```bash
sudo systemctl stop minimax-video-studio.service
git fetch --tags origin
git checkout v0.1.0-alpha
npm install
npm run build
sudo systemctl start minimax-video-studio.service
sudo systemctl status minimax-video-studio.service
```

If you also want to drop the unit entirely:

```bash
sudo systemctl disable --now minimax-video-studio.service
sudo rm /etc/systemd/system/minimax-video-studio.service
sudo systemctl daemon-reload
```

The local SQLite task store and the gitignored `reports/local/`
files are **not** rolled back by this — they are operator-local
and are the operator's responsibility.
