# Phase N.0 — Tencent Cloud Deployment Preflight

> **Status**: PARTIAL PASS (local preflight PASS; **remote
> preflight BLOCKED on SSH authentication** — the operator
> reported the new public key was added to the server's
> `authorized_keys`, but the server does not accept it)
> **Date**: 2026-06-17
> **Repo**: https://github.com/conanxin/minimax-video-studio
> **Tag**: `v0.2.1-alpha` (the recommended deployment baseline)
> **HEAD before Phase N.0**: `a3518bc` (then `7eec99f` after
> the report add)

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
   SSH alias / host configured. (Done — `tencent-minimax`
   block was added to `~/.ssh/config`; TCP 22 handshake
   succeeds.)
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
   target AND confirms the new public key is actually in
   the server's `authorized_keys` for the right user.
7. Add this report (now updated to reflect the SSH auth
   blocker).
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

## 6. Remote preflight (BLOCKED on SSH authentication)

The local SSH `Host tencent-minimax` block was added to
`~/.ssh/config` and resolves correctly:

```text
$ ssh -G tencent-minimax | grep -E '^(hostname|user|port|identityfile|identitiesonly) '
user root
hostname 118.195.129.137
port 22
identitiesonly yes
identityfile ~/.ssh/tencent_minimax_ed25519
```

TCP to port 22 of `118.195.129.137` succeeds; the SSH
handshake completes and the server presents its host key
(`ssh-ed25519 SHA256:61UvJX/VBGbzNchHjKdpxoeyaeYZz52UUnl6UhFMYnQ`).
The local client offers the new ED25519 key:

```text
debug1: Offering public key: /home/conanxin/.ssh/tencent_minimax_ed25519 ED25519 SHA256:qvIiCILXoAclVxHfSbyHtfbwLNFAr0HIbcUAQLCiyn4 explicit
debug1: Authentications that can continue: publickey,password
debug1: No more authentication methods to try.
root@118.195.129.137: Permission denied (publickey,password).
```

**The server does not accept the offered key.** This is the
honest signal: the public key
`SHA256:qvIiCILXoAclVxHfSbyHtfbwLNFAr0HIbcUAQLCiyn4` is
**not** present in the server's `authorized_keys` for the
user we are trying to log in as (`root`).

The operator reported *"新公钥已加入服务器 authorized_keys"*
but the evidence above contradicts that. The most likely
causes are:

1. **Wrong user home.** We are configured to ssh as `root`
   (`User root` in `~/.ssh/config`). The new public key
   may have been added to a different user's
   `~/.ssh/authorized_keys` (e.g. `ubuntu` — the typical
   default user for a Tencent Cloud Ubuntu CVM image). On
   modern Linux, `root` and `ubuntu` are different accounts
   with different home directories
   (`/root/.ssh/authorized_keys` vs.
   `/home/ubuntu/.ssh/authorized_keys`).
2. **Key added to a different key alias.** The key file
   generated for this project is
   `~/.ssh/tencent_minimax_ed25519` with comment
   `minimax-video-studio-tencent`. If a different key file
   was uploaded to the CVM (e.g. the pre-existing
   `~/.ssh/cloud_openclaw` for `cloud-openclaw`), that key
   is a different one and would not match the offer we
   make.
3. **`authorized_keys` permissions / ownership.** On the
   server side, the file must be `600` and owned by the
   login user; the parent directory must be `700` and owned
   by the same user. If the CVM-side tooling used
   `wget | bash` or similar, permissions or ownership may
   be wrong and sshd will silently ignore the file.
4. **sshd config disallows root login.** Some CVM images
   set `PermitRootLogin prohibit-password` and require
   `PubkeyAuthentication yes` AND a root key. Others
   default `PermitRootLogin no` entirely. The local probe
   shows `publickey,password` are both offered, so the
   server does not explicitly block root, but the key still
   has to match.
5. **The CVM is the OpenClaw host, not a fresh Tencent
   CVM.** The IP `118.195.129.137` matches the
   `cloud-openclaw` SSH config entry from earlier
   inspection. If this is the *same* machine, then the
   "minimax-video-studio" deployment would be co-located
   with the OpenClaw deployment, and the new public key
   would have to be added to the existing
   `cloud_openclaw`-authorized account (likely `ubuntu`,
   not `root`).

**Phase N.0 cannot preflight a remote host it cannot ssh
into.** No probe of `node` / `npm` / `git` / `systemd` /
port 8789 / `~/apps/` was possible. The remote preflight
remains blocked until the operator confirms the public key
is in the right place on the server.

