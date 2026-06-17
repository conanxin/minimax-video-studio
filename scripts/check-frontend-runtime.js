// Phase Q.2: Frontend browser-runtime smoke.
//
// Why this exists: `npm run build` and `npm run check:api` exercise the
// backend and the bundle, but they do not actually load the bundle in a
// real browser. The Phase Q / Phase Q.1 / Phase Q.2 regressions were
// all TDZ-on-minified-const errors that ONLY manifest when React
// renders in a browser context. This script boots a local copy of the
// production server (on an OS-allocated port, never touching production
// 8789), points Playwright at it, listens for `pageerror` / `console
// error`, and asserts:
//
//   - the page contains "MiniMax Video Studio"
//   - the page contains "T2V and I2V verified"
//   - no `ReferenceError` / "can't access lexical declaration" /
//     "Uncaught TypeError" appears in pageerror or console
//
// It does NOT create real MiniMax tasks, does NOT call the real
// MiniMax API, does NOT depend on a real `MINIMAX_API_KEY` being
// present, does NOT touch the Cloudflare Tunnel / Access layer, and
// does NOT delete `reports/local/i2v-real-smoke.lock`.
//
// Playwright Chromium is expected at one of:
//   - the bundled playwright cache (`~/.cache/ms-playwright/`)
//   - the system `chromium` / `chromium-browser` / `google-chrome`
//
// If no browser can be located, the script records a SKIPPED verdict
// with `unavailable: true` instead of pretending PASS.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.resolve(ROOT, 'reports', 'phase-q2-frontend-runtime.report.txt');
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

const logLines = [];
function log(line) {
  process.stdout.write(line + '\n');
  logLines.push(line);
}

function findBrowserExecutable() {
  const candidates = [
    path.join(process.env.HOME || '', '.cache', 'ms-playwright'),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        // ms-playwright cache layout: chromium-<rev>/chrome-linux/chrome
        const entries = fs.readdirSync(candidate);
        for (const entry of entries) {
          if (!/^chromium-\d+/.test(entry)) continue;
          const inner = path.join(candidate, entry);
          const subs = fs.readdirSync(inner);
          for (const sub of subs) {
            const chromeBin = path.join(inner, sub, 'chrome');
            if (fs.existsSync(chromeBin)) return chromeBin;
          }
        }
        const headless = path.join(candidate, 'chromium_headless_shell-1223', 'chrome-linux64', 'chrome');
        if (fs.existsSync(headless)) return headless;
      } else if (stat.isFile() && candidate.endsWith('chrome')) {
        return candidate;
      }
    } catch (_err) {
      // ignore
    }
  }
  return null;
}

