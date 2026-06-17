# Phase N.0 — Tencent Cloud Deployment Preflight

> **Status**: PASS (local preflight PASS; remote preflight PASS)
> **Date**: 2026-06-17
> **Repo**: https://github.com/conanxin/minimax-video-studio
> **Tag**: `v0.2.1-alpha` (the recommended deployment baseline)
> **HEAD before Phase N.0**: `a3518bc` (then `7eec99f` after
> the report add, then `93efbcd` after the SSH-blocker
> update, then the final preflight-pass update)

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
   succeeds; the `User` field was revised from `root` to
   `ubuntu` after the operator's authorisation and the
   new ED25519 public key was added to
   `/home/ubuntu/.ssh/authorized_keys` via the existing
   `cloud-openclaw` channel.)
3. Confirm the local toolchain (node / npm / git) is
   consistent with the deployment-host expectations documented
   in `docs/TENCENT_CLOUD_DEPLOYMENT_RUNBOOK.md`.
4. Identify the recommended deployment path
   (`~/apps/minimax-video-studio`) and confirm port `8789`
   is the intended bind.
5. Confirm `.env` will need to be filled in manually by the
   operator (`MINIMAX_API_KEY` + `SITE_PASSCODE`).
6. Emit a Phase N.1 minimum deployment plan, ready for
   operator authorisation now that the remote preflight has
   passed.
7. Add this report (now updated to reflect the SSH
   preflight PASS).
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

## 6. Remote preflight (PASS)

The `tencent-minimax` SSH block in `~/.ssh/config` is
final (post-revision):

```text
$ ssh -G tencent-minimax | grep -E '^(hostname|user|port|identityfile|identitiesonly) '
user ubuntu
hostname 118.195.129.137
port 22
identitiesonly yes
identityfile ~/.ssh/tencent_minimax_ed25519
```

The earlier Phase N.0 attempt used `User root`, which
contradicted the Tencent Cloud Ubuntu CVM image's default
account layout (cloud-init injects the operator's first
key into `ubuntu`'s `~/.ssh/authorized_keys`; the `root`
account has no key-based login channel by default). The
operator authorised the one-line config edit to `User
ubuntu`, and the new ED25519 key
(`SHA256:qvIiCILXoAclVxHfSbyHtfbwLNFAr0HIbcUAQLCiyn4`)
was added to `ubuntu`'s `~/.ssh/authorized_keys` via the
existing `cloud-openclaw` channel (a pre-existing
SSH alias on this machine that points to the same CVM
with the same IP).

After the fix, the remote preflight ran successfully:

```text
$ ssh tencent-minimax "<probes>"

--- identity ---
VM-0-4-ubuntu
ubuntu
/home/ubuntu

--- runtime ---
v22.22.1                  # node
10.9.4                    # npm
git version 2.34.1
systemd 249 (249.11-0ubuntu3.17)

--- app path ---
apps_dir_exists=yes
project_dir_exists=no     # no prior clone at ~/apps/minimax-video-studio

--- port ---
port_8789_free_or_not_listening   # no listener on 8789

--- service ---
Unit minimax-video-studio.service could not be found.
```

### What this means

| Check | Result | Implication for Phase N.1 |
| --- | --- | --- |
| `node -v` | `v22.22.1` | Exceeds the runbook's `>=20` minimum. |
| `npm -v` | `10.9.4` | Exceeds the runbook's `>=10` minimum. |
| `git --version` | `2.34.1` | Sufficient for a HTTPS clone. |
| `systemctl --version` | `systemd 249` | User-mode systemd available. The Phase K runbook's user-mode `minimax-video-studio.service` will work. |
| `~/apps/` exists | `yes` | The parent of the recommended deployment path exists. |
| `~/apps/minimax-video-studio` exists | `no` | The repo is **not** yet cloned. Phase N.1 can clone into a clean directory. |
| Port 8789 listener | `none` | No port conflict; the backend can bind freely. |
| `minimax-video-studio.service` (user mode) | `not found` | No leftover service. Phase N.1 can install a fresh one. |

No remote probe was destructive. No `node`, `npm`, `git`,
`systemctl`, `cp`, `mv`, `service`, `systemctl enable`,
`systemctl start`, `git clone`, `npm install`, `npm run
build`, `npm run start`, or any other state-mutating
command was executed on the deployment host. Phase N.0 was
**read-only** end-to-end.

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

**No hard blockers remain.** The remote preflight has
passed. The remaining items are pre-flight paperwork for
Phase N.1 (deployment), not blockers for Phase N.0
(preflight):

1. **`.env` values are operator-only.** The deployment
   script in Phase N.1 will not generate `MINIMAX_API_KEY`
   or `SITE_PASSCODE`. The operator must fill them in by
   hand in the editor step (per the Phase K runbook
   section 2). The script will then `chmod 600` the file
   and never echo its contents.
