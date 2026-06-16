const {
  createTask,
  getTaskByTaskId,
  getTaskByFileId,
  getRecentTasks,
  countTasks,
  initDb,
  updateTask,
  mapTask,
} = require('../db');
const modelConfig = require('../../shared/videoModels.json');
const {
  validateTaskInput: sharedValidateTaskInput,
  ALLOWED_GENERATION_MODES,
} = require('./validation');

let dbPromise = null;

function getDb() {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

function normalizeMiniMaxStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  const map = {
    preparing: 'Preparing',
    queueing: 'Queueing',
    processing: 'Processing',
    running: 'Processing',
    success: 'Success',
    completed: 'Success',
    done: 'Success',
    fail: 'Fail',
    failed: 'Fail',
    error: 'Fail',
    submitted: 'Queueing',
    pending: 'Queueing',
    unknown: 'Unknown',
  };
  if (map[status]) return map[status];
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function isValidModel(model) {
  return Object.prototype.hasOwnProperty.call(modelConfig.compatibility, model);
}

function supportedResolutions(model, duration) {
  const durationKey = String(duration);
  return modelConfig.compatibility[model]?.[durationKey] || [];
}

function supportedDurations(model) {
  return Object.keys(modelConfig.compatibility[model] || {}).map((v) => Number(v));
}

function isSupportedCombination(model, duration, resolution) {
  return supportedResolutions(model, duration).includes(String(resolution));
}

function supportedCombinationHint(model) {
  if (!modelConfig.compatibility[model]) return 'Model not in allowed list.';
  const pairs = Object.entries(modelConfig.compatibility[model])
    .map(([seconds, resolutions]) => `${seconds}s: ${resolutions.join(' / ')}`);
  return `${model} supports ${pairs.join('; ')}.`;
}

function validateTaskInput(payload) {
  // Phase I Recovery: text_to_video / image_to_video are both
  // validated by the shared `validation.js` module. This thin
  // wrapper preserves the original return shape so callers in
  // server/index.js continue to receive { ok, normalized, error, hint }.
  const result = sharedValidateTaskInput(payload || {});
  if (result.ok) {
    return {
      ok: true,
      normalized: result.normalized,
    };
  }
  return {
    ok: false,
    error: result.error,
    hint: result.hint,
  };
}

async function createTaskRecord(payload) {
  const db = await getDb();
  return createTask(db, {
    ...payload,
    status: normalizeMiniMaxStatus(payload.status),
  });
}

async function updateTaskByTaskId(taskId, patch) {
  const db = await getDb();
  return updateTask(db, taskId, patch);
}

async function upsertTaskByTaskId(taskId, payload) {
  const db = await getDb();
  const existing = await getTaskByTaskId(db, taskId);
  if (existing) {
    return updateTask(db, taskId, payload);
  }
  return createTask(db, {
    task_id: taskId,
    ...payload,
    status: normalizeMiniMaxStatus(payload.status),
  });
}

async function getTaskByTaskIdRecord(taskId) {
  const db = await getDb();
  return mapTask(await getTaskByTaskId(db, taskId));
}

async function getTaskByFileIdRecord(fileId) {
  const db = await getDb();
  return mapTask(await getTaskByFileId(db, fileId));
}

async function listTasks({ limit = 50, offset = 0, status = null, q = null, sort = 'updated_desc' } = {}) {
  const db = await getDb();
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 50;
  const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
  const rows = await getRecentTasks(db, {
    limit: safeLimit,
    offset: safeOffset,
    status: status || null,
    q: q || null,
    sort: sort || 'updated_desc',
  });
  return rows.map((task) => mapTask({
    ...task,
    status: normalizeMiniMaxStatus(task.status),
  }));
}

async function countFilteredTasks({ status = null, q = null } = {}) {
  const db = await getDb();
  return countTasks(db, { status: status || null, q: q || null });
}

module.exports = {
  modelConfig,
  i2vModelConfig: require('../../shared/videoModelsI2V.json').i2vModelConfig,
  allowedGenerationModes: ALLOWED_GENERATION_MODES,
  normalizeMiniMaxStatus,
  supportedDurations,
  supportedResolutions,
  isSupportedCombination,
  supportedCombinationHint,
  validateTaskInput,
  createTaskRecord,
  upsertTaskByTaskId,
  updateTaskByTaskId,
  getTaskByTaskId: getTaskByTaskIdRecord,
  getTaskByFileId: getTaskByFileIdRecord,
  listTasks,
  countFilteredTasks,
};
