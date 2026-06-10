const fs = require('fs');
const path = require('path');
const { upsertTaskByTaskId, normalizeMiniMaxStatus } = require('../server/services/taskStore');

const LOCAL_JSON_PATH = path.resolve(
  process.cwd(),
  'reports',
  'local',
  'phase-c1-real-smoke.local.json'
);

function safeBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === 'success';
}

function asBoolean(value) {
  return safeBoolean(value);
}

function toSafeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  if (!fs.existsSync(LOCAL_JSON_PATH)) {
    console.error(`No local smoke report found: ${LOCAL_JSON_PATH}`);
    process.exit(1);
  }

  const raw = await fs.promises.readFile(LOCAL_JSON_PATH, 'utf8');
  const payload = JSON.parse(raw);

  const taskId = payload.taskId || payload.task_id || payload.task?.task_id;
  if (!taskId || taskId === 'N/A') {
    console.error('Local smoke report does not contain a valid task id.');
    process.exit(1);
  }

  const model = payload.model || 'MiniMax-Hailuo-2.3';
  const duration = toSafeNumber(payload.duration || 6, 6);
  const resolution = payload.resolution || '768P';
  const prompt = payload.prompt || 'Local smoke task imported from phase-c1 report';
  const prompt_optimizer = payload.prompt_optimizer !== false;
  const status = normalizeMiniMaxStatus(
    payload.finalStatus || payload.creation_status || payload.status
  );

  const fileId = payload.fileId || payload.file_id || null;
  const hasDownloadUrl = asBoolean(payload.download_url_present || payload.download_url);
  const downloadUrl = hasDownloadUrl && payload.downloadUrlActual ? payload.downloadUrlActual : null;
  const failReason = payload.failReason || payload.fail_reason || null;

  await upsertTaskByTaskId(taskId, {
    prompt,
    model,
    duration,
    resolution,
    prompt_optimizer,
    status,
    file_id: fileId,
    download_url: downloadUrl,
    fail_reason: failReason,
  });

  console.log(`Imported local smoke task into DB: ${taskId}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
