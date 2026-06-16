# Phase N.0 — Tencent Cloud Deployment Preflight

> **Status**: PASS (local preflight complete; **remote preflight
> deferred** because the operator has not yet supplied a
> Tencent Cloud SSH alias / host / user)
> **Date**: 2026-06-16
> **Repo**: https://github.com/conanxin/minimax-video-studio
> **Tag**: `v0.2.1-alpha` (the recommended deployment baseline)
> **HEAD before Phase N.0**: `a3518bc`

---

## 1. What this phase did

Phase N.0 is a **preflight** phase. It does **not** deploy,
**not** start a long-running service, **not** modify any
remote configuration, **not** create any video task, and
**not** consume any video quota. The hard constraints from
the operator brief were:

- do not run `CONFIRM_REAL_VIDEO=1`
- do not run `CONFIRM_REAL_I2V=1`
- do not create a MiniMax video task
- do not call `/v1/video_generation`
- do not call MiniMax query / retrieve
- do not consume video quota
- do not modify Nginx / Caddy / Apache
- do not configure HTTPS / real domain / reverse proxy
- do not commit `.env`, SQLite, `logs/`, `node_modules/`,
  `dist/`
- do not output real `MINIMAX_API_KEY` / `SITE_PASSCODE` /
  `Authorization` header
- do not move any Git tag
- do not create a new tag

The phase's deliverables were:

1. Confirm the local repo is at a clean, deployable commit
   (`a3518bc`) on `main` with `v0.2.1-alpha` reachable.
2. Confirm whether the local machine has a Tencent Cloud
   SSH alias / host configured.
3. Confirm the local toolchain (node / npm / git) is
   consistent with the deployment-host expectations documented
   in `docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md`.
4. Identify the recommended deployment path
   (`~/apps/minimax-video-studio`) and confirm port `8789`
   is the intended bind.
5. Confirm `.env` will need to be filled in manually by the
   operator (`MINIMAX_API_KEY` + `SITE_PASSCODE`).
6. Emit a Phase N.1 minimum deployment plan, **deferred**
   until the operator supplies a real Tencent Cloud SSH
   target.
7. Add this report.
8. Push to `origin main` (no tag changes).

---

## 2. Local repo state (real, verified)

```text
$ git pull origin main
Already up to date.

$ git status --short
(empty)

$ git rev-parse --short HEAD
a3518bc

$ git tag --list | grep v0.2.1-alpha
v0.2.1-alpha

$ git ls-remote --tags origin | grep v0.2.1-alpha
4112da15f723ffc85975f12a6d96a98fd5aacf69  refs/tags/v0.2.1-alpha
96e9691a6cb4d34d769632b492308689ce0f3313  refs/tags/v0.2.1-alpha^{}
```

- HEAD: `a3518bc` (clean working tree, on `main`).
- Local tag: `v0.2.1-alpha` (annotated, peels to `96e9691`).
- Remote tag: `v0.2.1-alpha` (annotated, peels to `96e9691`).
- `v0.2.0-alpha` is unchanged, still pointing at `ada27c9`.

The once-only I2V lock is intact:

```text
-rw------- 1 conanxin conanxin 499 Jun 17 07:03 reports/local/i2v-real-smoke.lock
```

(size 499, mode 600, mtime `07:03`, content
`restored_by_phase_k: true`.)

---

## 3. Local toolchain (verified on this machine)

| Tool | Version |
| --- | --- |
| `node` | v25.8.1 |
| `npm` | 11.11.0 |
| `git` | 2.43.0 |

The Phase K runbook assumes `node >= 20` and `npm >= 10`.
The local toolchain exceeds the minimum. **The deployment
host's toolchain is what matters for Phase N.1**, not this
machine; this section is recorded for the operator's
reference and for the eventual Phase N.1 verification.

Local `node` is the fnm-managed `v25.8.1`. The Phase K
runbook recommends pinning the systemd `ExecStart` to an
**absolute path** for the deployment host, e.g.
`/home/<APP_USER>/.local/share/fnm/node-versions/v20.x.y/installation/bin/node`
or `/usr/bin/node` if a system package is preferred. The
exact pin is a Phase N.1 decision.

---

## 4. Local port 8789 status

```text
$ ss -ltn | grep ':8789'
(empty)
```

Port 8789 is **not** bound on this WSL host. That is
expected — this machine is the build/operator host, not the
deployment host. The deployment-host check is in §6 below
(deferred).

---

## 5. Recommended deployment version and path

- **Version**: `v0.2.1-alpha`. This is the recommended
  deployment baseline; `v0.2.0-alpha` is preserved for
  reproducibility of the Phase J.4 single-submit record.
  See `docs/RELEASE_NOTES_v0.2.1-alpha.md` and
  `docs/RELEASE_NOTES_v0.2.0-alpha.md` for the full
  rationale.
- **Repo URL** (HTTPS form, used for clone):
  `https://github.com/conanxin/minimax-video-studio.git`
