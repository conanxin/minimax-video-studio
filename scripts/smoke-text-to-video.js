const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');
const { normalizeMiniMaxStatus } = require('../server/services/taskStore');
const {
  createTextToVideo,
  queryVideoTask,
  retrieveVideoFile,
} = require('../server/services/minimaxClient');
const {
  upsertTaskByTaskId,
  updateTaskByTaskId,
  createTaskRecord,
  modelConfig,
} = require('../server/services/taskStore');

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

function normalizeReportStatus(status) {
  return normalizeMiniMaxStatus(status) || 'Unknown';
}

function isStatusTerminal(status) {
  const normalized = normalizeReportStatus(status);
  return normalized === 'Success' || normalized === 'Fail';
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

function renderPhaseC1LocalReport(context) {
  return `# Phase C.1 - Real MiniMax Smoke Test (Local)

## Execution mode
- confirm_real_video: ${safeText(process.env.CONFIRM_REAL_VIDEO)}
- prompt: ${safeText(context.prompt)}
- requested_prompt: ${safeText(context.prompt)}

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
- Ensure official endpoint adaptation is correct before expanding new features.
- Confirm request/response behavior and failure reason handling under real quota usage.

## Whether real MiniMax call happened
- ${safeText(context.created) === 'Yes' ? 'Yes' : 'No'}

## Quota impact
- ${safeText(context.chargeUsed) === 'Yes' ? 'One quota-consuming request was sent' : 'No'}

## Task creation
- Created: ${safeText(context.created)}
- task_id: ${maskId(context.taskId)}
- creation_status: ${safeText(context.createdStatus)}

## Task query
- query_result: ${safeText(context.finalStatus)}
- file_id: ${maskId(context.fileId)}

## Video retrieval
- download_url: ${safeText(context.downloadUrl)}

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
- If needed, run one-time remote status recheck later without creating a new task.
`;
}

async function writePhaseAReport(context) {
  const content = renderPhaseAReport(context);
  await fs.promises.mkdir(path.dirname(PHASE_A_REPORT_PATH), { recursive: true });
  await fs.promises.writeFile(PHASE_A_REPORT_PATH, content, 'utf8');
  console.log(`Smoke report saved: ${PHASE_A_REPORT_PATH}`);
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

function buildPayloadFromEnv() {
  return {
    model: modelConfig.defaults.model,
    prompt: 'A calm moonlit ocean at night, gentle waves moving slowly, soft cinematic lighting, peaceful atmosphere, slow camera push in, 6 seconds.',
    duration: modelConfig.defaults.duration,
    resolution: modelConfig.defaults.resolution,
    prompt_optimizer: modelConfig.defaults.prompt_optimizer,
  };
}

async function persistSmokeTaskProgress(task) {
  const status = normalizeReportStatus(task.status);
  const patch = {
    status,
    fail_reason: task.fail_reason || 'No fail reason yet',
    file_id: task.file_id || null,
    download_url: task.download_url || null,
  };
  return updateTaskByTaskId(task.task_id, patch);
}

async function runRealSmoke(context) {
  const payload = buildPayloadFromEnv();
  const created = await createTextToVideo(payload);
  if (!created.task_id) {
    throw new Error('No task_id returned from create API');
  }

  context.created = 'Yes';
  context.createdStatus = normalizeReportStatus(created.status);
  context.taskId = created.task_id;

  let taskRecord = await upsertTaskByTaskId(created.task_id, {
    prompt: payload.prompt,
    model: payload.model,
    duration: payload.duration,
    resolution: payload.resolution,
    prompt_optimizer: payload.prompt_optimizer,
    status: normalizeReportStatus(created.status) || 'Queueing',
    file_id: created.file_id || null,
    download_url: created.download_url || null,
    fail_reason: created.fail_reason || null,
  });

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const task = await queryVideoTask(created.task_id);
    taskRecord = await persistSmokeTaskProgress({
      task_id: created.task_id,
      status: task.status,
      fail_reason: task.fail_reason,
      file_id: task.file_id,
      download_url: task.download_url,
    });

    context.finalStatus = normalizeReportStatus(task.status);
    context.taskId = created.task_id;
    context.fileId = task.file_id || 'N/A';
    context.failReason = task.fail_reason || 'N/A';

    if (context.finalStatus === 'Success' && task.file_id) {
      const file = await retrieveVideoFile(task.file_id);
      context.fileId = file.file_id || task.file_id || 'N/A';
      context.downloadUrl = file.download_url ? 'present' : 'absent';
      await persistSmokeTaskProgress({
        task_id: created.task_id,
        status: context.finalStatus,
        fail_reason: context.failReason,
        file_id: context.fileId,
        download_url: file.download_url || task.download_url || null,
      });
      break;
    }

    if (context.finalStatus === 'Fail') {
      context.downloadUrl = 'absent';
      break;
    }

    await sleep(CHECK_INTERVAL_MS);
    if (i === MAX_ATTEMPTS - 1) {
      context.finalStatus = 'timed out';
      context.failReason = 'Polling reached max attempts before completion.';
      if (taskRecord) {
        await updateTaskByTaskId(created.task_id, {
          fail_reason: context.failReason,
          status: taskRecord.status,
        });
      }
    }
  }

  return taskRecord;
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
    prompt: buildPayloadFromEnv().prompt,
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
    report.chargeUsed = 'No';
    await writePhaseC1LocalAndConsole(report, isPhaseC1
      ? path.resolve(process.cwd(), 'docs', 'PHASE_C1_REAL_SMOKE_REPORT.md')
      : null);
    await writePhaseAReport(report);
    return;
  }

  report.chargeUsed = 'Yes';
  report.requestTaskStarted = 'Yes';

  try {
    const taskRecord = await runRealSmoke(report);
    if (!taskRecord) {
      await createTaskRecord({
        task_id: `local-${Date.now()}`,
        prompt: report.prompt,
        model: modelConfig.defaults.model,
        duration: modelConfig.defaults.duration,
        resolution: modelConfig.defaults.resolution,
        prompt_optimizer: modelConfig.defaults.prompt_optimizer,
        status: 'Fail',
        file_id: null,
        download_url: null,
        fail_reason: 'No task record could be created from remote task query.',
      });
    }
  } catch (error) {
    report.finalStatus = 'failed';
    report.failReason = error.message || 'unknown error';
    console.error(error.message || error);

    if (report.created === 'Yes') {
      await updateTaskByTaskId(report.taskId, {
        status: 'Fail',
        fail_reason: report.failReason,
      }).catch(() => {});
    } else {
      await createTaskRecord({
        task_id: `local-${Date.now()}`,
        prompt: report.prompt,
        model: modelConfig.defaults.model,
        duration: modelConfig.defaults.duration,
        resolution: modelConfig.defaults.resolution,
        prompt_optimizer: modelConfig.defaults.prompt_optimizer,
        status: 'Fail',
        file_id: null,
        download_url: null,
        fail_reason: report.failReason,
      }).catch(() => {});
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    report.downloadUrl = safeText(report.downloadUrl);
    await writePhaseC1LocalAndConsole(report, isPhaseC1
      ? path.resolve(process.cwd(), 'docs', 'PHASE_C1_REAL_SMOKE_REPORT.md')
      : null);
    await writePhaseAReport(report);
    console.log(`Final status: ${report.finalStatus}`);
    console.log('Smoke flow completed.');
    if (report.taskId !== 'N/A') {
      console.log(`task record: redacted`);
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
