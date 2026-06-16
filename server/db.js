const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let _db = null;

function resolveDatabasePath() {
  const configuredPath = process.env.DATABASE_PATH || './data/minimax-video-studio.sqlite';
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
}

async function initDb() {
  if (_db) return _db;

  const dbPath = resolveDatabasePath();
  await fs.promises.mkdir(path.dirname(dbPath), { recursive: true });

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT UNIQUE NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      duration INTEGER NOT NULL,
      resolution TEXT NOT NULL,
      prompt_optimizer INTEGER NOT NULL,
      status TEXT NOT NULL,
      file_id TEXT,
      download_url TEXT,
      fail_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Phase G: additive migration for download_url freshness tracking.
  // Each ALTER is guarded with sqlite_master so legacy databases are
  // upgraded on first open without breaking older schemas.
  // Phase I Recovery: additive migration for image-to-video fields.
  // The full first_frame_image is intentionally NEVER persisted.
  const taskColumns = await db.all('PRAGMA table_info(tasks)');
  const haveColumn = (name) => taskColumns.some((c) => c.name === name);
  if (!haveColumn('download_url_refreshed_at')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN download_url_refreshed_at TEXT');
  }
  if (!haveColumn('download_url_status')) {
    await db.exec("ALTER TABLE tasks ADD COLUMN download_url_status TEXT DEFAULT 'unknown'");
  }
  if (!haveColumn('generation_mode')) {
    await db.exec("ALTER TABLE tasks ADD COLUMN generation_mode TEXT DEFAULT 'text_to_video'");
  }
  if (!haveColumn('input_image_present')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN input_image_present INTEGER DEFAULT 0');
  }
  if (!haveColumn('input_image_type')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN input_image_type TEXT');
  }
  if (!haveColumn('input_image_host')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN input_image_host TEXT');
  }
  if (!haveColumn('input_image_mime')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN input_image_mime TEXT');
  }
  if (!haveColumn('input_image_approx_bytes')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN input_image_approx_bytes INTEGER');
  }
  if (!haveColumn('input_image_sha256_short')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN input_image_sha256_short TEXT');
  }
  if (!haveColumn('input_image_summary')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN input_image_summary TEXT');
  }

  await db.run('CREATE INDEX IF NOT EXISTS idx_task_id ON tasks(task_id);');
  await db.run('CREATE INDEX IF NOT EXISTS idx_updated_at ON tasks(updated_at DESC);');

  _db = db;
  return _db;
}

function toIsoNow() {
  return new Date().toISOString();
}

const I2V_WRITEABLE_FIELDS = new Set([
  'generation_mode',
  'input_image_present',
  'input_image_type',
  'input_image_host',
  'input_image_mime',
  'input_image_approx_bytes',
  'input_image_sha256_short',
  'input_image_summary',
]);

const I2V_NUMERIC_FIELDS = new Set(['input_image_approx_bytes']);

const I2V_BOOLEAN_FIELDS = new Set(['input_image_present']);

function normalizeI2VFields(updates) {
  if (!updates) return {};
  const out = {};
  for (const key of Object.keys(updates)) {
    if (!I2V_WRITEABLE_FIELDS.has(key)) continue;
    let value = updates[key];
    if (I2V_BOOLEAN_FIELDS.has(key)) {
      value = value ? 1 : 0;
    } else if (I2V_NUMERIC_FIELDS.has(key) && value !== null && value !== undefined) {
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      value = num;
    }
    if (value === undefined) continue;
    out[key] = value === null ? null : value;
  }
  return out;
}

