const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { config } = require('dotenv');

const {
  createTaskRecord,
  getTaskByTaskId,
  getTaskByFileId,
  listTasks,
  countFilteredTasks,
  updateTaskByTaskId,
  upsertTaskByTaskId,
  normalizeMiniMaxStatus,
  validateTaskInput,
  modelConfig,
  i2vModelConfig,
} = require('./services/taskStore');
const {
  createTextToVideo,
  createImageToVideo,
  queryVideoTask,
  retrieveVideoFile,
} = require('./services/minimaxClient');
const { toSafeTaskPayload } = require('./services/taskTransform');
const { validateImageInput } = require('./services/validation');
const pollingConfig = require('../shared/pollingConfig.json');
const freshness = require('./services/downloadLinkFreshness');
const errorClassifier = require('./services/errorClassifier');
const { toIsoNow } = require('./db');
const crypto = require('crypto');

config();

const app = express();
const PORT = Number(process.env.PORT) || 8789;
const SITE_PASSCODE = String(process.env.SITE_PASSCODE || 'change_me').trim();
const FRONTEND_DIST = path.resolve(__dirname, '../web/dist');
const INDEX_HTML = path.join(FRONTEND_DIST, 'index.html');

app.use(cors());
// Phase I Recovery: allow up to 50MB JSON payloads so a 20MB
// image_to_video Data URL can reach the validator. The validator
// itself enforces the 20MB image constraint; this only lifts the
// transport ceiling. Without this, express returns 413 before the
// validator ever runs.
app.use(express.json({ limit: '50mb' }));
app.set('trust proxy', true);

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'minimax-video-studio',
    environment: process.env.NODE_ENV || 'development',
    version: '0.1.0',
  });
});

app.get('/api/video/models', (_req, res) => {
  res.json(modelConfig);
});

app.get('/api/video/i2v/models', (_req, res) => {
  res.json(i2vModelConfig);
});

app.get('/api/generation-modes', (_req, res) => {
  res.json({
    modes: ['text_to_video', 'image_to_video'],
    defaults: {
      text_to_video: modelConfig.defaults,
      image_to_video: i2vModelConfig.defaults,
    },
    image_constraints: i2vModelConfig.image_constraints,
  });
});

app.get('/api/polling/config', (_req, res) => {
  res.json({
    initialIntervalMs: pollingConfig.initialIntervalMs,
    maxIntervalMs: pollingConfig.maxIntervalMs,
    maxAttempts: pollingConfig.maxAttempts,
    maxDurationMinutes: pollingConfig.maxDurationMinutes,
    backoffFactor: pollingConfig.backoffFactor,
    jitterMs: pollingConfig.jitterMs,
    source: 'shared/pollingConfig.json',
  });
});

app.get('/api/download-link/config', (_req, res) => {
  res.json({
    warningTtlHours: freshness.getWarningTtlHours(),
    softTtlHours: freshness.getSoftTtlHours(),
    statuses: {
      fresh: freshness.STATUSES.FRESH,
      aging: freshness.STATUSES.AGING,
      stale: freshness.STATUSES.STALE,
      absent: freshness.STATUSES.ABSENT,
      unknown: freshness.STATUSES.UNKNOWN,
    },
    source: 'shared/downloadLinkConfig.json',
    note: 'Soft advisory only. The URL is not guaranteed to expire at these boundaries. The user must always click Refresh download link to fetch a new URL from MiniMax.',
  });
});

function getPasscode(req) {
  return req.body?.passcode || req.query?.passcode || req.headers['x-site-passcode'];
}

function requirePasscode(req, res, next) {
  const passcode = getPasscode(req);
  if (!passcode || String(passcode).trim() !== SITE_PASSCODE) {
    return res.status(401).json({ error: 'Passcode check failed. Please provide the correct SITE_PASSCODE.' });
  }
  next();
}

function normalizeTaskPayload(req) {
  return {
    prompt: req.body?.prompt || '',
    model: req.body?.model || modelConfig.defaults.model,
    duration: req.body?.duration || modelConfig.defaults.duration,
    resolution: req.body?.resolution || modelConfig.defaults.resolution,
    prompt_optimizer: req.body?.prompt_optimizer !== false,
    generation_mode: req.body?.generation_mode,
    first_frame_image: req.body?.first_frame_image,
  };
}

// Phase I Recovery: image-to-video payload assembly. The first_frame_image
// is consumed by the I2V validator and MiniMax client. The DB only stores
// a safe summary (kind / host / mime / bytes / sha256_short / summary).
function buildImageInputSummary(normalized) {
  const value = normalized.first_frame_image || '';
  const kind = normalized.first_frame_image_kind;
  const sha256 = crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 8);
  let summary = 'Image first frame recorded';
  if (kind === 'data_url') {
    summary = `Data URL image, mime=${normalized.first_frame_image_mime || 'unknown'}, ~${normalized.first_frame_image_approx_bytes || 0} bytes`;
  } else if (kind === 'public_url') {
    summary = `Public URL image, host=${normalized.first_frame_image_host || 'unknown'}`;
  }
  return { sha256, summary };
}

