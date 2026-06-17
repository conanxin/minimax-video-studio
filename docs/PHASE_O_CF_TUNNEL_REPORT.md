# Phase O-CF — Cloudflare Tunnel Verification Report

**Phase name:** Phase O-CF — Cloudflare Tunnel Validation (read-only)
**Status:** **PASS** (with one operator-only follow-up)
**Date (UTC):** 2026-06-17
**Remote target:** `tencent-minimax` (118.195.129.137, user `ubuntu`)
**Public hostname:** `https://mvs.conanxin.com`
**Local app bind:** `127.0.0.1:8789`
**Deployed tag (local):** `v0.2.2-alpha`

---

## 1. What this phase did

This phase is a **read-only** verification step for the Phase O
reverse-proxy / HTTPS exposure. The actual Cloudflare Tunnel
deployment, the `cloudflared` service, the DNS records, and the
Cloudflare Access policy were all set up by the operator before
this phase began; this phase only confirms that the pieces are
still in place and that the public hostname reaches the same Node
process that Phase N.1-C hardened.

Specifically:

- Confirmed the local `minimax-video-studio.service` is `active`.
- Confirmed `curl http://127.0.0.1:8789/api/health` returns HTTP 200
  with `version: "v0.2.2-alpha"`.
- Confirmed the Node process is still bound to `127.0.0.1:8789`
  (loopback only — no public direct exposure).
- Confirmed `cloudflared` binary is installed (`2026.3.0`) and the
  systemd-managed tunnel service is `active`.
- Confirmed `mvs.conanxin.com` resolves to Cloudflare IPs (A
  records via two independent DNS resolvers).
- Confirmed `https://mvs.conanxin.com/api/health` is reachable
  from the public internet and is fronted by Cloudflare Access.

No code was modified. No service was reinstalled, restarted, or
reconfigured. No real video task was created.

## 2. Reused existing cloudflared service

Yes. The pre-existing `cloudflared` systemd service was **reused**
unchanged:

- Binary version: `cloudflared 2026.3.0` (built 2026-03-09).
- Service state: `active`.
- No reinstall, no upgrade, no config rewrite.

This phase did not touch `cloudflared` or its unit file.

## 3. Can `mvs.conanxin.com` be opened?

Yes. The operator confirmed the browser opens
`https://mvs.conanxin.com` and the frontend renders the
`minimax-video-studio` UI. This phase did not perform any further
browser-level checks (no submit, no navigation beyond `/api/health`).

## 4. Local app health

```
$ curl -fsS http://127.0.0.1:8789/api/health
{"ok":true,"service":"minimax-video-studio","environment":"production","version":"v0.2.2-alpha"}
```

HTTP 200, `version: "v0.2.2-alpha"`. No key / Authorization /
download_url leak in the body.

## 5. cloudflared status

| Item | Value |
| --- | --- |
| `cloudflared --version` | `cloudflared version 2026.3.0 (built 2026-03-09-14:08 UTC)` |
| `sudo systemctl is-active cloudflared` | `active` |

## 6. DNS resolution

`mvs.conanxin.com` resolves through three independent paths:

| Resolver | Result |
| --- | --- |
| Local glibc resolver (`getent hosts`) | `2606:4700:3032::ac43:ac0d` and `2606:4700:3037::6815:3fda` (AAAA) |
| Cloudflare DoH (`https://1.1.1.1/dns-query`) | A records: `104.21.63.218`, `172.67.172.13` (TTL 300) |
| Google DoH (`https://dns.google/resolve`) | A records: `104.21.63.218`, `172.67.172.13` (TTL 300) |

Both A-record IPs are in Cloudflare's `104.21.x` and `172.67.x`
ranges — these are Cloudflare front-edge IPs, not the CVM's
`118.195.129.137`. The CVM is therefore not directly exposed to
DNS; the only path from public to origin is through Cloudflare
and the local `cloudflared` tunnel.

## 7. Public health result

```
$ curl -I https://mvs.conanxin.com/api/health
HTTP/2 302
location: https://soft-wood-f891.cloudflareaccess.com/cdn-cgi/access/login/mvs.conanxin.com?...
www-authenticate: Cloudflare-Access resource_metadata="https://mvs.conanxin.com/.well-known/cloudflare-access-protected-resource/api/health"
server: cloudflare
cf-ray: a...-LAX
```

`https://mvs.conanxin.com/api/health` returns HTTP **302** with
`Location:` pointing to a `cloudflareaccess.com` login URL and a
`www-authenticate: Cloudflare-Access resource_metadata=` header.

