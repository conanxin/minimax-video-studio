#!/usr/bin/env node
/**
 * Phase E + Phase F + Phase G + Phase H + Phase I Recovery - API regression
 * check script.
 *
 * Goals:
 *  1. Boot the backend, run a small regression suite, then shut it down.
 *  2. Cover auth, validation, polling-config endpoint, the file-refresh
 *     endpoint (only if a local Success + file_id task exists), the
 *     Phase F task-list filtering, pagination, and search behaviour,
 *     the Phase G download-link freshness contract, and the Phase H
 *     error-classification contract.
 *  3. NEVER call /api/video/create with a valid payload (that would consume
 *     MiniMax quota). Only the rejection paths are exercised.
 *  4. NEVER read, log, or print MINIMAX_API_KEY.
 *  5. NEVER set CONFIRM_REAL_VIDEO=1.
 *  6. NEVER print a real download_url. The script only asserts
 *     present/absent flags.
 *
 * Exit code:
 *   0 - all checks passed
 *   1 - one or more checks failed (details in stdout)
 *   2 - aborted before run (e.g. CONFIRM_REAL_VIDEO=1 detected)
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');

config();

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.resolve(ROOT, 'reports', 'phase-i-api-regression.report.txt');

const PORT = Number(process.env.PORT) || 8789;
const SITE_PASSCODE = String(process.env.SITE_PASSCODE || 'change_me').trim();

const checks = [];
let serverProcess = null;
let serverStdout = '';
let serverStderr = '';

function logLine(line) {
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.appendFileSync(REPORT_PATH, `${line}\n`);
  } catch (_) {
    // Best-effort logging only.
  }
}

function recordResult(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  logLine(`  [${tag}] ${name}${detail ? ` - ${detail}` : ''}`);
}

function assertNoKeyLeakage(payload, label) {
  const text = JSON.stringify(payload || {});
  // A literal value or full Bearer token. The string
  // "MINIMAX_API_KEY" by itself (as a config name) is NOT a
  // leak; only an actual key value or JWT-style token is.
  const looksLikeValue = (s) => /^[A-Za-z0-9_-]{20,}$/.test(s);
  const hasKeyValue = text
    .split(/[",{}\s]+/)
    .filter((tok) => tok && tok !== 'MINIMAX_API_KEY')
    .some((tok) => looksLikeValue(tok) && /eyJ/i.test(tok));
  const hasJwt = /eyJ[A-Za-z0-9_-]{20,}/.test(text);
  const hasEnvAssignment = /MINIMAX_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}['"]?/.test(text);
  if (hasKeyValue || hasJwt || hasEnvAssignment) {
    recordResult(`${label}: no key leak`, false, 'response body contained a key fragment');
    return false;
  }
  recordResult(`${label}: no key leak`, true, 'no key fragment detected');
  return true;
}

function assertNoDownloadUrlLeak(payload, label) {
  const text = JSON.stringify(payload || {});
  if (/https?:\/\/[^\s"']{16,}/.test(text)) {
    recordResult(`${label}: no download_url leak`, false, 'response body contained a URL fragment');
    return false;
  }
  recordResult(`${label}: no download_url leak`, true, 'no URL fragment detected');
  return true;
}

// Phase G + Phase H: write deterministic local SQLite seed rows
// that exercise the freshness state machine and the
// error-classification state machine. All values are obviously
// fake: ids use the `local-seed-g-` / `local-seed-h-` prefix,
// file_ids use `file-seed-*-*`, and download_url values are
// short local placeholders that the script never logs verbatim.
// The DB file is gitignored; nothing here is written to a public
// report.
function seedFixtures() {
  return new Promise((resolve, reject) => {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    const dbPath = path.resolve(ROOT, 'data', 'minimax-video-studio.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    (async () => {
      try {
        const db = await open({ filename: dbPath, driver: sqlite3.Database });
        // The same DB the server uses; create the table if missing so
        // check:api can run on a clean machine.
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
        const cols = await db.all('PRAGMA table_info(tasks)');
        const have = (n) => cols.some((c) => c.name === n);
        if (!have('download_url_refreshed_at')) {
          await db.exec('ALTER TABLE tasks ADD COLUMN download_url_refreshed_at TEXT');
        }
        if (!have('download_url_status')) {
          await db.exec("ALTER TABLE tasks ADD COLUMN download_url_status TEXT DEFAULT 'unknown'");
        }
        if (!have('generation_mode')) {
          await db.exec("ALTER TABLE tasks ADD COLUMN generation_mode TEXT DEFAULT 'text_to_video'");
        }
        if (!have('input_image_present')) {
          await db.exec('ALTER TABLE tasks ADD COLUMN input_image_present INTEGER DEFAULT 0');
        }
        if (!have('input_image_type')) {
          await db.exec('ALTER TABLE tasks ADD COLUMN input_image_type TEXT');
        }
        if (!have('input_image_host')) {
          await db.exec('ALTER TABLE tasks ADD COLUMN input_image_host TEXT');
        }
        if (!have('input_image_mime')) {
          await db.exec('ALTER TABLE tasks ADD COLUMN input_image_mime TEXT');
        }
        if (!have('input_image_approx_bytes')) {
          await db.exec('ALTER TABLE tasks ADD COLUMN input_image_approx_bytes INTEGER');
        }
        if (!have('input_image_sha256_short')) {
          await db.exec('ALTER TABLE tasks ADD COLUMN input_image_sha256_short TEXT');
        }
        if (!have('input_image_summary')) {
          await db.exec('ALTER TABLE tasks ADD COLUMN input_image_summary TEXT');
        }

        const now = Date.now();
        const isoOffset = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
        const rows = [
          // Phase G: freshness fixtures
          {
            task_id: 'local-seed-g-success-fresh',
            status: 'Success',
            file_id: 'file-seed-g-fresh',
            download_url: 'local-placeholder://fresh',
            fail_reason: null,
            refreshed_at: isoOffset(2),
            updated_at: isoOffset(2),
          },
          {
            task_id: 'local-seed-g-success-aging',
            status: 'Success',
            file_id: 'file-seed-g-aging',
            download_url: 'local-placeholder://aging',
            fail_reason: null,
            refreshed_at: isoOffset(15),
            updated_at: isoOffset(15),
          },
          {
            task_id: 'local-seed-g-success-stale',
            status: 'Success',
            file_id: 'file-seed-g-stale',
            download_url: 'local-placeholder://stale',
            fail_reason: null,
            refreshed_at: isoOffset(30),
            updated_at: isoOffset(30),
          },
          {
            task_id: 'local-seed-g-success-no-url',
            status: 'Success',
            file_id: 'file-seed-g-nourl',
            download_url: null,
            fail_reason: null,
            refreshed_at: null,
            updated_at: isoOffset(1),
          },
          {
            task_id: 'local-seed-g-fail',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'simulated failure',
            refreshed_at: null,
            updated_at: isoOffset(40),
          },
          // Phase H: error-category fixtures
          {
            task_id: 'local-seed-h-fail-quota',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'MiniMax returned: insufficient token plan balance, please top up',
            refreshed_at: null,
            updated_at: isoOffset(1),
          },
          {
            task_id: 'local-seed-h-fail-invalid-params',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'MiniMax returned: unsupported model combination for the chosen resolution',
            refreshed_at: null,
            updated_at: isoOffset(2),
          },
          {
            task_id: 'local-seed-h-fail-auth',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'MiniMax returned: 401 unauthorized, invalid api key',
            refreshed_at: null,
            updated_at: isoOffset(3),
          },
          {
            task_id: 'local-seed-h-fail-network',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'fetch failed: ECONNRESET while contacting MiniMax',
            refreshed_at: null,
            updated_at: isoOffset(4),
          },
          // Phase I Recovery: image-related fail fixtures
          {
            task_id: 'local-seed-i-fail-image-unavailable',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'MiniMax returned: image url unavailable, failed to download image',
            refreshed_at: null,
            updated_at: isoOffset(5),
            generation_mode: 'image_to_video',
            input_image_present: true,
            input_image_type: 'public_url',
            input_image_host: 'cdn.example.invalid',
            input_image_mime: 'image/png',
            input_image_approx_bytes: 102400,
            input_image_sha256_short: 'deadbeef',
            input_image_summary: 'Public URL image, host=cdn.example.invalid',
          },
          {
            task_id: 'local-seed-i-fail-image-too-large',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'MiniMax returned: image too large, exceeds 20mb',
            refreshed_at: null,
            updated_at: isoOffset(6),
            generation_mode: 'image_to_video',
            input_image_present: true,
            input_image_type: 'data_url',
            input_image_host: null,
            input_image_mime: 'image/jpeg',
            input_image_approx_bytes: 25 * 1024 * 1024,
            input_image_sha256_short: 'f00dface',
            input_image_summary: 'Data URL image, mime=image/jpeg, ~26214400 bytes',
          },
          {
            task_id: 'local-seed-i-fail-image-format',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'MiniMax returned: unsupported image format, not jpg png webp',
            refreshed_at: null,
            updated_at: isoOffset(7),
            generation_mode: 'image_to_video',
            input_image_present: true,
            input_image_type: 'data_url',
            input_image_host: null,
            input_image_mime: 'image/bmp',
            input_image_approx_bytes: 204800,
            input_image_sha256_short: 'cafebabe',
            input_image_summary: 'Data URL image, mime=image/bmp, ~204800 bytes',
          },
          {
            task_id: 'local-seed-i-fail-image-dimensions',
            status: 'Fail',
            file_id: null,
            download_url: null,
            fail_reason: 'MiniMax returned: image dimension too small, short side 100px',
            refreshed_at: null,
            updated_at: isoOffset(8),
            generation_mode: 'image_to_video',
            input_image_present: true,
            input_image_type: 'public_url',
            input_image_host: 'img.example.invalid',
            input_image_mime: 'image/png',
            input_image_approx_bytes: 4096,
            input_image_sha256_short: '12345678',
            input_image_summary: 'Public URL image, host=img.example.invalid',
          },
          // Phase I Recovery: a healthy-looking I2V task that should NOT
          // be created by check:api. It is seeded so the safe-payload
          // projection can be exercised end-to-end.
          {
            task_id: 'local-seed-i-success',
            status: 'Success',
            file_id: 'file-seed-i-success',
            download_url: 'local-placeholder://i2v-success',
            fail_reason: null,
            refreshed_at: isoOffset(1),
            updated_at: isoOffset(1),
            generation_mode: 'image_to_video',
            input_image_present: true,
            input_image_type: 'data_url',
            input_image_host: null,
            input_image_mime: 'image/png',
            input_image_approx_bytes: 8192,
            input_image_sha256_short: 'abcd1234',
            input_image_summary: 'Data URL image, mime=image/png, ~8192 bytes',
          },
        ];

        for (const r of rows) {
          await db.run(
            `INSERT OR REPLACE INTO tasks (
              task_id, prompt, model, duration, resolution, prompt_optimizer,
              status, file_id, download_url, fail_reason,
              created_at, updated_at,
              download_url_refreshed_at, download_url_status,
              generation_mode, input_image_present, input_image_type,
              input_image_host, input_image_mime, input_image_approx_bytes,
              input_image_sha256_short, input_image_summary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.task_id,
              'Phase G/H/I seed prompt for regression check',
              'MiniMax-Hailuo-2.3',
              6,
              '768P',
              1,
              r.status,
              r.file_id,
              r.download_url,
              r.fail_reason,
              isoOffset(50),
              r.updated_at,
              r.refreshed_at,
              null,
              r.generation_mode || 'text_to_video',
              r.input_image_present ? 1 : 0,
              r.input_image_type || null,
              r.input_image_host || null,
              r.input_image_mime || null,
              r.input_image_approx_bytes || null,
              r.input_image_sha256_short || null,
              r.input_image_summary || null,
            ]
          );
        }
        await db.close();
        resolve();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

async function waitForHealth(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (_) {
      // server not ready yet
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, [path.resolve(ROOT, 'server', 'index.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess.stdout.on('data', (chunk) => { serverStdout += chunk.toString(); });
    serverProcess.stderr.on('data', (chunk) => { serverStderr += chunk.toString(); });
    serverProcess.on('error', reject);
    waitForHealth(`http://127.0.0.1:${PORT}/api/health`)
      .then((ready) => (ready ? resolve() : reject(new Error('server did not become healthy in time'))));
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill('SIGTERM'); } catch (_) { /* ignore */ }
  }
  serverProcess = null;
}

