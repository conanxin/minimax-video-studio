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

  await db.run('CREATE INDEX IF NOT EXISTS idx_task_id ON tasks(task_id);');
  await db.run('CREATE INDEX IF NOT EXISTS idx_updated_at ON tasks(updated_at DESC);');

  _db = db;
  return _db;
}

function toIsoNow() {
  return new Date().toISOString();
}

async function createTask(db, record) {
  const now = toIsoNow();
  const result = await db.run(
    `INSERT INTO tasks (
      task_id, prompt, model, duration, resolution, prompt_optimizer,
      status, file_id, download_url, fail_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

async function getRecentTasks(db, limit = 50, offset = 0) {
  return db.all(
    'SELECT * FROM tasks ORDER BY datetime(updated_at) DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
}

function flattenUpdates(updates) {
  const keys = Object.keys(updates).filter((k) => updates[k] !== undefined);
  return keys;
}

async function updateTask(db, taskId, updates) {
  const keys = flattenUpdates(updates);
  if (keys.length === 0) return getTaskByTaskId(db, taskId);

  const assignments = keys
    .map((key) => `${key} = ?`)
    .join(', ');
  const values = keys.map((key) => updates[key]);

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
  updateTask,
  mapTask,
};