async function syncTaskById(taskId) {
  const localTask = await getTaskByTaskId(taskId);
  if (!localTask) return null;

  try {
    const remote = await queryVideoTask(taskId);
    const normalizedRemoteStatus = normalizeMiniMaxStatus(remote.status);
    const patch = {
      status: normalizedRemoteStatus,
      fail_reason: remote.fail_reason || localTask.fail_reason,
      file_id: remote.file_id || localTask.file_id,
    };

    if (remote.file_id) {
      const file = await retrieveVideoFile(remote.file_id).catch(() => null);
      if (file?.download_url) {
        patch.download_url = file.download_url;
        patch.download_url_refreshed_at = toIsoNow();
        patch.download_url_status = freshness.STATUSES.FRESH;
      } else if (remote.download_url) {
        patch.download_url = remote.download_url;
        patch.download_url_refreshed_at = toIsoNow();
        patch.download_url_status = freshness.STATUSES.FRESH;
      }
    }

    return updateTaskByTaskId(taskId, patch);
  } catch (_error) {
    return localTask;
  }
}

app.post('/api/video/create', requirePasscode, async (req, res) => {
  const rawPayload = normalizeTaskPayload(req);
  const validated = validateTaskInput(rawPayload);

  if (!validated.ok) {
    return res.status(400).json({
      error: validated.error,
      recommendation: validated.hint || 'This combination may not be supported by the selected model, duration, and resolution.',
    });
  }

  const payload = validated.normalized;
  const fallbackTaskId = `local-${Date.now()}`;

  try {
    let remote;
    if (payload.generation_mode === 'image_to_video') {
      const imageSummary = buildImageInputSummary(payload);
      const dbSafeImageFields = {
        generation_mode: 'image_to_video',
        input_image_present: true,
        input_image_type: payload.first_frame_image_kind,
        input_image_host: payload.first_frame_image_host || null,
        input_image_mime: payload.first_frame_image_mime || null,
        input_image_approx_bytes: payload.first_frame_image_approx_bytes || null,
        input_image_sha256_short: imageSummary.sha256,
        input_image_summary: imageSummary.summary,
      };
      // Image bytes are sent to MiniMax only; never persisted.
      remote = await createImageToVideo({
        model: payload.model,
        prompt: payload.prompt,
        duration: payload.duration,
        resolution: payload.resolution,
        prompt_optimizer: payload.prompt_optimizer,
        first_frame_image: payload.first_frame_image,
      });
      const taskId = remote.task_id || fallbackTaskId;
      const record = await upsertTaskByTaskId(taskId, {
        generation_mode: 'image_to_video',
        prompt: payload.prompt,
        model: payload.model,
        duration: payload.duration,
        resolution: payload.resolution,
        prompt_optimizer: payload.prompt_optimizer,
        status: normalizeMiniMaxStatus(remote.status) || 'Queueing',
        file_id: remote.file_id || null,
        download_url: remote.download_url || null,
        fail_reason: remote.fail_reason || null,
        ...dbSafeImageFields,
      });
      return res.json({
        task_id: record.task_id,
        status: record.status,
        created_at: record.created_at,
        message: 'Image-to-video task has been submitted.',
      });
    }

    remote = await createTextToVideo(payload);
    const taskId = remote.task_id || fallbackTaskId;
    const record = await upsertTaskByTaskId(taskId, {
      generation_mode: 'text_to_video',
      prompt: payload.prompt,
      model: payload.model,
      duration: payload.duration,
      resolution: payload.resolution,
      prompt_optimizer: payload.prompt_optimizer,
      status: normalizeMiniMaxStatus(remote.status) || 'Queueing',
      file_id: remote.file_id || null,
      download_url: remote.download_url || null,
      fail_reason: remote.fail_reason || null,
    });

    return res.json({
      task_id: record.task_id,
      status: record.status,
      created_at: record.created_at,
      message: 'Video task has been submitted.',
    });
  } catch (error) {
    const failTask = await createTaskRecord({
      task_id: fallbackTaskId,
      generation_mode: payload.generation_mode || 'text_to_video',
      prompt: payload.prompt,
      model: payload.model,
      duration: payload.duration,
      resolution: payload.resolution,
      prompt_optimizer: payload.prompt_optimizer,
      status: 'Fail',
      file_id: null,
      download_url: null,
      fail_reason: error?.fail_reason || error?.message || 'Failed to create task',
    });

    return res.status(400).json({
      error: failTask.fail_reason || 'Failed to create task',
      task_id: failTask.task_id,
      status: failTask.status,
      created_at: failTask.created_at,
    });
  }
});

app.get('/api/video/task/:taskId', requirePasscode, async (req, res) => {
  const { taskId } = req.params;
  const task = await syncTaskById(taskId);

  if (!task) return res.status(404).json({ error: 'Task not found.' });
  return res.json(toSafeTaskPayload(task));
});