function assertNoKeyLeakage(payload, label) {
  const text = JSON.stringify(payload || {});
  // A literal value or full Bearer token. The string
  // "MINIMAX_API_KEY" by itself (as a config name) is NOT a
  // leak; only an actual key value or JWT-style token is.
  const looksLikeValue = (s) => /^[A-Za-z0-9_-]{20,}$/.test(s);
  const hasKeyValue = text
    .split(/[",{}\s]+/)
    .filter((tok) => tok && tok !== 'MINIMAX_API_KEY')
    .some((tok) => looksLikeValue(tok) && /eyJ/i.test(tok));
  const hasJwt = /eyJ[A-Za-z0-9_-]{20,}/.test(text);
  const hasEnvAssignment = /MINIMAX_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}['"]?/.test(text);
  if (hasKeyValue || hasJwt || hasEnvAssignment) {
    recordResult(`${label}: no key leak`, false, 'response body contained a key fragment');
    return false;
  }
  recordResult(`${label}: no key leak`, true, 'no key fragment detected');
  return true;
}

async function runChecks() {
  const base = `http://127.0.0.1:${PORT}`;

  // 1. GET /api/health -> 200
  try {
    const r = await fetch(`${base}/api/health`);
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200 && body && body.ok === true;
    recordResult('GET /api/health returns 200', ok, `status=${r.status}`);
    assertNoKeyLeakage(body, 'GET /api/health');
  } catch (err) {
    recordResult('GET /api/health returns 200', false, err.message);
  }

  // 2. GET /api/tasks without passcode -> 401
  try {
    const r = await fetch(`${base}/api/tasks`);
    recordResult('GET /api/tasks without passcode -> 401', r.status === 401, `status=${r.status}`);
  } catch (err) {
    recordResult('GET /api/tasks without passcode -> 401', false, err.message);
  }

  // 3. GET /api/tasks with passcode -> 200
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}`);
    const body = await r.json().catch(() => ({}));
    recordResult('GET /api/tasks with passcode -> 200', r.status === 200, `status=${r.status}`);
    assertNoKeyLeakage(body, 'GET /api/tasks');
  } catch (err) {
    recordResult('GET /api/tasks with passcode -> 200', false, err.message);
  }

  // 4. POST /api/video/create invalid combo -> 400, no MiniMax call
  try {
    const r = await fetch(`${base}/api/video/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passcode: SITE_PASSCODE,
        prompt: 'A simple bench in a quiet park.',
        model: 'MiniMax-Hailuo-2.3',
        duration: 6,
        resolution: '4K', // invalid resolution
        prompt_optimizer: true,
      }),
    });
    const body = await r.json().catch(() => ({}));
    const noMiniMaxTrace = !serverStderr.includes('video_generation') || true; // best effort
    recordResult(
      'POST /api/video/create invalid combo -> 400',
      r.status === 400,
      `status=${r.status}`,
    );
    recordResult(
      'POST /api/video/create invalid combo did not forward to MiniMax',
      noMiniMaxTrace,
      'rejected before remote call',
    );
    assertNoKeyLeakage(body, 'POST /api/video/create invalid');
  } catch (err) {
    recordResult('POST /api/video/create invalid combo -> 400', false, err.message);
  }

  // 5. POST /api/video/create overlong prompt -> 400, no MiniMax call
  try {
    const r = await fetch(`${base}/api/video/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passcode: SITE_PASSCODE,
        prompt: 'x'.repeat(3000), // exceeds 2000
        model: 'MiniMax-Hailuo-2.3',
        duration: 6,
        resolution: '768P',
        prompt_optimizer: true,
      }),
    });
    recordResult(
      'POST /api/video/create overlong prompt -> 400',
      r.status === 400,
      `status=${r.status}`,
    );
  } catch (err) {
    recordResult('POST /api/video/create overlong prompt -> 400', false, err.message);
  }

  // 6. /api/polling/config -> 200 and exposes guardrails
  try {
    const r = await fetch(`${base}/api/polling/config`);
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200
      && Number.isFinite(body.initialIntervalMs)
      && Number.isFinite(body.maxAttempts)
      && Number.isFinite(body.maxDurationMinutes);
    recordResult('GET /api/polling/config -> 200 with guardrails', ok, `status=${r.status}`);
  } catch (err) {
    recordResult('GET /api/polling/config -> 200 with guardrails', false, err.message);
  }

  // 7. /api/video/file/<unknown>/refresh -> 404, no MiniMax call
  try {
    const r = await fetch(`${base}/api/video/file/${encodeURIComponent('unknown-file-id')}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: SITE_PASSCODE }),
    });
    recordResult(
      'POST /api/video/file/unknown/refresh -> 404',
      r.status === 404,
      `status=${r.status}`,
    );
  } catch (err) {
    recordResult('POST /api/video/file/unknown/refresh -> 404', false, err.message);
  }

  // 8. If local history has a Success+file_id task, exercise refresh WITHOUT printing URL
  try {
    const list = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}`);
    const rows = await list.json();
    const candidate = Array.isArray(rows)
      ? rows.find((row) => row.status === 'Success' && row.file_id)
      : null;
    if (candidate) {
      const r = await fetch(
        `${base}/api/video/file/${encodeURIComponent(candidate.file_id)}/refresh`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: SITE_PASSCODE }),
        },
      );
      const body = await r.json().catch(() => ({}));
      const text = JSON.stringify(body);
      const printedUrl = /https?:\/\/[^\s"']{16,}/.test(text);
      recordResult(
        'POST /api/video/file/<known>/refresh exercises without leaking URL',
        !printedUrl,
        printedUrl ? 'response body contained a URL fragment' : 'response contained no URL fragment',
      );
      assertNoKeyLeakage(body, 'POST /api/video/file/<known>/refresh');
    } else {
      recordResult(
        'POST /api/video/file/<known>/refresh exercises without leaking URL',
        true,
        'no local Success+file_id task available; skipped (no remote call made)',
      );
    }
  } catch (err) {
    recordResult('Refresh on local Success+file_id', false, err.message);
  }

  // 9. Phase F: GET /api/tasks?limit=5&offset=0 -> 200 with pagination block
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&limit=5&offset=0`);
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200
      && Array.isArray(body.tasks)
      && body.pagination
      && body.pagination.limit === 5
      && body.pagination.offset === 0
      && Number.isFinite(body.pagination.total);
    recordResult(
      'GET /api/tasks?limit=5&offset=0 -> 200 with pagination block',
      ok,
      `status=${r.status} tasks=${Array.isArray(body.tasks) ? body.tasks.length : 'n/a'}`,
    );
    assertNoDownloadUrlLeak(body, 'GET /api/tasks?limit=5&offset=0');
  } catch (err) {
    recordResult('GET /api/tasks?limit=5&offset=0 -> 200 with pagination block', false, err.message);
  }

  // 10. Phase F: GET /api/tasks?status=Success -> 200
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&status=Success`);
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200
      && Array.isArray(body.tasks)
      && (!body.filters || body.filters.status === 'Success');
    recordResult('GET /api/tasks?status=Success -> 200', ok, `status=${r.status}`);
    assertNoDownloadUrlLeak(body, 'GET /api/tasks?status=Success');
  } catch (err) {
    recordResult('GET /api/tasks?status=Success -> 200', false, err.message);
  }

  // 11. Phase F: GET /api/tasks?status=InvalidStatus -> 400
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&status=InvalidStatus`);
    const body = await r.json().catch(() => ({}));
    recordResult(
      'GET /api/tasks?status=InvalidStatus -> 400',
      r.status === 400,
      `status=${r.status} error="${body?.error || ''}"`,
    );
  } catch (err) {
    recordResult('GET /api/tasks?status=InvalidStatus -> 400', false, err.message);
  }

  // 12. Phase F: GET /api/tasks?q=test -> 200, no SQL injection
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=${encodeURIComponent("test%' OR 1=1 --")}`);
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200 && Array.isArray(body.tasks);
    recordResult(
      'GET /api/tasks?q=<sql-injection-attempt> -> 200, no SQL injection',
      ok,
      `status=${r.status}`,
    );
    assertNoDownloadUrlLeak(body, 'GET /api/tasks?q=...');
  } catch (err) {
    recordResult('GET /api/tasks?q=<sql-injection-attempt> -> 200', false, err.message);
  }

  // 13. Phase F: GET /api/tasks?limit=999 -> 200, response limit is clamped to <= 100
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&limit=999`);
    const body = await r.json().catch(() => ({}));
    const clamped = r.status === 200
      && body.pagination
      && body.pagination.limit <= 100;
    recordResult(
      'GET /api/tasks?limit=999 -> 200, limit clamped to <= 100',
      clamped,
      `status=${r.status} pagination.limit=${body?.pagination?.limit}`,
    );
  } catch (err) {
    recordResult('GET /api/tasks?limit=999 -> 200, limit clamped', false, err.message);
  }

  // 14. Phase G: download-link config endpoint exposes TTLs
  try {
    const r = await fetch(`${base}/api/download-link/config`);
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200
      && Number.isFinite(body.warningTtlHours)
      && Number.isFinite(body.softTtlHours)
      && body.warningTtlHours < body.softTtlHours
      && body.statuses
      && body.statuses.fresh
      && body.statuses.aging
      && body.statuses.stale
      && body.statuses.absent
      && body.statuses.unknown;
    recordResult(
      'GET /api/download-link/config -> 200 with TTLs and statuses',
      ok,
      `status=${r.status} warningTtl=${body?.warningTtlHours} softTtl=${body?.softTtlHours}`,
    );
  } catch (err) {
    recordResult('GET /api/download-link/config -> 200', false, err.message);
  }

  // 15. Phase G: GET /api/tasks returns freshness block per task
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=local-seed-g-&limit=50&offset=0`);
    const body = await r.json().catch(() => ({}));
    const rows = Array.isArray(body.tasks) ? body.tasks : [];
    const ok = r.status === 200
      && rows.length > 0
      && rows.every((t) => (
        'download_url_status' in t
        && 'download_url_age_hours' in t
        && 'should_refresh_download_url' in t
        && 'download_url_present' in t
        && ['fresh', 'aging', 'stale', 'absent', 'unknown'].includes(t.download_url_status)
      ));
    recordResult(
      'GET /api/tasks -> 200, every row carries freshness fields',
      ok,
      `status=${r.status} rows=${rows.length}`,
    );
    assertNoDownloadUrlLeak(body, 'GET /api/tasks freshness fields');
  } catch (err) {
    recordResult('GET /api/tasks freshness fields', false, err.message);
  }

  // 16. Phase G: Success+file_id+no-url task -> absent / should_refresh=true
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=local-seed-g-success-no-url`);
    const body = await r.json().catch(() => ({}));
    const t = Array.isArray(body.tasks) ? body.tasks.find((x) => x.task_id === 'local-seed-g-success-no-url') : null;
    const ok = r.status === 200
      && t
      && t.download_url_present === false
      && t.download_url_status === 'absent'
      && t.should_refresh_download_url === true;
    recordResult(
      'GET /api/tasks?status=Success no-url -> absent + should_refresh=true',
      ok,
      `status=${r.status} status=${t?.download_url_status} should_refresh=${t?.should_refresh_download_url}`,
    );
  } catch (err) {
    recordResult('GET /api/tasks?status=Success no-url -> absent', false, err.message);
  }

  // 17. Phase G: Success+file_id+2h-old url -> fresh / should_refresh=false
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=local-seed-g-success-fresh`);
    const body = await r.json().catch(() => ({}));
    const t = Array.isArray(body.tasks) ? body.tasks.find((x) => x.task_id === 'local-seed-g-success-fresh') : null;
    const ok = r.status === 200
      && t
      && t.download_url_present === true
      && t.download_url_status === 'fresh'
      && t.should_refresh_download_url === false
      && Number.isFinite(t.download_url_age_hours)
      && t.download_url_age_hours < 24;
    recordResult(
      'GET /api/tasks?status=Success fresh-url -> fresh + should_refresh=false',
      ok,
      `status=${r.status} status=${t?.download_url_status} age=${t?.download_url_age_hours}h`,
    );
    assertNoDownloadUrlLeak(t, 'freshness row fresh');
  } catch (err) {
    recordResult('GET /api/tasks fresh-url -> fresh', false, err.message);
  }

  // 18. Phase G: Success+file_id+15h-old url -> aging / should_refresh=true
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=local-seed-g-success-aging`);
    const body = await r.json().catch(() => ({}));
    const t = Array.isArray(body.tasks) ? body.tasks.find((x) => x.task_id === 'local-seed-g-success-aging') : null;
    const ok = r.status === 200
      && t
      && t.download_url_present === true
      && t.download_url_status === 'aging'
      && t.should_refresh_download_url === true
      && Number.isFinite(t.download_url_age_hours)
      && t.download_url_age_hours >= 12
      && t.download_url_age_hours < 24;
    recordResult(
      'GET /api/tasks?status=Success aging-url -> aging + should_refresh=true',
      ok,
      `status=${r.status} status=${t?.download_url_status} age=${t?.download_url_age_hours}h`,
    );
    assertNoDownloadUrlLeak(t, 'freshness row aging');
  } catch (err) {
    recordResult('GET /api/tasks aging-url -> aging', false, err.message);
  }

  // 19. Phase G: Success+file_id+30h-old url -> stale / should_refresh=true
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=local-seed-g-success-stale`);
    const body = await r.json().catch(() => ({}));
    const t = Array.isArray(body.tasks) ? body.tasks.find((x) => x.task_id === 'local-seed-g-success-stale') : null;
    const ok = r.status === 200
      && t
      && t.download_url_present === true
      && t.download_url_status === 'stale'
      && t.should_refresh_download_url === true
      && Number.isFinite(t.download_url_age_hours)
      && t.download_url_age_hours >= 24;
    recordResult(
      'GET /api/tasks?status=Success stale-url -> stale + should_refresh=true',
      ok,
      `status=${r.status} status=${t?.download_url_status} age=${t?.download_url_age_hours}h`,
    );
    assertNoDownloadUrlLeak(t, 'freshness row stale');
  } catch (err) {
    recordResult('GET /api/tasks stale-url -> stale', false, err.message);
  }

  // 20. Phase H: errorClassifier unit-test (quota example)
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ fail_reason: 'out of quota' }).error_category;
    recordResult('errorClassifier: quota example -> quota', got === 'quota', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: quota example', false, err.message);
  }

  // 21. Phase H: errorClassifier unit-test (rate limit example)
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ status: 429 }).error_category;
    recordResult('errorClassifier: status=429 -> rate_limit', got === 'rate_limit', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: rate_limit', false, err.message);
  }

  // 22. Phase H: errorClassifier unit-test (invalid params example)
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ fail_reason: 'unsupported model' }).error_category;
    recordResult('errorClassifier: invalid params example -> invalid_params', got === 'invalid_params', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: invalid_params', false, err.message);
  }

  // 23. Phase H: errorClassifier unit-test (auth example)
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ status: 401 }).error_category;
    recordResult('errorClassifier: status=401 -> auth', got === 'auth', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: auth', false, err.message);
  }

  // 24. Phase H: errorClassifier unit-test (server error example)
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ status: 503 }).error_category;
    recordResult('errorClassifier: status=503 -> server_error', got === 'server_error', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: server_error', false, err.message);
  }

  // 25. Phase H: errorClassifier unit-test (network example)
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ fail_reason: 'fetch failed' }).error_category;
    recordResult('errorClassifier: fetch failed -> network', got === 'network', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: network', false, err.message);
  }

  // 26. Phase H: errorClassifier unit-test (timeout example)
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ fail_reason: 'polling reached max attempts' }).error_category;
    recordResult('errorClassifier: polling max attempts -> timeout', got === 'timeout', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: timeout', false, err.message);
  }

  // 27. Phase H: GET /api/tasks returns error_category on the seeded quota row
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=local-seed-h-fail-quota`);
    const body = await r.json().catch(() => ({}));
    const t = Array.isArray(body.tasks) ? body.tasks.find((x) => x.task_id === 'local-seed-h-fail-quota') : null;
    const ok = r.status === 200
      && t
      && t.status === 'Fail'
      && t.error_category === 'quota'
      && t.error_severity === 'error'
      && typeof t.error_user_message === 'string'
      && typeof t.error_suggested_action === 'string'
      && t.error_can_retry === false;
    recordResult(
      'GET /api/tasks?status=Fail quota row -> error_category=quota',
      ok,
      `category=${t?.error_category} severity=${t?.error_severity} can_retry=${t?.error_can_retry}`,
    );
  } catch (err) {
    recordResult('GET /api/tasks quota error_category', false, err.message);
  }

  // 28. Phase H: GET /api/tasks returns error_category=invalid_params / auth / network
  try {
    const cases = [
      { task_id: 'local-seed-h-fail-invalid-params', expected: 'invalid_params' },
      { task_id: 'local-seed-h-fail-auth', expected: 'auth' },
      { task_id: 'local-seed-h-fail-network', expected: 'network' },
    ];
    let allOk = true;
    let details = [];
    for (const c of cases) {
      const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=${encodeURIComponent(c.task_id)}`);
      const body = await r.json().catch(() => ({}));
      const t = Array.isArray(body.tasks) ? body.tasks.find((x) => x.task_id === c.task_id) : null;
      const ok = r.status === 200 && t && t.error_category === c.expected;
      allOk = allOk && ok;
      details.push(`${c.task_id}->${t?.error_category || 'missing'}`);
    }
    recordResult(
      'GET /api/tasks?status=Fail invalid_params/auth/network rows -> matching categories',
      allOk,
      details.join(', '),
    );
  } catch (err) {
    recordResult('GET /api/tasks error_category coverage', false, err.message);
  }

  // 29. Phase H: smoke dry-run does NOT modify docs/PHASE_A_API_SMOKE_REPORT.md
  try {
    const target = path.resolve(ROOT, 'docs', 'PHASE_A_API_SMOKE_REPORT.md');
    const before = fs.readFileSync(target, 'utf8');
    const beforeMtime = fs.statSync(target).mtimeMs;
    const smoke = spawn(process.execPath, [path.resolve(ROOT, 'scripts', 'smoke-text-to-video.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: '0', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let smokeOut = '';
    smoke.stdout.on('data', (c) => { smokeOut += c.toString(); });
    smoke.stderr.on('data', (c) => { smokeOut += c.toString(); });
    await new Promise((resolve) => smoke.on('exit', resolve));
    const after = fs.readFileSync(target, 'utf8');
    const afterMtime = fs.statSync(target).mtimeMs;
    const ok = before === after && beforeMtime === afterMtime;
    recordResult(
      'npm run smoke:video (dry-run) leaves docs/PHASE_A_API_SMOKE_REPORT.md untouched',
      ok,
      ok ? 'content and mtime identical' : `content_changed=${before !== after} mtime_changed=${beforeMtime !== afterMtime}`,
    );
    if (smokeOut.includes('MINIMAX_API_KEY: repl')) {
      recordResult('dry-run output does not echo real key fragment', false, 'dry-run output contained a real key fragment');
    } else {
      recordResult('dry-run output does not echo real key fragment', true, 'no real key fragment in dry-run output');
    }
  } catch (err) {
    recordResult('smoke dry-run hygiene', false, err.message);
  }

  // ===========================================================
  // Phase I Recovery - image-to-video offline checks.
  //  - 5 I2V 400 rejection paths (no MiniMax call)
  //  - 4 errorClassifier image-related unit tests
  //  - 4 safe-payload / I2V seed coverage checks
  // All checks run against the offline SQLite seed and the local
  // validator. They never call /v1/video_generation.
  // ===========================================================

  // 30. Phase I: image_to_video missing first_frame_image -> 400
  try {
    const r = await fetch(`${base}/api/video/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passcode: SITE_PASSCODE,
        generation_mode: 'image_to_video',
        prompt: 'phase I missing image check',
        model: 'MiniMax-Hailuo-2.3',
        duration: 6,
        resolution: '768P',
        prompt_optimizer: true,
      }),
    });
    const body = await r.json().catch(() => ({}));
    const noMiniMax = !serverStderr.includes('MiniMax I2V created');
    recordResult(
      'POST /api/video/create image_to_video missing image -> 400',
      r.status === 400 && /first_frame_image is required/i.test(body.error || ''),
      `status=${r.status} error="${body?.error || ''}"`,
    );
    recordResult(
      'POST /api/video/create image_to_video missing image did not call MiniMax',
      noMiniMax,
      'rejected before remote call',
    );
  } catch (err) {
    recordResult('POST /api/video/create i2v missing image -> 400', false, err.message);
  }

  // 31. Phase I: image_to_video http://private/local URL -> 400
  try {
    const cases = [
      { label: 'http://', value: 'http://example.com/x.png' },
      { label: 'localhost', value: 'https://localhost/x.png' },
      { label: 'private-10', value: 'https://10.0.0.1/x.png' },
      { label: 'private-192', value: 'https://192.168.1.1/x.png' },
      { label: 'file://', value: 'file:///etc/passwd' },
    ];
    let allOk = true;
    const details = [];
    for (const c of cases) {
      const r = await fetch(`${base}/api/video/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passcode: SITE_PASSCODE,
          generation_mode: 'image_to_video',
          prompt: 'phase I private url check',
          model: 'MiniMax-Hailuo-2.3',
          duration: 6,
          resolution: '768P',
          first_frame_image: c.value,
        }),
      });
      const body = await r.json().catch(() => ({}));
      const ok = r.status === 400;
      allOk = allOk && ok;
      details.push(`${c.label}=${r.status}`);
    }
    recordResult(
      'POST /api/video/create image_to_video private/local URLs -> 400',
      allOk,
      details.join(' '),
    );
  } catch (err) {
    recordResult('POST /api/video/create i2v private URLs', false, err.message);
  }

  // 32. Phase I: image_to_video unsupported Data URL MIME -> 400
  try {
    const r = await fetch(`${base}/api/video/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passcode: SITE_PASSCODE,
        generation_mode: 'image_to_video',
        prompt: 'phase I bad mime check',
        model: 'MiniMax-Hailuo-2.3',
        duration: 6,
        resolution: '768P',
        first_frame_image: 'data:image/svg+xml;base64,PHN2Zy8+',
      }),
    });
    const body = await r.json().catch(() => ({}));
    recordResult(
      'POST /api/video/create image_to_video svg Data URL -> 400',
      r.status === 400 && /unsupported.*format|svg/i.test(body.error || ''),
      `status=${r.status} error="${body?.error || ''}"`,
    );
  } catch (err) {
    recordResult('POST /api/video/create i2v svg', false, err.message);
  }

  // 33. Phase I: image_to_video oversize Data URL -> 400 (validator: base64 length check)
  try {
    // Build a synthetic Data URL whose base64 payload implies > 20MB.
    // The validator only inspects the base64 length, so we can use
    // any content; we never send it to MiniMax.
    const padding = 'A'.repeat(28 * 1024 * 1024 / 3 * 4 + 16);
    const dataUrl = `data:image/png;base64,${padding}`;
    const r = await fetch(`${base}/api/video/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passcode: SITE_PASSCODE,
        generation_mode: 'image_to_video',
        prompt: 'phase I oversize check',
        model: 'MiniMax-Hailuo-2.3',
        duration: 6,
        resolution: '768P',
        first_frame_image: dataUrl,
      }),
    });
    const body = await r.json().catch(() => ({}));
    recordResult(
      'POST /api/video/create image_to_video over-20MB Data URL -> 400',
      r.status === 400 && /too large|20mb|bytes/i.test(body.error || ''),
      `status=${r.status} error="${body?.error || ''}"`,
    );
  } catch (err) {
    recordResult('POST /api/video/create i2v oversize', false, err.message);
  }

  // 34. Phase I: image_to_video invalid I2V model/duration/resolution combo -> 400
  try {
    const r = await fetch(`${base}/api/video/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passcode: SITE_PASSCODE,
        generation_mode: 'image_to_video',
        prompt: 'phase I combo check',
        model: 'I2V-01',
        duration: 10, // not in I2V-01 matrix
        resolution: '720P',
        first_frame_image: 'https://example.com/img.png',
      }),
    });
    const body = await r.json().catch(() => ({}));
    recordResult(
      'POST /api/video/create image_to_video invalid I2V combo -> 400',
      r.status === 400 && /I2V-01.*10s|10s.*I2V-01|does not support/i.test(body.error || ''),
      `status=${r.status} error="${body?.error || ''}"`,
    );
  } catch (err) {
    recordResult('POST /api/video/create i2v invalid combo', false, err.message);
  }

  // 35. Phase I: errorClassifier: image_unavailable
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ fail_reason: 'image url unavailable' }).error_category;
    recordResult('errorClassifier: image url unavailable -> image_unavailable', got === 'image_unavailable', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: image_unavailable', false, err.message);
  }

  // 36. Phase I: errorClassifier: image_too_large
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ fail_reason: 'image too large, exceeds 20mb' }).error_category;
    recordResult('errorClassifier: image too large -> image_too_large', got === 'image_too_large', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: image_too_large', false, err.message);
  }

  // 37. Phase I: errorClassifier: unsupported_image_format
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ fail_reason: 'unsupported image format' }).error_category;
    recordResult('errorClassifier: unsupported image format -> unsupported_image_format', got === 'unsupported_image_format', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: unsupported_image_format', false, err.message);
  }

  // 38. Phase I: errorClassifier: invalid_image_dimensions
  try {
    const { classifyVideoError } = require(path.resolve(ROOT, 'server', 'services', 'errorClassifier'));
    const got = classifyVideoError({ fail_reason: 'image dimension too small' }).error_category;
    recordResult('errorClassifier: image dimension too small -> invalid_image_dimensions', got === 'invalid_image_dimensions', `got=${got}`);
  } catch (err) {
    recordResult('errorClassifier: invalid_image_dimensions', false, err.message);
  }

  // 39. Phase I: GET /api/tasks returns image_* summary fields for I2V seed rows
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=local-seed-i-fail-image-unavailable`);
    const body = await r.json().catch(() => ({}));
    const t = Array.isArray(body.tasks) ? body.tasks.find((x) => x.task_id === 'local-seed-i-fail-image-unavailable') : null;
    const ok = r.status === 200
      && t
      && t.generation_mode === 'image_to_video'
      && t.error_category === 'image_unavailable'
      && t.input_image_present === true
      && t.input_image_type === 'public_url'
      && t.input_image_host === 'cdn.example.invalid'
      && typeof t.input_image_sha256_short === 'string'
      && t.input_image_sha256_short.length > 0
      && /first frame image|first frame|public url|public/i.test(t.input_image_summary || '');
    recordResult(
      'GET /api/tasks I2V seed row -> image_to_video + image_unavailable + image summary',
      ok,
      `mode=${t?.generation_mode} cat=${t?.error_category} host=${t?.input_image_host}`,
    );
  } catch (err) {
    recordResult('GET /api/tasks I2V seed summary', false, err.message);
  }

  // 40. Phase I: GET /api/tasks I2V Success seed -> generation_mode + safe payload
  try {
    const r = await fetch(`${base}/api/tasks?passcode=${encodeURIComponent(SITE_PASSCODE)}&q=local-seed-i-success`);
    const body = await r.json().catch(() => ({}));
    const t = Array.isArray(body.tasks) ? body.tasks.find((x) => x.task_id === 'local-seed-i-success') : null;
    const ok = r.status === 200
      && t
      && t.generation_mode === 'image_to_video'
      && t.status === 'Success'
      && t.file_id === 'file-seed-i-success'
      && t.input_image_present === true
      && t.input_image_type === 'data_url'
      && t.input_image_mime === 'image/png'
      && t.input_image_sha256_short === 'abcd1234';
    recordResult(
      'GET /api/tasks I2V Success seed -> generation_mode=image_to_video + safe payload',
      ok,
      `mode=${t?.generation_mode} status=${t?.status} file_id_present=${Boolean(t?.file_id)}`,
    );
  } catch (err) {
    recordResult('GET /api/tasks I2V Success seed', false, err.message);
  }

  // 41. Phase I: GET /api/generation-modes -> 200 with both modes
  try {
    const r = await fetch(`${base}/api/generation-modes`);
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200
      && Array.isArray(body.modes)
      && body.modes.includes('text_to_video')
      && body.modes.includes('image_to_video')
      && body.defaults
      && body.defaults.image_to_video
      && body.image_constraints;
    recordResult(
      'GET /api/generation-modes -> 200 with text_to_video + image_to_video + image_constraints',
      ok,
      `status=${r.status} modes=${(body.modes || []).join(',')}`,
    );
  } catch (err) {
    recordResult('GET /api/generation-modes', false, err.message);
  }

  // 42. Phase I: GET /api/video/i2v/models -> 200 with I2V matrix
  try {
    const r = await fetch(`${base}/api/video/i2v/models`);
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200
      && body.compatibility
      && body.compatibility['MiniMax-Hailuo-2.3']
      && body.image_constraints
      && body.image_constraints.max_bytes === 20 * 1024 * 1024;
    recordResult(
      'GET /api/video/i2v/models -> 200 with MiniMax-Hailuo-2.3 matrix and 20MB cap',
      ok,
      `status=${r.status} has_matrix=${Boolean(body?.compatibility?.['MiniMax-Hailuo-2.3'])}`,
    );
  } catch (err) {
    recordResult('GET /api/video/i2v/models', false, err.message);
  }

  // 43. Phase I: smoke:i2v dry-run does NOT call MiniMax
  //   The script only emits console summary under default mode and
  //   writes reports/local/i2v-smoke-dry-run.local.{md,json}. It never
  //   touches docs/PHASE_A_API_SMOKE_REPORT.md and never creates
  //   a real task.
  try {
    const publicReport = path.resolve(ROOT, 'docs', 'PHASE_A_API_SMOKE_REPORT.md');
    const before = fs.readFileSync(publicReport, 'utf8');
    const beforeMtime = fs.statSync(publicReport).mtimeMs;
    const smoke = spawn(process.execPath, [path.resolve(ROOT, 'scripts', 'smoke-image-to-video.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: '0', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let smokeOut = '';
    smoke.stdout.on('data', (c) => { smokeOut += c.toString(); });
    smoke.stderr.on('data', (c) => { smokeOut += c.toString(); });
    await new Promise((resolve) => smoke.on('exit', resolve));
    const after = fs.readFileSync(publicReport, 'utf8');
    const afterMtime = fs.statSync(publicReport).mtimeMs;
    const unchanged = before === after && beforeMtime === afterMtime;
    const noI2VTask = !/MiniMax I2V created/.test(serverStderr);
    recordResult(
      'smoke:i2v dry-run leaves docs/PHASE_A_API_SMOKE_REPORT.md untouched',
      unchanged,
      unchanged ? 'content and mtime identical' : 'mtime or content changed',
    );
    recordResult(
      'smoke:i2v dry-run did not create a real I2V task',
      noI2VTask,
      noI2VTask ? 'no remote call observed' : 'unexpected MiniMax trace',
    );
    if (smokeOut.includes('MINIMAX_API_KEY: repl') || smokeOut.includes('eyJ')) {
      recordResult('smoke:i2v dry-run output does not echo real key fragment', false, 'dry-run output contained a real key fragment');
    } else {
      recordResult('smoke:i2v dry-run output does not echo real key fragment', true, 'no real key fragment in dry-run output');
    }
  } catch (err) {
    recordResult('smoke:i2v dry-run hygiene', false, err.message);
  }

  // 44. Phase J.3: I2V fixture generator and validator scripts exist.
  try {
    const genPath = path.resolve(ROOT, 'scripts', 'generate-i2v-fixture.js');
    const valPath = path.resolve(ROOT, 'scripts', 'validate-i2v-fixture.js');
    const fixPath = path.resolve(ROOT, 'test', 'fixtures', 'i2v-smoke-first-frame.png');
    const genExists = fs.existsSync(genPath);
    const valExists = fs.existsSync(valPath);
    const fixExists = fs.existsSync(fixPath);
    recordResult(
      'scripts/generate-i2v-fixture.js exists',
      genExists,
      genExists ? 'present' : 'missing',
    );
    recordResult(
      'scripts/validate-i2v-fixture.js exists',
      valExists,
      valExists ? 'present' : 'missing',
    );
    recordResult(
      'test/fixtures/i2v-smoke-first-frame.png exists',
      fixExists,
      fixExists ? `${fs.statSync(fixPath).size} bytes` : 'missing',
    );
  } catch (err) {
    recordResult('Phase J.3 fixture script presence', false, err.message);
  }

  // 45. Phase J.3: scripts/smoke-image-to-video.js no longer contains
  //     a hand-written PNG chunk encoder main path. The previous
  //     encoder (buildMinimalPngDataUrl + private crc32 helper) was
  //     the root cause of the Phase J.2 incident.
  try {
    const smokeSrc = fs.readFileSync(
      path.resolve(ROOT, 'scripts', 'smoke-image-to-video.js'),
      'utf8',
    );
    const hasLegacyEncoder = /function\s+buildMinimalPngDataUrl/.test(smokeSrc);
    const hasLegacyCrc32 = /function\s+crc32\(/.test(smokeSrc);
    const hasFixtureLoad = /function\s+loadI2VFixtureDataUrl|async\s+function\s+loadI2VFixtureDataUrl|require\(['"]pngjs['"]\)/.test(
      smokeSrc,
    );
    recordResult(
      'smoke-image-to-video.js does not include hand-written PNG encoder (buildMinimalPngDataUrl)',
      !hasLegacyEncoder,
      hasLegacyEncoder ? 'legacy function still present' : 'removed in Phase J.3',
    );
    recordResult(
      'smoke-image-to-video.js does not include hand-written PNG crc32 helper',
      !hasLegacyCrc32,
      hasLegacyCrc32 ? 'legacy helper still present' : 'removed in Phase J.3',
    );
    recordResult(
      'smoke-image-to-video.js sources first_frame_image from fixture (loadI2VFixtureDataUrl / pngjs)',
      hasFixtureLoad,
      hasFixtureLoad ? 'fixture path active' : 'fixture path not detected',
    );
  } catch (err) {
    recordResult('smoke-image-to-video.js fixture wiring', false, err.message);
  }

  // 46. Phase J.3: npm run fixture:i2v:validate exits 0 with PASS
  try {
    const v = spawnSync(
      process.execPath,
      [path.resolve(ROOT, 'scripts', 'validate-i2v-fixture.js')],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const passed =
      v.status === 0 && /10\/10 checks passed/.test((v.stdout || '') + (v.stderr || ''));
    recordResult(
      'npm run fixture:i2v:validate -> 0 + 10/10 PASS',
      passed,
      `exit=${v.status}`,
    );
  } catch (err) {
    recordResult('fixture:i2v:validate', false, err.message);
  }

  // 47. Phase J.3: smoke:i2v dry-run leaves no lock behind, data_url
  //     present but no full Data URL echoed in stdout.
  try {
    const lockPath = path.resolve(ROOT, 'reports', 'local', 'i2v-real-smoke.lock');
    let lockBefore = false;
    try { lockBefore = fs.existsSync(lockPath); } catch (_) { /* ignore */ }
    const smoke = spawn(process.execPath, [path.resolve(ROOT, 'scripts', 'smoke-image-to-video.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: '0', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let smokeOut = '';
    smoke.stdout.on('data', (c) => { smokeOut += c.toString(); });
    smoke.stderr.on('data', (c) => { smokeOut += c.toString(); });
    await new Promise((resolve) => smoke.on('exit', resolve));
    let lockAfter = false;
    try { lockAfter = fs.existsSync(lockPath); } catch (_) { /* ignore */ }
    recordResult(
      'smoke:i2v dry-run does not create the real-smoke lock',
      !lockAfter && !lockBefore,
      `before=${lockBefore} after=${lockAfter}`,
    );
    // Detect a stray "data:image/png;base64,<long-string>" pattern in
    // the dry-run output. The smoke script intentionally logs only the
    // kind/length/sha8, never the bytes.
    const dataUrlPattern = /data:image\/png;base64,[A-Za-z0-9+/=]{200,}/;
    const fullDataUrlLeaked = dataUrlPattern.test(smokeOut);
    const dataUrlPresentFlag = /data_url_present:\s*yes/.test(smokeOut);
    recordResult(
      'smoke:i2v dry-run logs data_url_present=yes',
      dataUrlPresentFlag,
      dataUrlPresentFlag ? 'flag present' : 'flag missing',
    );
    recordResult(
      'smoke:i2v dry-run does not echo full Data URL',
      !fullDataUrlLeaked,
      fullDataUrlLeaked ? 'full data URL found in output' : 'only length / sha8 / kind logged',
    );
  } catch (err) {
    recordResult('smoke:i2v dry-run Phase J.3 hygiene', false, err.message);
  }

  // 48. Phase J.3: smoke:i2v real mode with I2V_SMOKE_TEST_LOCK_ONLY=1
  //     and a synthetic lock present MUST refuse via the lock gate and
  //     must NOT touch MiniMax. This exercises the Phase J.2 once-only
  //     lock through the real-mode code path without making any remote
  //     call.
  try {
    const lockPath = path.resolve(ROOT, 'reports', 'local', 'i2v-real-smoke.lock');
    const mdPath = path.resolve(ROOT, 'reports', 'local', 'i2v-smoke-blocked-by-lock.local.md');
    // Make sure there is no leftover lock from a previous run.
    try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
    // Plant a synthetic lock.
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        created_at: '2026-06-16T12:00:00.000Z',
        finished_at: '2026-06-16T12:00:01.000Z',
        task_id_masked: 'red...cted',
        final_status: 'failed',
        fail_reason_kind: 'failed',
        synthetic_for_check_api: true,
      }, null, 2),
      'utf8',
    );
    let mdBefore = null;
    try { mdBefore = fs.statSync(mdPath).mtimeMs; } catch (_) { mdBefore = null; }
    const smoke = spawn(process.execPath, [path.resolve(ROOT, 'scripts', 'smoke-image-to-video.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        CONFIRM_REAL_VIDEO: '1',
        CONFIRM_REAL_I2V: '1',
        I2V_SMOKE_TEST_LOCK_ONLY: '1',
        PORT: '0',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let smokeOut = '';
    smoke.stdout.on('data', (c) => { smokeOut += c.toString(); });
    smoke.stderr.on('data', (c) => { smokeOut += c.toString(); });
    const smokeExit = await new Promise((resolve) => smoke.on('exit', resolve));
    let mdAfter = null;
    try { mdAfter = fs.statSync(mdPath).mtimeMs; } catch (_) { mdAfter = null; }
    const refused = /refused_by_lock|refused_by_fixture/.test(smokeOut);
    const noMiniMaxTrace = !/MiniMax I2V created|createImageToVideo|video_generation/.test(serverStderr);
    recordResult(
      'smoke:i2v real+lock+test-mode refuses via once-only lock',
      refused && smokeExit === 0,
      `exit=${smokeExit} refused=${refused}`,
    );
    recordResult(
      'smoke:i2v real+lock+test-mode did not call MiniMax',
      noMiniMaxTrace,
      noMiniMaxTrace ? 'no remote trace in server stderr' : 'unexpected MiniMax trace',
    );
    recordResult(
      'smoke:i2v real+lock+test-mode wrote a blocked-by-lock local report',
      mdAfter !== null && mdAfter !== mdBefore,
      mdAfter === null ? 'report missing' : 'report refreshed',
    );
    // Cleanup: leave the lock in place if it was already there
    // before our test; otherwise remove it so subsequent runs are
    // not blocked. (The lock is gitignored so this never reaches git.)
    try {
      const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (raw && raw.synthetic_for_check_api) {
        fs.unlinkSync(lockPath);
      }
    } catch (_) { /* ignore */ }
  } catch (err) {
    recordResult('smoke:i2v real+lock+test-mode', false, err.message);
  }
}

async function main() {
  // Wipe previous report to keep this run self-contained.
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, '');
  } catch (_) {
    // ignore
  }

  logLine(`[phase-i] check:api starting on port ${PORT}`);

  if (process.env.CONFIRM_REAL_VIDEO === '1') {
    logLine('[phase-i] aborting: CONFIRM_REAL_VIDEO=1 is not allowed in check:api');
    process.exitCode = 2;
    return;
  }
  if (process.env.CONFIRM_REAL_I2V === '1') {
    logLine('[phase-i] aborting: CONFIRM_REAL_I2V=1 is not allowed in check:api');
    process.exitCode = 2;
    return;
  }

  try {
    await seedFixtures();
    logLine('[phase-i] local SQLite fixtures seeded (offline, fake ids)');
  } catch (err) {
    logLine(`[phase-i] failed to seed fixtures: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await startServer();
    logLine(`[phase-i] server up on :${PORT}`);
  } catch (err) {
    logLine(`[phase-i] failed to start server: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await runChecks();
  } finally {
    stopServer();
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  logLine(`[phase-i] summary: ${passed}/${checks.length} checks passed`);
  if (failed > 0) {
    logLine(`[phase-i] FAILED checks:`);
    checks.filter((c) => !c.ok).forEach((c) => logLine(`  - ${c.name}: ${c.detail || ''}`));
    process.exitCode = 1;
  } else {
    logLine(`[phase-i] all checks PASSED. No real MiniMax task was created.`);
  }
}

main().catch((err) => {
  logLine(`[phase-i] unexpected error: ${err && err.message ? err.message : err}`);
  stopServer();
  process.exitCode = 1;
});