async function startLocalServer(port) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      REQUIRE_SITE_PASSCODE: 'false',
      CLOUDFLARE_ACCESS_EXPECTED: 'false',
    };
    delete env.CONFIRM_REAL_VIDEO;
    delete env.CONFIRM_REAL_I2V;
    const proc = spawn(process.execPath, [path.resolve(ROOT, 'server', 'index.js')], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuf = '';
    let stderrBuf = '';
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`server did not print bind line within 15s\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`));
    }, 15000);
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const m = stdoutBuf.match(/MiniMax studio backend running on ([^:\s]+):(\d+)/);
      if (m) {
        clearTimeout(timeout);
        resolve({ proc, host: m[1], port: Number(m[2]), getStdout: () => stdoutBuf, getStderr: () => stderrBuf });
      }
    });
    proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited code=${code} before binding\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`));
    });
  });
}

async function loadPlaywright() {
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    const mod = require('playwright');
    return mod;
  } catch (err) {
    return null;
  }
}

async function fetchRoot(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

function check(cond, label, detail = '') {
  const tag = cond ? '[PASS]' : '[FAIL]';
  log(`${tag} ${label}${detail ? ' - ' + detail : ''}`);
  return cond;
}

async function main() {
  const checks = [];
  function record(label, ok, detail) {
    checks.push({ label, ok, detail });
  }

  log('=== Phase Q.2 frontend browser-runtime smoke ===');

  // 1) Build must have run.
  const distAssets = path.resolve(ROOT, 'web', 'dist', 'assets');
  if (!fs.existsSync(distAssets)) {
    log('[FAIL] web/dist/assets/ missing - run npm run build first');
    record('build output exists', false, 'web/dist/assets/ missing');
    finalize(checks, false, 'build output missing');
    return;
  }
  record('build output exists', true, '');

  // 2) Locate a browser.
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    log('[SKIP] no browser binary found in ~/.cache/ms-playwright or /usr/bin/*chrom*');
    log('[SKIP] please install playwright (npx playwright install chromium) or chromium');
    record('browser binary present', false, 'unavailable');
    finalize(checks, false, 'browser unavailable');
    return;
  }
  record('browser binary present', true, browserPath);
  log(`[OK] browser binary: ${browserPath}`);

  // 3) Load playwright.
  const playwright = await loadPlaywright();
  if (!playwright) {
    log('[SKIP] playwright module not installed (npm install --no-save playwright)');
    record('playwright module present', false, 'unavailable');
    finalize(checks, false, 'playwright unavailable');
    return;
  }
  record('playwright module present', true, '');

  // 4) Start local server on an OS-allocated port.
  let server;
  try {
    server = await startLocalServer(0);
  } catch (err) {
    log(`[FAIL] could not start local server: ${err.message}`);
    record('local server started', false, err.message);
    finalize(checks, false, 'server failed');
    return;
  }
  record('local server started', true, `port=${server.port}`);

  let runtimeOk = true;
  try {
    // 5) Sanity: GET / returns 200 + index.html
    const root = await fetchRoot(server.port);
    const rootOk = check(root.status === 200, 'GET / returns 200', `status=${root.status}`);
    record('GET / returns 200', rootOk);
    const referencesJs = /<script[^>]+src="\/assets\/index-[^"]+\.js"/.test(root.body);
    const refsOk = check(referencesJs, 'index.html references hashed JS asset', '');
    record('index.html references hashed JS asset', refsOk);

    // 6) Launch browser and load the page.
    const browser = await playwright.chromium.launch({
      headless: true,
      executablePath: browserPath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (err) => {
      const full = err && err.stack ? err.stack : (err && err.message ? err.message : String(err));
      pageErrors.push(full);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const url = `http://127.0.0.1:${server.port}/`;
    log(`[INFO] navigating to ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    // Give React a tick to commit and run effects.
    await page.waitForTimeout(2000);

    // 7) Assert page content.
    const bodyText = await page.evaluate(() => document.body && document.body.innerText ? document.body.innerText : '');
    log(`[INFO] body innerText length=${bodyText.length}`);
    const hasTitle = bodyText.includes('MiniMax Video Studio') || (await page.title()).includes('MiniMax Video Studio');
    const titleOk = check(hasTitle, 'page contains "MiniMax Video Studio"', '');
    record('page contains title', titleOk);
    const hasVerified = bodyText.includes('T2V and I2V verified');
    const verifiedOk = check(hasVerified, 'page contains "T2V and I2V verified"', '');
    record('page contains verified text', verifiedOk);

    // 8) Runtime errors?
    const tdzPatterns = [
      /can't access lexical declaration/i,
      /ReferenceError/i,
      /Uncaught TypeError/i,
      /cannot read properties of (undefined|null)/i,
    ];
    const flaggedPageErrors = pageErrors.filter((m) => tdzPatterns.some((re) => re.test(m)));
    const flaggedConsoleErrors = consoleErrors.filter((m) => tdzPatterns.some((re) => re.test(m)));
    const noPageErrOk = check(flaggedPageErrors.length === 0, 'no TDZ/ReferenceError/TypeError in pageerror',
      flaggedPageErrors.length ? `samples: ${flaggedPageErrors.slice(0, 2).join(' | ')}` : '');
    record('no TDZ/ReferenceError/TypeError in pageerror', noPageErrOk);
    const noConsoleErrOk = check(flaggedConsoleErrors.length === 0, 'no TDZ/ReferenceError/TypeError in console.error',
      flaggedConsoleErrors.length ? `samples: ${flaggedConsoleErrors.slice(0, 2).join(' | ')}` : '');
    record('no TDZ/ReferenceError/TypeError in console.error', noConsoleErrOk);

    log(`[INFO] pageerror total=${pageErrors.length} console.error total=${consoleErrors.length}`);
    if (pageErrors.length) log(`[DEBUG] pageerror sample: ${pageErrors.slice(0, 3).join(' || ')}`);
    if (consoleErrors.length) log(`[DEBUG] console.error sample: ${consoleErrors.slice(0, 3).join(' || ')}`);

    await browser.close();
    runtimeOk = titleOk && verifiedOk && noPageErrOk && noConsoleErrOk;
  } catch (err) {
    log(`[FAIL] runtime smoke error: ${err.message}`);
    record('runtime smoke completed', false, err.message);
    runtimeOk = false;
  } finally {
    try { if (server && server.proc && !server.proc.killed) server.proc.kill('SIGTERM'); } catch (_e) { /* ignore */ }
  }

  finalize(checks, runtimeOk, runtimeOk ? 'all checks passed' : 'one or more checks failed');
}

function finalize(checks, ok, summary) {
  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  log(`[phase-q2] summary: ${passed}/${total} checks passed`);
  log(`[phase-q2] verdict: ${ok ? 'PASS' : 'FAIL'}`);
  log(`[phase-q2] ${summary}`);
  const body = [
    `Phase Q.2 frontend browser-runtime smoke`,
    `verdict: ${ok ? 'PASS' : 'FAIL'}`,
    `summary: ${passed}/${total} checks passed`,
    `note: ${summary}`,
    '',
    'checks:',
    ...checks.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.label}${c.detail ? ' :: ' + c.detail : ''}`),
    '',
    ...logLines,
  ].join('\n');
  fs.writeFileSync(REPORT_PATH, body, 'utf8');
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  log(`[FATAL] ${err.message}`);
  finalize([], false, `fatal: ${err.message}`);
});
