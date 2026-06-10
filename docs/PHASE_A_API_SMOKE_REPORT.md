# Phase A - MiniMax API Smoke Test Report

## What was verified
- Read env and confirm MINIMAX_API_KEY exists.
- Call create/query/retrieve flow for text-to-video.
- Output task_id, status, file_id, download_url and fail_reason.

## Why smoke test first
- Validate the network and request/response chain quickly.
- Confirm integration points and error handling before full UI acceptance.

## Environment variables used
- MINIMAX_API_KEY: masked
- MINIMAX_API_BASE: https://api.minimaxi.com
- PORT: N/A
- DATABASE_PATH: N/A
- CONFIRM_REAL_VIDEO: N/A

## Execution result
- Requested execution: No
- Creation status: N/A
- Final status: skipped
- task_id: N/A
- file_id: N/A
- download_url: N/A
- fail_reason: Skipped by default. Set CONFIRM_REAL_VIDEO=1 in .env or environment to run real video task.
- Real quota consumed: No

## Key leakage check
- This report only prints masked key fragments.
- Full API key was not printed to logs or report.

## Time
- Started: 6/10/2026, 7:24:36 PM
- Finished: 6/10/2026, 7:24:36 PM
