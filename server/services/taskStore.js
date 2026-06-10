const {
  createTask,
  getTaskByTaskId,
  getTaskByFileId,
  getRecentTasks,
  initDb,
  updateTask,
  mapTask,
} = require('../db');
const modelConfig = require('../../shared/videoModels.json');

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
  const { model, duration, resolution, prompt, prompt_optimizer } = payload;

  if (!prompt || String(prompt).trim().length === 0) {
    return { ok: false, error: 'Prompt is required.' };
  }
  if (String(prompt).length > modelConfig.max_prompt_length) {
    return {
      ok: false,
      error: `Prompt must be no more than ${modelConfig.max_prompt_length} characters.`,
    };
  }
  if (!isValidModel(model)) {
    return {
      ok: false,
      error: 'Unsupported model.',
      hint: `Allowed: ${Object.keys(modelConfig.compatibility).join(' / ')}`,
    };
  }

  const normalizedDuration = Number(duration);
  if (!Number.isInteger(normalizedDuration) || normalizedDuration <= 0) {
    return { ok: false, error: 'Duration must be a positive integer.' };
  }

  const durations = supportedResolutions(model, normalizedDuration);
  if (!durations || durations.length === 0) {
    return {
      ok: false,
      error: `${model} does not support duration ${normalizedDuration}s.`,
      hint: supportedCombinationHint(model),
    };
  }

  if (!isSupportedCombination(model, normalizedDuration, String(resolution))) {
    return {
      ok: false,
      error: `${model} does not support ${normalizedDuration}s + ${resolution}.`,
      hint: supportedCombinationHint(model),
    };
  }

  return {
    ok: true,
    normalized: {
      model,
      duration: normalizedDuration,
      resolution: String(resolution),
      prompt: String(prompt).trim(),
      prompt_optimizer: prompt_optimizer !== false,
    },
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

async function listTasks({ limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  const rows = await getRecentTasks(db, Number(limit) || 50, Number(offset) || 0);
  return rows.map((task) => mapTask({
    ...task,
    status: normalizeMiniMaxStatus(task.status),
  }));
}

module.exports = {
  modelConfig,
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
};