- **Recommended deployment path on the CVM**:
  `~/apps/minimax-video-studio` (matches the Phase K
  runbook's section 1).
- **Bind port**: `8789` (matches `server/index.js` default;
  overridable via `PORT` env var).
- **Systemd unit name**: `minimax-video-studio.service`
  (user-mode; not system-mode, per the Phase K runbook
  placeholder).

---

## 6. Remote preflight (deferred)

The operator brief said: *"如果你已有腾讯云 SSH alias，请只
检查连接可用性，不要输出敏感信息"* and *"如果没有明确 SSH
alias 或 host：停止，回复我需要提供腾讯云 SSH alias /
host / user，不猜测服务器信息"*.

The local SSH configuration was inspected:

- `/home/conanxin/.ssh/config` contains exactly **one** Host
  block: `cloud-openclaw` (which points to a different
  OpenClaw deployment host — it is NOT a Tencent Cloud
  host and MUST NOT be used for minimax-video-studio
  preflight).
- `~/.ssh/known_hosts` contains 6 hashed entries (no
  plaintext hostnames visible).
- No `tencent*` / `qcloud*` / `cvm*` / `TENCENT*`
  environment variable is set.
- No documentation under `docs/` references a specific
  Tencent Cloud host, IP, or alias.

**Conclusion**: the operator has not (yet) supplied a
Tencent Cloud SSH alias, host, IP, or user. Phase N.0
therefore **defers the remote preflight** and does not
attempt any SSH connection to a guessed host.

When the operator provides a real SSH target, the following
remote checks should be run (per the operator brief, with
no sensitive output):

```bash
# 1. Basic identity / tooling
ssh <TENCENT_CLOUD_ALIAS_OR_HOST> \
  "hostname; pwd; node -v || true; npm -v || true; git --version || true; \
   systemctl --version | head -1 || true"

# 2. Target deployment path availability (DO NOT CLONE)
ssh <TENCENT_CLOUD_ALIAS_OR_HOST> \
  "test -d \$HOME/apps && test ! -e \$HOME/apps/minimax-video-studio \
   && echo 'path_available' || echo 'path_state:<reason>'"

# 3. Port 8789 collision check
ssh <TENCENT_CLOUD_ALIAS_OR_HOST> \
  "ss -ltnp 2>/dev/null | grep ':8789' || echo 'port_8789:free'"

# 4. Existing systemd unit check
ssh <TENCENT_CLOUD_ALIAS_OR_HOST> \
  "systemctl --user status minimax-video-studio.service 2>/dev/null \
   | head -10 || echo 'service:not_found'"
```

The "DO NOT CLONE" instruction is preserved: the preflight
is read-only. Cloning, `.env` creation, `npm install`,
`npm run build`, `npm run start`, and `systemctl enable`
all belong to Phase N.1, not Phase N.0.

---

## 7. `.env` requirement (manual, by the operator)

The deployment will need a `.env` file at
`~/apps/minimax-video-studio/.env` with two values:

- `MINIMAX_API_KEY=<operator-supplied, no Bearer prefix, no quotes>`
- `SITE_PASSCODE=<operator-chosen, e.g. 9 random chars>`

Both values are **operator-only**. They will not be
generated, suggested, or written by the deployment script.
This is by design and matches the Phase K runbook's
section 2 ("`cp .env.example .env`, `$EDITOR .env`, fill
in only the two values").

The deployment script must NOT be told either value at any
point.

---

## 8. Did this phase create or consume anything?

| Concern | Value |
| --- | --- |
| Real MiniMax video tasks created | **No** |
| Video quota consumed | **No** |
| `MINIMAX_API_KEY` / `Authorization` header / `SITE_PASSCODE` printed | **No** |
| `task_id` / `file_id` / `download_url` produced | **No** |
| `reports/local/i2v-real-smoke.lock` deleted or modified | **No** |
| Git tag moved or created | **No** |
| Remote server configuration modified | **No** |
| Nginx / Caddy / Apache touched | **No** |
| HTTPS / real domain / reverse proxy configured | **No** |
| `.env` written on the operator's machine | **No** |
| `.env` written on the deployment host | **No** (not attempted — no SSH target) |
| Clone performed on the deployment host | **No** (not attempted) |
| systemd unit enabled | **No** (not attempted) |

---

## 9. Phase N.1 minimum deployment plan (deferred)

This is the **plan**, not the execution. Phase N.0 does not
run any of it. Phase N.1 will run it, but only after the
operator supplies the SSH target and explicitly authorizes
deployment.

```bash
# === ON THE OPERATOR'S LOCAL MACHINE (this WSL host) ===
# (nothing to do here for Phase N.1 — all commands run on
# the deployment host via SSH)

# === ON THE DEPLOYMENT HOST (Tencent Cloud CVM) ===
# Pre-reqs (assumed by runbook): Ubuntu 22.04+ or 24.04,
# non-root user with sudo, basic build tools.

# 1. Clone at the recommended tag
git clone https://github.com/conanxin/minimax-video-studio.git \
  ~/apps/minimax-video-studio
cd ~/apps/minimax-video-studio
git checkout v0.2.1-alpha

# 2. Manual .env (operator fills in)
cp .env.example .env
chmod 600 .env
$EDITOR .env
#   set MINIMAX_API_KEY (no Bearer prefix, no quotes)
#   set SITE_PASSCODE (operator's choice, e.g. 9 random chars)

# 3. Verify auth-only before doing anything heavy
npm install
npm run check:minimax-auth
#   expect: auth_ok: yes

# 4. Build and dry-run smokes (offline, non-consuming)
npm run build
npm run fixture:i2v:validate   # expect: 10/10 PASS
npm run smoke:video            # expect: dry-run, real_quota_consumed: No
npm run smoke:i2v              # expect: dry_run_ok, fixture_validation: PASS
npm run check:api              # expect: 72/72 PASS

# 5. Start the service (systemd placeholder from Phase K runbook)
sudo systemctl daemon-reload
sudo systemctl enable minimax-video-studio.service
sudo systemctl start minimax-video-studio.service
sudo systemctl status minimax-video-studio.service
#   expect: active (running)

# 6. Health check
curl -i http://127.0.0.1:8789/api/health
#   expect: HTTP/1.1 200 OK
curl -i http://127.0.0.1:8789/api/tasks
#   expect: HTTP/1.1 401 Unauthorized
curl -i -H "x-site-passcode: <value>" \
  http://127.0.0.1:8789/api/tasks?limit=5
#   expect: HTTP/1.1 200 OK + JSON body

# 7. Stop / rollback (if needed)
sudo systemctl stop minimax-video-studio.service
# or: git checkout v0.2.0-alpha && npm install && npm run build \
#     && sudo systemctl restart minimax-video-studio.service
```

**Phase N.1 is deferred.** The operator must:

1. Provide a Tencent Cloud SSH alias (or host + user) so
   the remote preflight (§6) can be run.
2. Explicitly authorize Phase N.1 to execute the steps
   above.

Until both are present, Phase N.0 is the last phase
executed.

---

## 10. Sensitive-data audit

Phase N.0 inspected:

- The local repo's git state (HEAD, tags, working tree).
  No secrets, no real IDs.
- The local SSH `~/.ssh/config` for `Host` blocks.
  Inspected by alias name only; no hostnames, IPs, users,
  or identity file contents were read out.
- The local SSH `~/.ssh/known_hosts`. Hashed entries
  only; no plaintext hostnames extracted.
- The local environment for `TENCENT*` / `qcloud*` / `cvm*`
  variables. None present.
- The local toolchain versions (`node -v`, `npm -v`,
  `git --version`).
- The local `ss -ltn` for port 8789 (not bound; expected).

No `MINIMAX_API_KEY` / `Authorization` header /
`SITE_PASSCODE` / `task_id` / `file_id` / `download_url`
was read or output at any point. The `.env` file was not
opened. The local SQLite task store was not read.

---

## 11. Current blockers (operator action required)

1. **Tencent Cloud SSH target is missing.** Phase N.0 cannot
   preflight a remote host it cannot reach. The operator
   must supply one of:
   - A `Host <alias>` block in `~/.ssh/config` that points
     to the CVM (e.g. `Host tencent-cvm`), or
   - A direct host / user / IP / key path that the operator
     is willing to add to `~/.ssh/config`, or
   - An explicit decision to skip the remote preflight and
     go straight to Phase N.1 with the operator performing
     the preflight checks themselves.
2. **`.env` values are operator-only.** They will not be
   generated by the deployment script. The operator must
   fill `MINIMAX_API_KEY` and `SITE_PASSCODE` by hand in
   the editor step.
3. **The systemd unit file in the Phase K runbook uses
   placeholders.** The operator must replace `<APP_USER>`,
   `<APP_GROUP>`, and `<REPO_DIR>` (and optionally pin
   `ExecStart` to an absolute node binary path) before
   `systemctl daemon-reload`.

No other blockers are known. The local repo, the local
toolchain, and the local working tree are all in a state
where Phase N.1 can start as soon as the operator supplies
the SSH target and authorises the deployment.

---

## 12. Next steps (建议)

1. **Operator decision**: supply a Tencent Cloud SSH
   target. Once provided, Phase N.0 can be extended (or a
   new "Phase N.0b — Remote Preflight" can be created) to
   run the four read-only checks in §6. No code change is
   needed; the same script style is reused.
2. **Operator decision**: authorise Phase N.1. Phase N.1
   will execute the §9 plan against the supplied CVM. It
   will NOT configure Nginx / Caddy / HTTPS / a real
   domain. It will NOT modify the CVM's existing
   configuration files.
3. **Future phases** (only if requested): Phase O for
   reverse-proxy + HTTPS, Phase P for Docker packaging,
   Phase Q for CI/CD. None of these are in scope for
   Phase N.0 or N.1.