async function createTask(db, record) {
  const now = toIsoNow();
  const i2vFields = normalizeI2VFields(record);
  const result = await db.run(
    `INSERT INTO tasks (
      task_id, prompt, model, duration, resolution, prompt_optimizer,
      status, file_id, download_url, fail_reason, created_at, updated_at,
      generation_mode, input_image_present, input_image_type,
      input_image_host, input_image_mime, input_image_approx_bytes,
      input_image_sha256_short, input_image_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.task_id,
      record.prompt,
      record.model,
      record.duration,
      record.resolution,
      record.prompt_optimizer ? 1 : 0,
      record.status,
      record.file_id || null,
      record.download_url || null,
      record.fail_reason || null,
      now,
      now,
      i2vFields.generation_mode || 'text_to_video',
      i2vFields.input_image_present !== undefined ? i2vFields.input_image_present : 0,
      i2vFields.input_image_type || null,
      i2vFields.input_image_host || null,
      i2vFields.input_image_mime || null,
      i2vFields.input_image_approx_bytes || null,
      i2vFields.input_image_sha256_short || null,
      i2vFields.input_image_summary || null,
    ]
  );

  return getTaskByTaskId(db, record.task_id);
}

async function getTaskByTaskId(db, taskId) {
  return db.get('SELECT * FROM tasks WHERE task_id = ?', [taskId]);
}

async function getTaskByFileId(db, fileId) {
  return db.get('SELECT * FROM tasks WHERE file_id = ?', [fileId]);
}

const ALLOWED_SORT_ORDERS = new Set(['updated_desc', 'created_desc']);
const ALLOWED_SORT_SQL = {
  updated_desc: 'datetime(updated_at) DESC',
  created_desc: 'datetime(created_at) DESC',
};

function buildTaskQuery({ status, q } = {}) {
  const where = [];
  const params = [];

  if (status) {
    where.push('status = ?');
    params.push(status);
  }

  if (q && String(q).trim().length > 0) {
    const token = `%${String(q).trim()}%`;
    where.push('(prompt LIKE ? OR model LIKE ? OR task_id LIKE ?)');
    params.push(token, token, token);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

async function getRecentTasks(db, { limit = 50, offset = 0, status = null, q = null, sort = 'updated_desc' } = {}) {
  const sortKey = ALLOWED_SORT_ORDERS.has(sort) ? sort : 'updated_desc';
  const orderSql = ALLOWED_SORT_SQL[sortKey];
  const { whereSql, params } = buildTaskQuery({ status, q });
  const sql = `SELECT * FROM tasks ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`;
  return db.all(sql, [...params, limit, offset]);
}

async function countTasks(db, { status = null, q = null } = {}) {
  const { whereSql, params } = buildTaskQuery({ status, q });
  const row = await db.get(`SELECT COUNT(*) AS total FROM tasks ${whereSql}`, params);
  return row?.total || 0;
}

function flattenUpdates(updates) {
  const keys = Object.keys(updates).filter((k) => updates[k] !== undefined);
  return keys;
}

async function updateTask(db, taskId, updates) {
  const i2vUpdates = normalizeI2VFields(updates);
  const merged = { ...updates, ...i2vUpdates };
  const keys = flattenUpdates(merged);
  if (keys.length === 0) return getTaskByTaskId(db, taskId);

  const assignments = keys
    .map((key) => `${key} = ?`)
    .join(', ');
  const values = keys.map((key) => merged[key]);

  values.push(toIsoNow());
  values.push(taskId);

  const sql = `UPDATE tasks SET ${assignments}, updated_at = ? WHERE task_id = ?`;
  await db.run(sql, values);
  return getTaskByTaskId(db, taskId);
}

function mapTask(task) {
  if (!task) return null;
  return {
    ...task,
    prompt_optimizer: Boolean(task.prompt_optimizer),
    duration: Number(task.duration),
    input_image_present: Boolean(task.input_image_present),
    input_image_approx_bytes:
      task.input_image_approx_bytes === null || task.input_image_approx_bytes === undefined
        ? null
        : Number(task.input_image_approx_bytes),
  };
}

async function getTaskByTaskIdMapped(db, taskId) {
  return mapTask(await getTaskByTaskId(db, taskId));
}

async function getTaskByFileIdMapped(db, fileId) {
  return mapTask(await getTaskByFileId(db, fileId));
}

async function getRecentTasksMapped(db, limit = 50) {
  const rows = await getRecentTasks(db, limit);
  return rows.map((r) => mapTask(r));
}

module.exports = {
  initDb,
  createTask,
  getTaskByTaskId,
  getTaskByFileId,
  getTaskByTaskIdMapped,
  getTaskByFileIdMapped,
  getRecentTasks,
  getRecentTasksMapped,
  countTasks,
  updateTask,
  mapTask,
  toIsoNow,
};
