# Phase B - Text-to-Video MVP Report

## 1) Scope implemented
- Backend API:
  - `POST /api/video/create`
  - `GET /api/video/task/:taskId`
  - `GET /api/video/file/:fileId`
  - `GET /api/tasks`
  - `GET /api/health`
- Frontend supports:
  - Prompt input
  - Model select
  - Duration select
  - Resolution select
  - `prompt_optimizer` toggle
  - Passcode input
  - Submit button
  - task_id / status display
  - history list and playback/download after completion

## 2) Defaults
- model: `MiniMax-Hailuo-2.3`
- duration: `6`
- resolution: `768P`
- prompt_optimizer: `true`

## 3) Local persistence
- SQLite auto-initialized on first run via `DATABASE_PATH`.
- Task table includes required fields:
  - id, task_id, prompt, model, duration, resolution, status, file_id, download_url, fail_reason, created_at, updated_at.

## 4) Polling
- Frontend polls every 10 seconds using `GET /api/video/task/:taskId`.
- Stops polling on success/fail.

## 5) Access control
- All task APIs use simple `SITE_PASSCODE` check.

## 6) What MVP can do
- Text-to-video generation workflow with status updates.
- Browser local play + download link.
- Task history list and status refresh.

## 7) What MVP cannot do
- Image-to-video
- First/last frame
- Subject reference
- User account system
- Billing and collaboration
