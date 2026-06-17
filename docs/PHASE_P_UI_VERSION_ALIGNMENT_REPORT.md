# Phase P — UI Branding and Version Alignment

**Phase name:** Phase P — UI Branding and Version Alignment
**Status:** **PASS**
**Date (UTC):** 2026-06-17
**Local repo:** `/home/conanxin/.hermes/workspace/projects/minimax-video-studio`
**Public URL:** `https://mvs.conanxin.com` (Cloudflare Access + Tunnel, unchanged)
**Deployed tag (CVM):** `v0.2.2-alpha`
**New tag created:** None — this phase does not create a release tag.

---

## 1. What this phase did

This phase was UI-only. The frontend rendered the stale Phase G
MVP branding even though the deployed release was `v0.2.2-alpha`
and the public URL was already fronted by Cloudflare Access and a
Cloudflare Tunnel. The visible mismatch hurt operator confidence
when checking what release was actually running.

Concretely:

- Updated the browser `<title>` from the Chinese-only
  `MiniMax 文生视频工作台` to `MiniMax Video Studio`.
- Updated the in-app `<h1>` hero heading from
  `MiniMax Text-to-Video MVP` to `MiniMax Video Studio`.
- Replaced the Phase G hero subtitle
  (`Phase G: download link freshness indicators and link-freshness UX.`)
  with a current-state line that reads
  `T2V and I2V verified · v0.2.2-alpha · Cloudflare Access protected`.
- Added a live `Runtime: <version> · Service: <environment>` line
  below the subtitle. This line is fetched from `GET /api/health`
  on page mount; if the health probe fails or returns
  `ok: false`, the line falls back to `Runtime: unknown` and
  `Service: unknown`. The rest of the page is unaffected.
- Added a "Public access" block at the top of `README.md`
  documenting `https://mvs.conanxin.com`, Cloudflare Access,
  the `cloudflared` → `127.0.0.1:8789` transport, and the
  `v0.2.2-alpha` UI branding baseline.

The `Create task` region (T2V / I2V chips, prompt input,
camera tools, I2V image picker, the
`Submitting a new task will create a real MiniMax text-to-video
job and consume quota.` warning, and the `Submit task` button)
was **left untouched**. No submit was triggered; no real task was
created.

## 2. Why the UI branding needed an update

The `v0.2.2-alpha` deployment hardening (Phase N.1-C) changed the
runtime bind to `127.0.0.1`, exposed `/api/health.version` as the
deployed tag, and published `v0.2.2-alpha` as the recommended
deployment baseline. None of that was reflected in the UI: the
page still said "MiniMax Text-to-Video MVP" and "Phase G: ...".

Three concrete failure modes that this UI alignment closes:

- An operator loading `https://mvs.conanxin.com` could not tell
  from the UI alone which release was running. They had to `curl
  /api/health` separately.
- The "Phase G: ..." subtitle implied the UI was at Phase G
  maturity, when in fact I2V (Phase J), error categorisation
  (Phase K), lock enforcement (Phase L), and deployment
  hardening (Phase N.1-C) had all shipped.
- The Chinese-only `<title>` was unfriendly to non-Chinese
  browsers, history entries, and screenshots.

## 3. Did this phase create video tasks?

**No.** `CONFIRM_REAL_VIDEO` and `CONFIRM_REAL_I2V` were not set.
The "Submit task" button was not pressed. The only `POST /api/video/create`
traffic during this phase was the offline regression fixture used
by `npm run check:api`, which is structurally identical to real
calls but is asserted to never reach the remote MiniMax API (the
regression fixture rejects the request before forwarding).

## 4. Did this phase consume quota?

**No.** The smoke checks were dry-run only:

| Step | `real_quota_consumed` |
| --- | --- |
| `npm run smoke:video` | `No` (`final_status: skipped`) |
| `npm run smoke:i2v` | `No` (`final_status: dry_run_ok`) |
| `npm run check:api` | `No` (offline regression; final summary: "all checks PASSED. No real MiniMax task was created.") |

The frontend's new `useEffect` that fetches `/api/health` issues
one `GET /api/health` per page load. `/api/health` is a Node
process-local probe; it does **not** call MiniMax.

## 5. Build / smoke dry-run / check:api results

