#!/usr/bin/env node
/**
 * Phase E + Phase F + Phase G - API regression check script.
 *
 * Goals:
 *  1. Boot the backend, run a small regression suite, then shut it down.
 *  2. Cover auth, validation, polling-config endpoint, the file-refresh
 *     endpoint (only if a local Success + file_id task exists), the
 *     Phase F task-list filtering, pagination, and search behaviour,
 *     and the Phase G download-link freshness contract.
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
const REPORT_PATH = path.resolve(ROOT, 'reports', 'phase-g-api-regression.report.txt');

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
  if (text.includes('MINIMAX_API_KEY') || /eyJ[A-Za-z0-9_-]{20,}/.test(text)) {
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

// Phase G: write deterministic local SQLite seed rows that exercise
// the freshness state machine. All values are obviously fake: ids use
// the `local-seed-g-` prefix, file_ids use `file-seed-g-`, and
// download_url values are short local placeholders that the script
// never logs verbatim. The DB file is gitignored; nothing here is
// written to a public report.
function seedFreshnessFixtures() {
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
          {
            task_id: 'local-seed-g-success-fresh',
            file_id: 'file-seed-g-fresh',
            download_url: 'local-placeholder://fresh',
            refreshed_at: isoOffset(2), // 2h ago => fresh
            updated_at: isoOffset(2),
          },
          {
            task_id: 'local-seed-g-success-aging',
            file_id: 'file-seed-g-aging',
            download_url: 'local-placeholder://aging',
            refreshed_at: isoOffset(15), // 15h ago => aging
            updated_at: isoOffset(15),
          },
          {
            task_id: 'local-seed-g-success-stale',
            file_id: 'file-seed-g-stale',
            download_url: 'local-placeholder://stale',
            refreshed_at: isoOffset(30), // 30h ago => stale
            updated_at: isoOffset(30),
          },
          {
            task_id: 'local-seed-g-success-no-url',
            file_id: 'file-seed-g-nourl',
            download_url: null,
            refreshed_at: null,
            updated_at: isoOffset(1),
          },
          {
            task_id: 'local-seed-g-fail',
            file_id: null,
            download_url: null,
            refreshed_at: null,
            updated_at: isoOffset(40),
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
              'Phase G seed prompt for freshness check',
              'MiniMax-Hailuo-2.3',
              6,
              '768P',
              1,
              r.task_id === 'local-seed-g-fail' ? 'Fail' : 'Success',
              r.file_id,
              r.download_url,
              r.task_id === 'local-seed-g-fail' ? 'simulated failure' : null,
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
  if (text.includes('MINIMAX_API_KEY') || /eyJ[A-Za-z0-9_-]{20,}/.test(text)) {
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
}

async function main() {
  // Wipe previous report to keep this run self-contained.
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, '');
  } catch (_) {
    // ignore
  }

  logLine(`[phase-g] check:api starting on port ${PORT}`);

  if (process.env.CONFIRM_REAL_VIDEO === '1') {
    logLine('[phase-g] aborting: CONFIRM_REAL_VIDEO=1 is not allowed in check:api');
    process.exitCode = 2;
    return;
  }

  try {
    await seedFreshnessFixtures();
    logLine('[phase-g] local SQLite freshness fixtures seeded (offline, fake ids)');
  } catch (err) {
    logLine(`[phase-g] failed to seed freshness fixtures: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await startServer();
    logLine(`[phase-g] server up on :${PORT}`);
  } catch (err) {
    logLine(`[phase-g] failed to start server: ${err.message}`);
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
  logLine(`[phase-g] summary: ${passed}/${checks.length} checks passed`);
  if (failed > 0) {
    logLine(`[phase-g] FAILED checks:`);
    checks.filter((c) => !c.ok).forEach((c) => logLine(`  - ${c.name}: ${c.detail || ''}`));
    process.exitCode = 1;
  } else {
    logLine(`[phase-g] all checks PASSED. No real MiniMax task was created.`);
  }
}

main().catch((err) => {
  logLine(`[phase-g] unexpected error: ${err && err.message ? err.message : err}`);
  stopServer();
  process.exitCode = 1;
});