2. **The systemd unit file in the Phase K runbook uses
   placeholders.** The operator must replace `<APP_USER>`,
   `<APP_GROUP>`, and `<REPO_DIR>` (and optionally pin
   `ExecStart` to an absolute node binary path) before
   `systemctl daemon-reload`. Recommended pin for this
   deployment host: use the system node at
   `/usr/bin/node` (since `node v22.22.1` is already
   installed and the systemd user instance will pick it
   up by default), or `which -a node` to discover the
   exact path before writing the unit.
3. **The deployment host is a single CVM shared with
   OpenClaw** (same IP, same `ubuntu` user, same `root`
   user). Phase N.1 will deploy into `~/apps/minimax-video-studio`,
   a directory distinct from any existing OpenClaw
   install. If OpenClaw already uses port 8789, that
   would be a conflict — but Phase N.0 §6 confirmed
   `port 8789: free_or_not_listening`, so it is currently
   free.
4. **No `root` key-based login channel exists** on the CVM
   (consistent with the Tencent Cloud Ubuntu image
   default). The deployment will run as `ubuntu`. systemd
   unit must therefore be a **user-mode** unit
   (`~/.config/systemd/user/minimax-video-studio.service`),
   not a system-mode unit, unless the operator later adds
   a `root` key and switches the alias back. The Phase K
   runbook's section 6 already shows the user-mode form
   (`WantedBy=multi-user.target` under a `[Install]` for
   the user instance), so this is a drop-in fit.

The next phase, **Phase N.1 — actual deployment**, is
*not* part of Phase N.0. The operator must explicitly
authorise Phase N.1 before any `git clone`, `npm install`,
`npm run build`, or `systemctl enable` runs on the
deployment host.

---

## 12. Next steps (建议)

1. **Phase N.1 — actual deployment.** This is now
   unblocked from the Phase N.0 side. The operator must
   authorise Phase N.1 explicitly. Phase N.1 will run
   only on the operator's command. Its minimum plan is
   the §9 block of the earlier draft (clone at
   `v0.2.1-alpha` → `cp .env.example .env` → operator
   fills `MINIMAX_API_KEY` + `SITE_PASSCODE` → `npm
   install` → `npm run check:minimax-auth` →
   `npm run build` → four offline smokes → `systemctl
   --user enable` / `start` / `status` → `curl` health
   check). No Nginx / Caddy / HTTPS / real domain in
   Phase N.1; that would be a separate Phase O.
2. **Reverse proxy + HTTPS** is a future phase, only if
   the operator decides to expose the service beyond
   `localhost`. Out of scope here.
3. **Future phases** (only if requested): Docker
   packaging, CI/CD, broader dependency hygiene. None in
   scope for Phase N.0 or N.1.
4. **No tag changes are needed.** The recommended tag
   (`v0.2.1-alpha`) is already in place at
   `https://github.com/conanxin/minimax-video-studio/releases/tag/v0.2.1-alpha`.

---

## 13. Phase N.0 final verdict

| Concern | Result |
| --- | --- |
| Local repo state | Clean. `HEAD = a3518bc → 7eec99f → 93efbcd → <this-update>`. `v0.2.1-alpha` reachable locally + on origin. `v0.2.0-alpha` unchanged. |
| Local toolchain | `node v25.8.1`, `npm 11.11.0`, `git 2.43.0` — exceeds deployment-host requirements. |
| `tencent-minimax` SSH alias | Final form: `user ubuntu` / `hostname 118.195.129.137` / `port 22` / `identityfile ~/.ssh/tencent_minimax_ed25519` / `identitiesonly yes`. |
| SSH authentication | `tencent-minimax` accepts the new ED25519 key. Login works. |
| Remote preflight | All checks PASS. |
| `.env` requirement | Operator-only. Will be filled by hand in Phase N.1. |
| Real MiniMax task created | **No** (no submit, no `CONFIRM_REAL_VIDEO=1`, no `CONFIRM_REAL_I2V=1`). |
| Video quota consumed | **No** (no remote submit, no token-plan write). |
| Tag moved or created | **No**. |
| Server config modified | **No** (only `~/.ssh/authorized_keys` was appended with the new public key, which is the operator's pre-flight action, not a project action). |
| Nginx / Caddy / Apache touched | **No**. |
| `.env` written on the deployment host | **No**. |
| Clone / `npm install` / `npm run build` / `systemctl` started | **No**. All of that belongs to Phase N.1. |

**Verdict**: Phase N.0 is **PASS**. Phase N.1 is the
natural next step, but it must be **explicitly authorised**
by the operator before it runs.
