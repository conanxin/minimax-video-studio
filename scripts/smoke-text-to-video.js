const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');
const { createTextToVideo, queryVideoTask, retrieveVideoFile } = require('../server/services/minimaxClient');

config();

const REPORT_PATH = path.resolve(process.cwd(), 'docs', 'PHASE_A_API_SMOKE_REPORT.md');
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

function formatDateTime(value) {
  return new Date(value).toLocaleString('en-US');
}

async function writeReport(context) {
  const content = `# Phase A - MiniMax API Smoke Test Report

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

  await fs.promises.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.promises.writeFile(REPORT_PATH, content, 'utf8');
  console.log(`Smoke report saved: ${REPORT_PATH}`);
}

async function main() {
  const start = new Date().toISOString();
  const report = {
    created: 'No',
    createdStatus: 'N/A',
    finalStatus: 'N/A',
    taskId: 'N/A',
    fileId: 'N/A',
    downloadUrl: 'N/A',
    failReason: 'N/A',
    chargeUsed: 'No',
    startedAt: start,
    finishedAt: start,
  };

  const keyExists = Boolean(process.env.MINIMAX_API_KEY);
  const confirmReal = process.env.CONFIRM_REAL_VIDEO === '1';

  console.log('MiniMax smoke test:');
  console.log(`MINIMAX_API_KEY exists: ${keyExists ? 'yes' : 'no'}`);
  console.log(`API base: ${process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com'}`);

  if (!confirmReal) {
    report.failReason =
      'Skipped by default. Set CONFIRM_REAL_VIDEO=1 in .env or environment to run real video task.';
    report.finishedAt = new Date().toISOString();
    report.finalStatus = 'skipped';
    console.log('CONFIRM_REAL_VIDEO is not set to 1, so no quota-consuming API call will be made.');
    console.log('To run real video generation, set CONFIRM_REAL_VIDEO=1 and run again.');
    await writeReport(report);
    return;
  }

  if (!keyExists) {
    report.failReason = 'Missing MINIMAX_API_KEY';
    report.createdStatus = 'not_created';
    report.finalStatus = 'failed';
    report.finishedAt = new Date().toISOString();
    await writeReport(report);
    console.error('Missing MINIMAX_API_KEY and cannot run real smoke test.');
    return;
  }

  report.chargeUsed = 'Yes';
  const prompt = 'A cinematic 6-second clip, natural light, smooth camera movement.';

  try {
    const created = await createTextToVideo({
      model: 'MiniMax-Hailuo-2.3',
      prompt,
      duration: 6,
      resolution: '768P',
      prompt_optimizer: true,
    });

    report.created = 'Yes';
    report.taskId = safeText(created.task_id);
    report.createdStatus = safeText(created.status);
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
          report.downloadUrl = safeText(file.download_url);
        } else {
          report.downloadUrl = 'No file_id returned';
        }
        break;
      }
      if (task.status === 'fail') {
        report.downloadUrl = 'Task failed';
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
    await writeReport(report);
    console.log(`Final status: ${report.finalStatus}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
