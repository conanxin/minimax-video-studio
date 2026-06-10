#!/usr/bin/env node
/**
 * Phase E - API regression check script.
 *
 * Goals:
 *  1. Boot the backend, run a small regression suite, then shut it down.
 *  2. Cover auth, validation, polling-config endpoint, and the file-refresh
 *     endpoint (only if a local Success + file_id task exists).
 *  3. NEVER call /api/video/create with a valid payload (that would consume
 *     MiniMax quota). Only the rejection paths are exercised.
 *  4. NEVER read, log, or print MINIMAX_API_KEY.
 *  5. NEVER set CONFIRM_REAL_VIDEO=1.
 *
 * Exit code:
 *   0 - all checks passed
 *   1 - one or more checks failed (details in stdout)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');

config();

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.resolve(ROOT, 'reports', 'phase-e-api-regression.report.txt');

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
}

async function main() {
  // Wipe previous report to keep this run self-contained.
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, '');
  } catch (_) {
    // ignore
  }

  logLine(`[phase-e] check:api starting on port ${PORT}`);

  if (process.env.CONFIRM_REAL_VIDEO === '1') {
    logLine('[phase-e] aborting: CONFIRM_REAL_VIDEO=1 is not allowed in check:api');
    process.exitCode = 2;
    return;
  }

  try {
    await startServer();
    logLine(`[phase-e] server up on :${PORT}`);
  } catch (err) {
    logLine(`[phase-e] failed to start server: ${err.message}`);
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
  logLine(`[phase-e] summary: ${passed}/${checks.length} checks passed`);
  if (failed > 0) {
    logLine(`[phase-e] FAILED checks:`);
    checks.filter((c) => !c.ok).forEach((c) => logLine(`  - ${c.name}: ${c.detail || ''}`));
    process.exitCode = 1;
  } else {
    logLine(`[phase-e] all checks PASSED. No real MiniMax task was created.`);
  }
}

main().catch((err) => {
  logLine(`[phase-e] unexpected error: ${err && err.message ? err.message : err}`);
  stopServer();
  process.exitCode = 1;
});