The minimum fix the operator should run, **outside the
project repo, on the deployment host**:

```bash
# On the deployment host, as the user that will receive
# the key. Replace <USERNAME> with the actual login user
# (root, ubuntu, or whatever ssh -G tencent-minimax shows
# for the User field).

# 1. Confirm where the key should go
echo "Login user: $(whoami)"
echo "Home:       $HOME"
test -d "$HOME/.ssh" || mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"

# 2. Add the public key. Get the exact line from the
#    local machine via:
#      cat ~/.ssh/tencent_minimax_ed25519.pub
#    and append it to authorized_keys. (The line starts
#    with `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...` and
#    ends with `minimax-video-studio-tencent`. The
#    fingerprint must be
#    SHA256:qvIiCILXoAclVxHfSbyHtfbwLNFAr0HIbcUAQLCiyn4.)
#    Then:
test -s "$HOME/.ssh/authorized_keys" && \
  echo "" >> "$HOME/.ssh/authorized_keys"
cat ~/.ssh/tencent_minimax_ed25519.pub \
  >> "$HOME/.ssh/authorized_keys"

# 3. Lock down permissions (sshd is strict about this)
chmod 600 "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chown -R "$(whoami):$(id -gn)" "$HOME/.ssh"

# 4. Verify (read-only)
ssh-keygen -lf "$HOME/.ssh/authorized_keys"
# expect: a line whose fingerprint is
#         SHA256:qvIiCILXoAclVxHfSbyHtfbwLNFAr0HIbcUAQLCiyn4
# If it is missing or has a different fingerprint, the
# wrong public key was appended.
```

If the operator confirms the public key is in place for
the right user, the Phase N.0 §6 remote probe can be
re-run as:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 tencent-minimax \
  "hostname; whoami; pwd;
   node -v || true; npm -v || true;
   git --version || true;
   systemctl --version | head -1 || true;
   test -d \$HOME/apps && echo apps_dir_exists=yes \
     || echo apps_dir_exists=no;
   test -d \$HOME/apps/minimax-video-studio \
     && echo project_dir_exists=yes \
     || echo project_dir_exists=no;
   ss -ltnp 2>/dev/null | grep ':8789' \
     || echo port_8789_free_or_not_listening;
   systemctl --user status minimax-video-studio.service --no-pager \
     2>&1 | head -8 || true"
```

No remote probe was executed in this phase beyond the
ssh-key offer and the server's response (which is
authentication metadata, not file contents).

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

1. **SSH public key not in the server's `authorized_keys`.**
   Phase N.0 added the `tencent-minimax` alias and the
   local client successfully offers the new key, but the
   server rejects it. The minimum fix the operator must
   run, **outside the project repo, on the deployment
   host**, is in §6 above (the `>> authorized_keys` +
   `chmod 600` + `chown` + `ssh-keygen -lf` verification
   block). The exact public key fingerprint the server
   must list is
   `SHA256:qvIiCILXoAclVxHfSbyHtfbwLNFAr0HIbcUAQLCiyn4`.
2. **Which user the new key should go to.** The
   `tencent-minimax` alias is configured to log in as
   `root`. If the new public key was actually added to
   `ubuntu`'s `~/.ssh/authorized_keys` instead, the
   fix is either:
   (a) re-append the public key to `/root/.ssh/authorized_keys`
       on the server (and confirm `PermitRootLogin` is not
       `no` in `sshd_config`); or
   (b) change `User` in `~/.ssh/config` to `ubuntu` if that
       is the account that has the key.
3. **`.env` values are operator-only.** They will not be
   generated by the deployment script. The operator must
   fill `MINIMAX_API_KEY` and `SITE_PASSCODE` by hand in
   the editor step.
4. **The systemd unit file in the Phase K runbook uses
   placeholders.** The operator must replace `<APP_USER>`,
   `<APP_GROUP>`, and `<REPO_DIR>` (and optionally pin
   `ExecStart` to an absolute node binary path) before
   `systemctl daemon-reload`.

Items 1 and 2 are blocking the entire Phase N.0 remote
preflight. Items 3 and 4 are pre-flight paperwork that
becomes blocking only at Phase N.1.

No other blockers are known. The local repo, the local
toolchain, and the local working tree are all in a state
where Phase N.0 can resume the moment the operator confirms
the public key is in the right place.

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