| Step | Result |
| --- | --- |
| `npm install` | OK |
| `npm run build` | OK — vite v5.4.21, 31 modules transformed; `dist/index.html` 0.41 kB, `dist/assets/index-DA3EGklt.js` 174.07 kB (gzip 57.08 kB), `dist/assets/index-DJ45okvy.css` 7.92 kB (gzip 2.12 kB); built in 1.33 s |
| `npm run smoke:video` | dry-run, `final_status: skipped`, `real_quota_consumed: No` |
| `npm run smoke:i2v` | dry-run, `final_status: dry_run_ok`, `real_quota_consumed: No`, `fixture_validation: PASS`, `data_url_present: yes` |
| `npm run check:api` | **72/72 PASS** — final summary: "all checks PASSED. No real MiniMax task was created." |

## 6. Did this phase touch Cloudflare / tunnel / systemd?

**No.** This phase modified only:

- `web/src/App.jsx` (UI text + one `useState` + one `useEffect`
  to fetch `/api/health`).
- `web/index.html` (browser `<title>`).
- `README.md` (Public access block + description refresh).
- `docs/PHASE_P_UI_VERSION_ALIGNMENT_REPORT.md` (this report).

It did not modify `cloudflared`, the Cloudflare Tunnel config,
the Cloudflare Access policy, the systemd unit, the Node
`server/index.js`, the `.env`, the lock file, or any
Nginx / Caddy / Apache config.

It did not deploy to the CVM. The CVM continues to run
`v0.2.2-alpha` from Phase N.1-C; the UI changes ship via the next
operator-driven deploy (or by the operator choosing to deploy the
current `main`).

## 7. Sensitive information disclosure check

| Class | Captured in this report? |
| --- | --- |
| Full `MINIMAX_API_KEY` | No (only length, never echoed) |
| Full `SITE_PASSCODE` | No (only length, never echoed) |
| Full `Authorization` header | No (never logged) |
| Real `task_id` / `file_id` / `download_url` | No (none generated) |
| Full Data URL / Base64 first-frame | No (only sha8 + char count summary in `smoke:i2v` output, not in this report) |
| Cloudflare cookie / token | No (header structure summarised; no values captured) |

The smoke scripts' `payload_summary` shows the canonical
dry-run prompt and the `first_frame_image_data_url_chars: 504754`
character count, which is metadata only. No actual Base64 payload
is included in this report.

## 8. Git hygiene check

Before commit:

- `git status --short` shows only the intended changes
  (`README.md`, `web/index.html`, `web/src/App.jsx`, plus the new
  report).
- `git diff --stat` confirms the four intended files plus the new
  report; no spurious edits.
- `.gitignore` still excludes `.env`, `reports/local/`,
  `data/*.db`, `data/*.sqlite`, `node_modules/`, `dist/`,
  `logs/`.

After commit:

- `git ls-files | grep -E '\.env$|^reports/local|\.sqlite$|/node_modules/|^dist/|^logs/'`
  → no rows.
- No tag was created (`git tag --list` unchanged).

## 9. Current blockers

None. The frontend build is green, the offline regression
passes, the deployed CVM is unchanged at `v0.2.2-alpha`, and the
public hostname is unchanged.

## 10. Recommended next phase

1. **Operator deploy of the new UI to the CVM.** This phase
   produced the new build on `main`; the CVM is still serving the
   Phase N.1-C `dist/`. A short operator-driven deploy (`git pull
   && npm install && npm run build && systemctl --user restart`)
   will surface the new UI on `https://mvs.conanxin.com`.
2. **Cloudflare Access policy audit.** Confirm in the Zero Trust
   dashboard that the audience / IdP / session duration are still
   appropriate, now that a public-facing UI is live.
3. **Optional: pin UI version label to git SHA.** The current
   `/api/health.version` reflects the deployed tag (`v0.2.2-alpha`).
   Operators who want to distinguish a hot-patched build from the
   tagged release can additionally set `APP_VERSION` from the
   short git SHA at deploy time.

## 11. Final verdict

**Phase P: PASS.** UI branding now matches the deployed release,
the page exposes the runtime version + service environment
fetched live from `/api/health`, the offline regression stays
green at 72/72, and no Cloudflare / tunnel / systemd / deployment
side was touched. No video task was created; no quota was
consumed; no sensitive material leaked.