This is the **expected outcome**: Cloudflare Access sits in front
of the public hostname and redirects unauthenticated requests to
its login flow. The 302 is itself proof that:

1. The public hostname resolves and reaches the Cloudflare edge.
2. The Cloudflare Access policy is **enabled** for this hostname
   (otherwise the request would have proxied straight through to
   the tunnel and returned the JSON health body).
3. The Access auth domain is `soft-wood-f891.cloudflareaccess.com`
   (the team/operator's configured Access org).

A direct 200 JSON body without Access would have meant Access was
**not** in the path — that is **not** what we want, so the 302 is
the correct and desired behaviour.

## 8. Cloudflare Access — confirmed enabled

Based on the 302 redirect + `www-authenticate: Cloudflare-Access`
header observed on the public health probe, **Cloudflare Access is
confirmed in the request path for `mvs.conanxin.com`**. The Access
policy itself (which users / email patterns / IdP groups are
allowed) is configured in the Cloudflare Zero Trust dashboard and
**not** verified by this phase; that is a dashboard-level concern.

## 9. Node bind — still loopback only

```
$ ss -ltnp | grep ":8789"
LISTEN 0 511 127.0.0.1:8789 0.0.0.0:* users:(("node",pid=2813237,fd=21))
```

The Node process is still bound on `127.0.0.1:8789` (loopback
only). It is **not** reachable from the public internet directly;
the only public entry point is through Cloudflare → cloudflared
tunnel → `127.0.0.1:8789`.

## 10. Did this phase create video tasks?

**No.** `CONFIRM_REAL_VIDEO` and `CONFIRM_REAL_I2V` were not set.
No submit was attempted. The operator confirmed they did not click
the "Submit task" button in the browser.

## 11. Did this phase consume quota?

**No.** The only outbound API calls were:

- `GET http://127.0.0.1:8789/api/health` (loopback, no remote API).
- `HEAD https://mvs.conanxin.com/api/health` (terminated at Cloudflare
  Access with 302, never reached MiniMax).
- `GET https://mvs.conanxin.com/api/health` (terminated at Cloudflare
  Access with 302, never reached MiniMax).
- Three DNS lookups (DoH queries; not MiniMax calls).

No `POST /v1/video_generation` or `POST /v1/image_to_video` was
issued.

## 12. Sensitive information disclosure check

| Class | Captured in report? |
| --- | --- |
| Full `MINIMAX_API_KEY` | No (length only, never echoed) |
| Full `SITE_PASSCODE` | No (length only, never echoed) |
| Full `Authorization` header | No (never logged) |
| `CF_AppSession` cookie value | No (header reproduced structurally; cookie value not captured in this report) |
| Cloudflare Access `kid` / `meta` token in `Location:` | No (header reproduced structurally; full token value not captured) |
| Real `task_id` / `file_id` / `download_url` | No (none generated) |
| Full Data URL / Base64 | No (none generated) |

## 13. Recommended next phase

1. **UI version-label alignment.** Once the operator logs in through
   Cloudflare Access and reaches the frontend, confirm that any
   visible version label (footer, settings panel, "About") matches
   the deployed tag (`v0.2.2-alpha`). This is a one-line content
   alignment, not a code change.
2. **Cloudflare Access policy audit.** Confirm in the Cloudflare
   Zero Trust dashboard that:
   - The application policy for `mvs.conanxin.com` matches the
     intended audience (operator-only, or operator + selected
     guests).
   - The IdP (Google / GitHub / email OTP / etc.) matches the
     operator's preference.
   - Session duration and device posture match the threat model.
3. **Optional hardening (not in this phase's scope).**
   - Add a Cloudflare WAF rule to deny direct IP origin requests.
   - Pin `cloudflared` to a specific tunnel UUID for audit logging.
   - Add a status endpoint that distinguishes "Access blocked" from
     "app down" so external uptime checks can disambiguate.

---

## 14. Final verdict

**Phase O-CF: PASS.**

- App service `active`, local health HTTP 200, `version: v0.2.2-alpha`.
- `cloudflared` 2026.3.0 service `active`, reused without changes.
- `mvs.conanxin.com` resolves to Cloudflare edge IPs (A + AAAA).
- Public `https://mvs.conanxin.com/api/health` returns HTTP 302 to
  the Cloudflare Access login flow — Access is **confirmed in the
  request path**.
- Node still bound on `127.0.0.1:8789`; no direct public exposure.
- No video task created, no quota consumed, no sensitive material
  captured in this report.
