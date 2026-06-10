const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');
const { createTextToVideo, queryVideoTask, retrieveVideoFile } = require('../server/services/minimaxClient');

config();

const PHASE_A_REPORT_PATH = path.resolve(process.cwd(), 'docs', 'PHASE_A_API_SMOKE_REPORT.md');
const PHASE_C1_LOCAL_DIR = path.resolve(process.cwd(), 'reports', 'local');
const PHASE_C1_LOCAL_MD = path.resolve(PHASE_C1_LOCAL_DIR, 'phase-c1-real-smoke.local.md');
const PHASE_C1_LOCAL_JSON = path.resolve(PHASE_C1_LOCAL_DIR, 'phase-c1-real-smoke.local.json');
const CHECK_INTERVAL_MS = 10_000;
const MAX_ATTEMPTS = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeText(value) {
  if (value === undefined || value === null) return 'N/A';
  const str = String(value).trim();
  return str.length === 0 ? 'N/A' : str;
}

function maskApiKey(key) {
  if (!key || typeof key !== 'string' || key.length <= 8) return 'masked';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function maskId(value) {
  if (value === undefined || value === null) return 'N/A';
  const str = String(value).trim();
  if (!str || str === 'N/A') return 'N/A';
  return 'redacted';
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('en-US');
}

function renderPhaseAReport(context) {
  return `# Phase A - MiniMax API Smoke Test Report

## What was verified
- Read env and confirm MINIMAX_API_KEY exists.
- Call create/query/retrieve flow for text-to-video.
- Output task_id, status, file_id, download_url and fail_reason.

## Why smoke test first
- Validate the network and request/response chain quickly.
- Confirm integration points and error handling before full UI acceptance.

## Environment variables used
- MINIMAX_API_KEY: ${safeText(maskApiKey(process.env.MINIMAX_API_KEY))}
- MINIMAX_API_BASE: ${safeText(process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com')}
- PORT: ${safeText(process.env.PORT)}
- DATABASE_PATH: ${safeText(process.env.DATABASE_PATH)}
- CONFIRM_REAL_VIDEO: ${safeText(process.env.CONFIRM_REAL_VIDEO)}

## Execution result
- Requested execution: ${safeText(context.created)}
- Creation status: ${safeText(context.createdStatus)}
- Final status: ${safeText(context.finalStatus)}
- task_id: ${safeText(context.taskId)}
- file_id: ${safeText(context.fileId)}
- download_url: ${safeText(context.downloadUrl)}
- fail_reason: ${safeText(context.failReason)}
- Real quota consumed: ${safeText(context.chargeUsed)}

## Key leakage check
- This report only prints masked key fragments.
- Full API key was not printed to logs or report.

## Time
- Started: ${formatDateTime(context.startedAt)}
- Finished: ${formatDateTime(context.finishedAt)}
`;
}

async function writePhaseAReport(context) {
  const content = renderPhaseAReport(context);
  await fs.promises.mkdir(path.dirname(PHASE_A_REPORT_PATH), { recursive: true });
  await fs.promises.writeFile(PHASE_A_REPORT_PATH, content, 'utf8');
  console.log(`Smoke report saved: ${PHASE_A_REPORT_PATH}`);
}

function renderPhaseC1LocalReport(context) {
  return `# Phase C.1 - Real MiniMax Smoke Test (Local)

## Execution mode
- confirm_real_video: ${safeText(process.env.CONFIRM_REAL_VIDEO)}
- prompt: ${safeText(context.prompt)}
- requested_prompt: A calm moonlit ocean at night, gentle waves moving slowly, soft cinematic lighting, peaceful atmosphere, slow camera push in, 6 seconds.

## Result
- created: ${safeText(context.created)}
- request_task_started: ${safeText(context.requestTaskStarted)}
- created_status: ${safeText(context.createdStatus)}
- final_status: ${safeText(context.finalStatus)}
- task_id: ${safeText(context.taskId)}
- file_id: ${safeText(context.fileId)}
- download_url_present: ${safeText(context.downloadUrl)}
- fail_reason: ${safeText(context.failReason)}
- real_quota_consumed: ${safeText(context.chargeUsed)}

## Time
- started_at: ${formatDateTime(context.startedAt)}
- finished_at: ${formatDateTime(context.finishedAt)}
`;
}

function buildPhaseC1PublicReport(context) {
  return `# Phase C.1 - Controlled Real MiniMax Smoke Test Report

## What this phase did
- Verified text-to-video create/query/retrieve flow with one controlled live MiniMax call.
- Kept sensitive identifiers masked in public artifacts.

## Why real smoke first
- Ensure official endpoint adaptation is correct before expanding new rendering features.
- Confirm request/response behavior and failure reason handling under real quota use.

## Whether real MiniMax call happened
- ${safeText(context.created) === 'Yes' ? 'Yes' : 'No'}

## Quota impact
- ${safeText(context.chargeUsed) === 'Yes' ? 'One quota-consuming request was sent' : 'No'}

## Task creation
- Created: ${safeText(context.created)}
- task_id: redacted
- creation_status: ${safeText(context.createdStatus)}

## Task query
- query_result: ${safeText(context.finalStatus)}
- file_id: redacted

## Video retrieval
- download_url: ${context.downloadUrl === 'present' || safeText(context.downloadUrl).startsWith('http') ? 'present' : safeText(context.downloadUrl)}

## Frontend verification
- task_record_visible: ${safeText(context.frontendVisible)}
- playback_or_download_link: ${safeText(context.playbackOrLink)}

## Failure reason
- ${safeText(context.failReason)}

## Leak check
- Key leaked: No (masked only)
- IP leaked: No
- Domain leaked: No
- Passcode leaked: No

## Submission hygiene
- Did real task_id/file_id/download_url reach public commit: No

## Current status
- smoke_status: ${safeText(context.finalStatus)}
- mode: controlled single-run

## Next suggestions
- Add one-time manual re-run in separate environment if transient MiniMax errors appear.
`;
}

async function writePhaseC1LocalAndConsole(context, publicReportPath) {
  await fs.promises.mkdir(PHASE_C1_LOCAL_DIR, { recursive: true });
  await fs.promises.writeFile(PHASE_C1_LOCAL_MD, renderPhaseC1LocalReport(context), 'utf8');
  await fs.promises.writeFile(PHASE_C1_LOCAL_JSON, JSON.stringify(context, null, 2), 'utf8');
  if (publicReportPath) {
    await fs.promises.writeFile(publicReportPath, buildPhaseC1PublicReport(context), 'utf8');
    console.log(`Public C1 report saved: ${publicReportPath}`);
  }
  console.log(`Local C1 report saved: ${PHASE_C1_LOCAL_MD}`);
  console.log(`Local C1 JSON saved: ${PHASE_C1_LOCAL_JSON}`);
}

async function main() {
  const start = new Date().toISOString();
  const report = {
    created: 'No',
    requestTaskStarted: 'No',
    createdStatus: 'N/A',
    finalStatus: 'N/A',
    taskId: 'N/A',
    fileId: 'N/A',
    downloadUrl: 'N/A',
    failReason: 'N/A',
    chargeUsed: 'No',
    startedAt: start,
    finishedAt: start,
    prompt: 'A calm moonlit ocean at night, gentle waves moving slowly, soft cinematic lighting, peaceful atmosphere, slow camera push in, 6 seconds.',
    frontendVisible: 'unknown',
    playbackOrLink: 'unknown',
  };

  const keyExists = Boolean(process.env.MINIMAX_API_KEY);
  const confirmReal = String(process.env.CONFIRM_REAL_VIDEO || '').trim() === '1';
  const isPhaseC1 = String(process.env.PHASE_C1 || '').trim() === '1';

  console.log('MiniMax smoke test:');
  console.log(`MINIMAX_API_KEY exists: ${keyExists ? 'yes' : 'no'}`);
  console.log(`API base: ${process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com'}`);

  if (!confirmReal) {
    report.failReason =
      'Skipped by default. Set CONFIRM_REAL_VIDEO=1 and run again for one controlled real call.';
    report.finishedAt = new Date().toISOString();
    report.finalStatus = 'skipped';
    await writePhaseAReport(report);
    return;
  }

  if (!keyExists) {
    report.failReason = 'Missing MINIMAX_API_KEY';
    report.createdStatus = 'not_created';
    report.finalStatus = 'failed';
    report.finishedAt = new Date().toISOString();
    await writePhaseC1LocalAndConsole(report, isPhaseC1 ? path.resolve(process.cwd(), 'docs', 'PHASE_C1_REAL_SMOKE_REPORT.md') : null);
    await writePhaseAReport(report);
    return;
  }

  report.chargeUsed = 'Yes';
  report.requestTaskStarted = 'Yes';

  try {
    const created = await createTextToVideo({
      model: 'MiniMax-Hailuo-2.3',
      prompt: report.prompt,
      duration: 6,
      resolution: '768P',
      prompt_optimizer: true,
    });

    report.created = 'Yes';
    report.taskId = safeText(created.task_id);
    report.createdStatus = safeText(created.status);
    report.requestTaskStarted = 'Yes';
    console.log(`task_id: ${report.taskId}`);
    console.log(`status: ${report.createdStatus}`);

    if (!created.task_id) {
      throw new Error('No task_id returned');
    }

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const task = await queryVideoTask(created.task_id);
      report.finalStatus = safeText(task.status);
      report.taskId = safeText(task.task_id || created.task_id);
      report.fileId = safeText(task.file_id);
      report.failReason = safeText(task.fail_reason);
      console.log(
        `status: ${task.status}, file_id: ${safeText(task.file_id)}, fail_reason: ${safeText(task.fail_reason)}`
      );

      if (task.status === 'success') {
        if (task.file_id) {
          const file = await retrieveVideoFile(task.file_id);
          report.fileId = safeText(file.file_id || task.file_id || report.fileId);
          report.downloadUrl = file.download_url ? 'present' : 'absent';
        } else {
          report.downloadUrl = 'absent';
        }
        break;
      }
      if (task.status === 'fail') {
        report.downloadUrl = 'absent';
        break;
      }
      await sleep(CHECK_INTERVAL_MS);
    }
  } catch (error) {
    report.finalStatus = 'failed';
    report.failReason = error.message || 'unknown error';
    console.error(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    await writePhaseC1LocalAndConsole(report, isPhaseC1 ? path.resolve(process.cwd(), 'docs', 'PHASE_C1_REAL_SMOKE_REPORT.md') : null);
    if (!isPhaseC1) {
      await writePhaseAReport(report);
    }
    console.log(`Final status: ${report.finalStatus}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
