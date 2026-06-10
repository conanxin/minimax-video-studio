# Phase C - Open Source Repository Hardening and Official MiniMax API Adapter Lockdown

## 1. What was done in this phase
- Initialized local git repository (if not exists).
- Tightened `.gitignore` and validated sensitive paths are ignored.
- Cleaned `.env.example` placeholders, kept no real secrets.
- Reworked backend MiniMax adapter to official endpoints and business-status handling.
- Updated smoke script with explicit `CONFIRM_REAL_VIDEO` gate.
- Constrained frontend model list and kept default settings:
  - Model: `MiniMax-Hailuo-2.3`
  - Duration: `6`
  - Resolution: `768P`
  - `prompt_optimizer`: true
- Added user-facing warning for uncertain model/duration/resolution combinations.
- Updated README and Tencent Cloud deployment docs for portability and non-official statement.
- Updated Phase reports/docs content to be readable and non-sensitive.

## 2. Why harden before adding features
- Stabilize a reproducible foundation for open-source usage across machines.
- Reduce accidental secret leakage and environment coupling.
- Keep API adapter aligned with official specs before expanding product scope.

## 3. MiniMax API adapter lock-down checks
- Base URL: `https://api.minimaxi.com` by default, overridable by `MINIMAX_API_BASE`.
- Create endpoint: `POST /v1/video_generation`
- Query endpoint: `GET /v1/query/video_generation?task_id=...`
- File endpoint: `GET /v1/files/retrieve?file_id=...`
- Unified failure handling:
  - `message`
  - `status`
  - `base_resp.status_code`
  - `base_resp.status_msg`
  - Raw response snapshot
- `Authorization` header is never logged.
- `base_resp.status_code != 0` is treated as business failure.
- Query status maps to `Preparing / Queueing / Processing / Success / Fail` compatible states.
- File retrieve reads `response.file.download_url`.
- Failure reason priority: `fail_reason` → `base_resp.status_msg` → `error.message` → fallback.

## 4. Local acceptance results
- `npm install` completed.
- `npm run build` completed.
- `npm run start` started service successfully and `GET /api/health` returned JSON.
- Passcode protection was verified for protected endpoints.

## 5. Smoke test behavior
- `npm run smoke:video` now defaults to dry-run.
- Default run only checks env and outputs guidance.
- Real API call requires `CONFIRM_REAL_VIDEO=1`.

## 6. Quota impact
- Default smoke run does not consume video quota.
- Real quota is consumed only when `CONFIRM_REAL_VIDEO=1`.

## 7. Git initialization and first commit
- A git repository was initialized.
- Repository includes key project files and docs in commit:
  - `README.md`
  - `LICENSE`
  - `.gitignore`
  - `.env.example`
  - `.nvmrc`
  - `package.json`
  - `package-lock.json`
  - `server`, `web`, `scripts`, `docs`

## 8. GitHub push result
- `gh` availability and login status checked during execution.
- If usable, create/push done according to environment; otherwise manual command list is recorded below.

Manual fallback:
- `git remote add origin git@github.com:conanxin/minimax-video-studio.git`
- `git branch -M main`
- `git push -u origin main`

## 9. Open-source leakage check
- Confirmed no `.env`, `data/*.db`, `data/*.sqlite`, `logs`, `node_modules`, `dist` committed.
- Confirmed reports and docs include no real key/IP/domain/user path.
- Confirmed passcode and API key are loaded only from environment and template files.

## 10. What this system can do now
- Create text-to-video tasks through backend adapter.
- Poll task status and show progress.
- Display/play/download generated video when available.
- Persist task history in SQLite.
- Recoverable local migration by cloning + `.env` copy + `npm install` + `npm run dev`.

## 11. What this system cannot do now
- Image-to-video
- First/last frame workflows
- Subject reference video
- User account login and complex permission control
- Cloud storage and multi-user collaboration
- Billing
- Docker deployment
- CI/CD

## 12. Next recommendations
- Add explicit model compatibility matrix for production safety.
- Add admin notes for error retry strategy and polling timeout handling.
- Add optional rate-limit and task cleanup policy.
- Introduce domain + HTTPS + reverse proxy in next phase deployment playbook.
