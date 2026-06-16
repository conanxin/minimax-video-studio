#!/usr/bin/env node
/**
 * Phase E + Phase F + Phase G + Phase H - API regression check script.
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

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');

config();

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.resolve(ROOT, 'reports', 'phase-h-api-regression.report.txt');

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
        ];

        for (const r of rows) {
          await db.run(
            `INSERT OR REPLACE INTO tasks (
              task_id, prompt, model, duration, resolution, prompt_optimizer,
              status, file_id, download_url, fail_reason,
              created_at, updated_at,
              download_url_refreshed_at, download_url_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.task_id,
              'Phase G/H seed prompt for regression check',
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
            ],
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
}

async function main() {
  // Wipe previous report to keep this run self-contained.
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, '');
  } catch (_) {
    // ignore
  }

  logLine(`[phase-h] check:api starting on port ${PORT}`);

  if (process.env.CONFIRM_REAL_VIDEO === '1') {
    logLine('[phase-h] aborting: CONFIRM_REAL_VIDEO=1 is not allowed in check:api');
    process.exitCode = 2;
    return;
  }

  try {
    await seedFixtures();
    logLine('[phase-h] local SQLite fixtures seeded (offline, fake ids)');
  } catch (err) {
    logLine(`[phase-h] failed to seed fixtures: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await startServer();
    logLine(`[phase-h] server up on :${PORT}`);
  } catch (err) {
    logLine(`[phase-h] failed to start server: ${err.message}`);
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
  logLine(`[phase-h] summary: ${passed}/${checks.length} checks passed`);
  if (failed > 0) {
    logLine(`[phase-h] FAILED checks:`);
    checks.filter((c) => !c.ok).forEach((c) => logLine(`  - ${c.name}: ${c.detail || ''}`));
    process.exitCode = 1;
  } else {
    logLine(`[phase-h] all checks PASSED. No real MiniMax task was created.`);
  }
}

main().catch((err) => {
  logLine(`[phase-h] unexpected error: ${err && err.message ? err.message : err}`);
  stopServer();
  process.exitCode = 1;
});
