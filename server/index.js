const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { config } = require('dotenv');
const {
  initDb,
  createTask,
  getTaskByTaskIdMapped,
  getTaskByFileIdMapped,
  getRecentTasksMapped,
  updateTask,
} = require('./db');
const {
  createTextToVideo,
  queryVideoTask,
  retrieveVideoFile,
} = require('./services/minimaxClient');

config();

const app = express();
const PORT = Number(process.env.PORT) || 8789;
const SITE_PASSCODE = String(process.env.SITE_PASSCODE || 'change_me').trim();
const FRONTEND_DIST = path.resolve(__dirname, '../web/dist');
const INDEX_HTML = path.join(FRONTEND_DIST, 'index.html');
const POLL_DEFAULT_INTERVAL_MS = 10000;

app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'minimax-video-studio',
    environment: process.env.NODE_ENV || 'development',
    version: '0.1.0',
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
  const prompt = (req.body?.prompt || '').trim();
  const model = req.body?.model || 'MiniMax-Hailuo-2.3';
  const duration = Number(req.body?.duration || 6);
  const resolution = req.body?.resolution || '768P';
  const promptOptimizer = req.body?.prompt_optimizer !== false;

  return {
    prompt,
    model,
    duration,
    resolution,
    prompt_optimizer: Boolean(promptOptimizer),
  };
}

function toSafeTaskPayload(task) {
  if (!task) return null;
  return {
    id: task.id,
    task_id: task.task_id,
    prompt: task.prompt,
    model: task.model,
    duration: Number(task.duration),
    resolution: task.resolution,
    prompt_optimizer: Boolean(task.prompt_optimizer),
    status: task.status,
    file_id: task.file_id,
    download_url: task.download_url,
    fail_reason: task.fail_reason,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

function normalizeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (['success', 'done', 'completed'].includes(normalized)) return 'success';
  if (['fail', 'failed', 'error'].includes(normalized)) return 'fail';
  if (['queueing', 'running', 'processing'].includes(normalized)) return normalized;
  if (normalized === 'preparing') return 'preparing';
  return normalized || 'unknown';
}

async function syncTaskById(db, taskId) {
  const localTask = await getTaskByTaskIdMapped(db, taskId);
  if (!localTask) return null;

  try {
    const remote = await queryVideoTask(taskId);
    const status = normalizeStatus(remote.status) || localTask.status;
    const update = {
      status,
      fail_reason: remote.fail_reason || localTask.fail_reason,
      file_id: remote.file_id || localTask.file_id,
      download_url: remote.download_url || localTask.download_url,
    };

    if (remote.file_id && remote.file_id !== localTask.file_id) {
      const remoteFile = await retrieveVideoFile(remote.file_id);
      if (remoteFile?.download_url) update.download_url = remoteFile.download_url;
    }
    return updateTask(db, taskId, update);
  } catch (error) {
    console.error('[video/task] query remote status failed');
    return localTask;
  }
}

(async () => {
  const db = await initDb();

  app.post('/api/video/create', requirePasscode, async (req, res) => {
    const payload = normalizeTaskPayload(req);
    if (!payload.prompt) {
      return res.status(400).json({ error: 'Prompt is required.' });
    }
    if (!Number.isInteger(payload.duration) || payload.duration <= 0) {
      return res.status(400).json({ error: 'Duration must be a positive integer.' });
    }
    if (!/^\d+P$/i.test(payload.resolution)) {
      return res.status(400).json({ error: 'Resolution format invalid. Example: 768P.' });
    }

    try {
      const remote = await createTextToVideo(payload);
      const record = await createTask(db, {
        task_id: remote.task_id || `local-${Date.now()}`,
        prompt: payload.prompt,
        model: payload.model,
        duration: payload.duration,
        resolution: payload.resolution,
        prompt_optimizer: payload.prompt_optimizer,
        status: normalizeStatus(remote.status) || 'submitted',
        file_id: remote.file_id || null,
        download_url: remote.download_url || null,
        fail_reason: remote.fail_reason || null,
      });

      return res.json({
        task_id: record.task_id,
        status: record.status,
        created_at: record.created_at,
      });
    } catch (error) {
      console.error('[video/create] failed:', error.message || error);
      const failTask = await createTask(db, {
        task_id: `failed-${Date.now()}`,
        prompt: payload.prompt,
        model: payload.model,
        duration: payload.duration,
        resolution: payload.resolution,
        prompt_optimizer: payload.prompt_optimizer,
        status: 'fail',
        file_id: null,
        download_url: null,
        fail_reason: error.message || 'Failed to create task',
      });

      return res.status(502).json({
        task_id: failTask.task_id,
        status: failTask.status,
        fail_reason: failTask.fail_reason,
        created_at: failTask.created_at,
      });
    }
  });

  app.get('/api/video/task/:taskId', requirePasscode, async (req, res) => {
    const { taskId } = req.params;
    const task = await syncTaskById(db, taskId);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    return res.json(toSafeTaskPayload(task));
  });

  app.get('/api/video/file/:fileId', requirePasscode, async (req, res) => {
    const { fileId } = req.params;
    const task = await getTaskByFileIdMapped(db, fileId);
    if (!task) return res.status(404).json({ error: 'File record not found.' });

    if (!task.download_url) {
      const response = await retrieveVideoFile(fileId);
      if (response.download_url) {
        await updateTask(db, task.task_id, { download_url: response.download_url });
        task.download_url = response.download_url;
      }
    }
    return res.json({ file_id: task.file_id, download_url: task.download_url });
  });

  app.get('/api/tasks', requirePasscode, async (_req, res) => {
    const tasks = await getRecentTasksMapped(db, 100);
    res.json(tasks.map(toSafeTaskPayload));
  });

  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API Not Found' });
    }
    if (fs.existsSync(INDEX_HTML)) {
      return res.sendFile(INDEX_HTML);
    }
    return res
      .status(404)
      .send('Frontend not built. Run `npm run build` and restart server.');
  });

  app.listen(PORT, () => {
    console.log(`MiniMax studio backend running on :${PORT}`);
    console.log(`SQLite db path: ${process.env.DATABASE_PATH || './data/minimax-video-studio.sqlite'}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`Poll interval suggestion: every ${POLL_DEFAULT_INTERVAL_MS / 1000}s`);
  });
})();