app.get('/api/video/file/:fileId', requirePasscode, async (req, res) => {
  const { fileId } = req.params;
  const task = await getTaskByFileId(fileId);
  if (!task) return res.status(404).json({ error: 'File record not found.' });

  if (!task.download_url && task.file_id) {
    const response = await retrieveVideoFile(fileId).catch(() => null);
    if (response?.download_url) {
      await updateTaskByTaskId(task.task_id, {
        download_url: response.download_url,
        download_url_refreshed_at: toIsoNow(),
        download_url_status: freshness.STATUSES.FRESH,
      });
      task.download_url = response.download_url;
    }
  }

  const safeTask = toSafeTaskPayload(task);
  return res.json({
    file_id: safeTask.file_id,
    task_id: safeTask.task_id,
    status: safeTask.status,
    download_url: safeTask.download_url,
  });
});

app.post('/api/video/file/:fileId/refresh', requirePasscode, async (req, res) => {
  const { fileId } = req.params;
  const fileIdText = String(fileId || '').trim();
  if (!fileIdText) {
    return res.status(400).json({ error: 'fileId is required.' });
  }

  const task = await getTaskByFileId(fileIdText);
  if (!task) {
    return res.status(404).json({
      error: 'No local task is associated with this file_id. Open the task from history first.',
    });
  }

  try {
    const response = await retrieveVideoFile(fileIdText);
    const remoteFileId = response?.file_id || fileIdText;
    const remoteDownloadUrl = response?.download_url || null;

    const patch = { file_id: remoteFileId };
    if (remoteDownloadUrl) {
      patch.download_url = remoteDownloadUrl;
      patch.download_url_refreshed_at = toIsoNow();
      patch.download_url_status = freshness.STATUSES.FRESH;
    }

    const updated = await updateTaskByTaskId(task.task_id, patch);
    const safeUpdated = toSafeTaskPayload(updated);

    return res.json({
      file_id: safeUpdated.file_id,
      task_id: safeUpdated.task_id,
      status: safeUpdated.status,
      download_url: safeUpdated.download_url,
      download_url_present: Boolean(safeUpdated.download_url),
      download_url_status: safeUpdated.download_url_status,
      download_url_age_hours: safeUpdated.download_url_age_hours,
      should_refresh_download_url: safeUpdated.should_refresh_download_url,
      download_url_refreshed_at: safeUpdated.download_url_refreshed_at,
      refreshed_at: safeUpdated.updated_at,
      message: safeUpdated.download_url
        ? 'Download link refreshed.'
        : 'File is reachable but no download_url is available yet.',
    });
  } catch (error) {
    const status = error?.status || 502;
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      error: error?.message || 'Failed to refresh download link.',
      file_id: fileIdText,
      task_id: task.task_id,
    });
  }
});

const ALLOWED_STATUSES = new Set(['Preparing', 'Queueing', 'Processing', 'Success', 'Fail']);
const TASK_LIST_DEFAULT_LIMIT = 20;
const TASK_LIST_MAX_LIMIT = 100;

app.get('/api/tasks', requirePasscode, async (req, res) => {
  const rawLimit = Number(req.query.limit ?? TASK_LIST_DEFAULT_LIMIT);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), TASK_LIST_MAX_LIMIT)
    : TASK_LIST_DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0
    ? Math.floor(rawOffset)
    : 0;

  const rawStatus = req.query.status ? String(req.query.status).trim() : null;
  if (rawStatus && !ALLOWED_STATUSES.has(rawStatus)) {
    return res.status(400).json({
      error: `Invalid status. Allowed: ${Array.from(ALLOWED_STATUSES).join(', ')}.`,
    });
  }

  const rawQ = req.query.q ? String(req.query.q).trim() : null;
  const rawSort = req.query.sort ? String(req.query.sort).trim() : 'updated_desc';
  if (!['updated_desc', 'created_desc'].includes(rawSort)) {
    return res.status(400).json({
      error: 'Invalid sort. Allowed: updated_desc, created_desc.',
    });
  }

  try {
    const [rows, total] = await Promise.all([
      listTasks({ limit, offset, status: rawStatus, q: rawQ, sort: rawSort }),
      countFilteredTasks({ status: rawStatus, q: rawQ }),
    ]);
    return res.json({
      tasks: rows.map(toSafeTaskPayload),
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + rows.length < total,
      },
      filters: {
        status: rawStatus,
        q: rawQ,
        sort: rawSort,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to load tasks.' });
  }
});

app.use(express.static(FRONTEND_DIST));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API Not Found' });
  }
  if (fs.existsSync(INDEX_HTML)) {
    return res.sendFile(INDEX_HTML);
  }
  return res.status(404).send('Frontend not built. Run `npm run build` and restart server.');
});

app.listen(PORT, () => {
  console.log(`MiniMax studio backend running on :${PORT}`);
  console.log(`SQLite db path: ${process.env.DATABASE_PATH || './data/minimax-video-studio.sqlite'}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(
    `Polling guardrails: maxAttempts=${pollingConfig.maxAttempts}, maxDurationMinutes=${pollingConfig.maxDurationMinutes}, initialIntervalMs=${pollingConfig.initialIntervalMs}, maxIntervalMs=${pollingConfig.maxIntervalMs}`,
  );
});
