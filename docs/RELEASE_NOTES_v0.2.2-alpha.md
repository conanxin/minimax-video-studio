# Release Notes — v0.2.2-alpha

## Summary

`v0.2.2-alpha` is a deployment-hardening baseline on top of
`v0.2.1-alpha`. It does not change any user-facing behaviour; it
tightens the deploy defaults so a freshly started process is not
exposed to the public network, and so the `/api/health` `version`
field actually reflects the deployed tag.

This is the **recommended tag for any new remote deployment**,
including the Tencent Cloud CVM brought up in Phase N.1.

## Why v0.2.2-alpha exists

Phase N.1 brought the service up on the Tencent Cloud CVM. Two
deficiencies were observed:

1. The Node server was bound on `*:8789` (all interfaces), so the
   process was reachable from the public internet subject only to
   the host firewall / security group. For a freshly cloned MVP,
   that is the wrong default — accidental misconfiguration of the
   firewall would expose the app immediately.
2. `/api/health` returned `version: "0.1.0"`, which was a stale
   literal in `server/index.js` and did not match the deployed tag.
   Health checks could not be used to confirm which release was
   actually running.

`v0.2.2-alpha` closes both gaps without touching the API surface.

## Changes

### Default bind host changed to `127.0.0.1`

- `server/index.js` now reads `HOST` from the environment, defaulting
  to `127.0.0.1` (loopback). Setting `HOST=0.0.0.0` (or any specific
  address) is the only way to bind to a public interface.
- The startup log now prints `MiniMax studio backend running on
  ${HOST}:${PORT}` so the operator can verify the actual bind.
- The systemd unit shipped with this release sets
  `Environment=HOST=127.0.0.1` explicitly, so the contract is
  visible at the unit level and survives process restarts.

### `HOST` env override supported

- Operators fronting the service with a reverse proxy can still set
  `HOST=0.0.0.0` (or a specific interface) when they need to. The
  override is intentional and documented.
- Recommended topology: reverse proxy listens on `:443` (HTTPS) and
  forwards to `127.0.0.1:8789`. The Node process keeps the loopback
  bind and only the proxy touches the public interface.

### Health version aligned through `APP_VERSION` / package version

- `server/index.js` reads `APP_VERSION` first, then falls back to
  `package.json` `version`, then to `"unknown"`.
- The systemd unit shipped with this release sets
  `Environment=APP_VERSION=v0.2.2-alpha`, so a `curl /api/health`
  from the operator immediately confirms which release is running.
- `package.json` `version` was bumped from `0.1.0` to `0.2.2-alpha`,
  so deployments that do not set `APP_VERSION` still report the
  correct version.

## Deployment note

This release is the recommended baseline for Tencent Cloud deployment.

```bash
# on the CVM (Ubuntu 22.04+ recommended)
ssh ubuntu@<cvm>
cd ~/apps/minimax-video-studio
git fetch --all --tags
git checkout v0.2.2-alpha
# operator edits ~/apps/minimax-video-studio/.env locally (chmod 600)
npm install
npm run build
npm run smoke:video       # dry-run
npm run smoke:i2v         # dry-run
npm run check:api         # offline regression
npm run check:minimax-auth

# systemd unit (this release pins HOST=127.0.0.1 and APP_VERSION)
systemctl --user daemon-reload
systemctl --user restart minimax-video-studio.service
curl -fsS http://127.0.0.1:8789/api/health
# expect: {"ok":true,"service":"minimax-video-studio","environment":"production","version":"v0.2.2-alpha"}
```

A future Phase O step will front this service with Caddy / Nginx
for HTTPS. Until then, do not open port 8789 to the public internet.

## Safety

- No real MiniMax video task was created during the production of
  this release.
- No quota was consumed. `npm run check:minimax-auth` issues a
  single `GET /v1/token_plan/remains` to confirm key reachability;
  it does not call `/v1/video_generation` or
  `/v1/image_to_video`.
- The once-only I2V real-smoke lock
  (`reports/local/i2v-real-smoke.lock`) is preserved across this
  release; the upgrade path does not delete or rewrite it.
- This release adds zero new external endpoints and changes no
  request or response shape; it is a drop-in replacement for
  `v0.2.1-alpha` from the API consumer's perspective.

## Upgrade from v0.2.1-alpha

```bash
cd ~/apps/minimax-video-studio
git fetch --all --tags
git checkout v0.2.2-alpha
npm install
npm run build
# edit your systemd unit to add:
#   Environment=HOST=127.0.0.1
#   Environment=APP_VERSION=v0.2.2-alpha
# then:
systemctl --user daemon-reload
systemctl --user restart minimax-video-studio.service
curl -fsS http://127.0.0.1:8789/api/health
```

`.env` schema is unchanged; `MINIMAX_API_KEY` and `SITE_PASSCODE`
continue to work. `data/minimax-video-studio.sqlite` is
forward-compatible — the schema has not changed.

## Verification snapshot (local pre-release)

| Check | Result |
| --- | --- |
| `npm install` | OK |
| `npm run fixture:i2v:validate` | 10/10 PASS (sha256[0:8] = `45583417`) |
| `npm run build` | OK (vite v5.4.21, 31 modules) |
| `npm run smoke:video` | dry-run, `real_quota_consumed: No` |
| `npm run smoke:i2v` | dry-run, `real_quota_consumed: No`, fixture validation PASS |
| `npm run check:api` | 72/72 PASS |
| `npm run check:minimax-auth` | `auth_ok: yes` |
