const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('dotenv');
const { normalizeMiniMaxStatus } = require('../server/services/taskStore');
const {
  createImageToVideo,
  queryVideoTask,
  retrieveVideoFile,
} = require('../server/services/minimaxClient');
const {
  upsertTaskByTaskId,
  updateTaskByTaskId,
  createTaskRecord,
  modelConfig,
} = require('../server/services/taskStore');
const { i2vModelConfig } = require('../shared/videoModelsI2V.json');

config();

const I2V_DRY_RUN_LOCAL_DIR = path.resolve(process.cwd(), 'reports', 'local');
const I2V_DRY_RUN_LOCAL_MD = path.resolve(I2V_DRY_RUN_LOCAL_DIR, 'i2v-smoke-dry-run.local.md');
const I2V_DRY_RUN_LOCAL_JSON = path.resolve(I2V_DRY_RUN_LOCAL_DIR, 'i2v-smoke-dry-run.local.json');
const I2V_REAL_LOCAL_DIR = path.resolve(process.cwd(), 'reports', 'local');
const I2V_REAL_LOCAL_MD = path.resolve(I2V_REAL_LOCAL_DIR, 'phase-j-i2v-smoke.local.md');
const I2V_REAL_LOCAL_JSON = path.resolve(I2V_REAL_LOCAL_DIR, 'phase-j-i2v-smoke.local.json');
// Phase J.2 incident containment: once-only local lock for the real
// I2V branch. The lock lives under reports/local/ (gitignored) and is
// only created when both CONFIRM_REAL_VIDEO=1 and CONFIRM_REAL_I2V=1
// are set AND the script proceeds to submit. The dry-run branch never
// touches this lock.
const I2V_REAL_LOCK_PATH = process.env.I2V_SMOKE_LOCK_PATH
  ? path.resolve(process.env.I2V_SMOKE_LOCK_PATH)
  : path.resolve(I2V_REAL_LOCAL_DIR, 'i2v-real-smoke.lock');
// Phase J.3: I2V smoke now sources the first_frame_image from a
// deterministic PNG fixture instead of a hand-written PNG encoder.
// The fixture is produced by scripts/generate-i2v-fixture.js and
// validated by scripts/validate-i2v-fixture.js. The hand-written
// encoder was retired in Phase J.3 (see PHASE_J3 report) because
// it produced PNGs that MiniMax's service-side decoder rejected
// with "invalid format / too much pixel data".
const I2V_FIXTURE_PATH = path.resolve(
  process.cwd(),
  'test',
  'fixtures',
  'i2v-smoke-first-frame.png',
);
const I2V_FIXTURE_WIDTH = 1024;
const I2V_FIXTURE_HEIGHT = 768;
const I2V_FIXTURE_MAX_BYTES = 20 * 1024 * 1024;
const I2V_FIXTURE_MIN_SHORT_SIDE_PX = 300;
const I2V_FIXTURE_ASPECT_MIN = 0.4;
const I2V_FIXTURE_ASPECT_MAX = 2.5;
const CHECK_INTERVAL_MS = 10_000;
const MAX_ATTEMPTS = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeText(value) {
  if (value === undefined || value === null) return 'N/A';
  const str = String(value).trim();
  return str.length === 0 ? 'N/A' : str;
}

function maskId(value) {
  if (value === undefined || value === null) return 'N/A';
  const str = String(value).trim();
  if (!str || str === 'N/A') return 'N/A';
  return 'redacted';
}

// Phase J.3 fixture loader: read the fixture file and build a
// data:image/png;base64,... URL. The Data URL is built from the
// fixture's bytes, NOT from a hand-written encoder. The returned
// summary is safe to log; the full Data URL is intentionally NOT
// logged because it would expose the entire image bytes.
//
// Returns:
//   {
//     ok: boolean,
//     error: string | null,
//     fixture_path, fixture_sha256_short, fixture_bytes,
//     width, height, color_type, color_type_label,
//     data_url_length,        // length in chars (NOT the URL itself)
//     data_url_prefix,        // first ~24 chars only
//     data_url_present: 'yes' | 'no',
//   }
async function loadI2VFixtureDataUrl() {
  if (!fs.existsSync(I2V_FIXTURE_PATH)) {
    return {
      ok: false,
      error: `fixture missing: ${path.relative(process.cwd(), I2V_FIXTURE_PATH)}`,
    };
  }
  const stat = fs.statSync(I2V_FIXTURE_PATH);
  if (stat.size > I2V_FIXTURE_MAX_BYTES) {
    return {
      ok: false,
      error: `fixture too large: ${stat.size} > ${I2V_FIXTURE_MAX_BYTES}`,
    };
  }
  const buf = fs.readFileSync(I2V_FIXTURE_PATH);
  // Magic bytes
  const expectedMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(expectedMagic)) {
    return {
      ok: false,
      error: 'fixture missing PNG magic bytes',
    };
  }
  // Dimension / shape checks (decode IHDR; we do not need to
  // fully decode the IDAT for the harness, but the validator
  // script does that as a separate, stricter check).
  // Width is at offset 16, height at offset 20, big-endian uint32.
  if (buf.length < 24) {
    return { ok: false, error: 'fixture too small to parse IHDR' };
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== I2V_FIXTURE_WIDTH) {
    return {
      ok: false,
      error: `fixture width mismatch: expected ${I2V_FIXTURE_WIDTH}, got ${width}`,
    };
  }
  if (height !== I2V_FIXTURE_HEIGHT) {
    return {
      ok: false,
      error: `fixture height mismatch: expected ${I2V_FIXTURE_HEIGHT}, got ${height}`,
    };
  }
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const aspect = shortSide > 0 ? longSide / shortSide : 0;
  if (shortSide < I2V_FIXTURE_MIN_SHORT_SIDE_PX) {
    return {
      ok: false,
      error: `fixture short side ${shortSide}px < ${I2V_FIXTURE_MIN_SHORT_SIDE_PX}px`,
    };
  }
  if (aspect < I2V_FIXTURE_ASPECT_MIN || aspect > I2V_FIXTURE_ASPECT_MAX) {
    return {
      ok: false,
      error: `fixture aspect ${aspect.toFixed(3)} outside [${I2V_FIXTURE_ASPECT_MIN}, ${I2V_FIXTURE_ASPECT_MAX}]`,
    };
  }
  // Color type at offset 25: 2 = RGB, 6 = RGBA. Both are valid PNG
  // color types for an I2V first_frame_image.
  const colorType = buf[25];
  const colorTypeLabel =
    colorType === 6 ? 'RGBA' : colorType === 2 ? 'RGB' : `unknown(${colorType})`;

  const base64 = buf.toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;
  const sha256Short = crypto
    .createHash('sha256')
    .update(buf)
    .digest('hex')
    .slice(0, 8);
  return {
    ok: true,
    error: null,
    fixture_path: path.relative(process.cwd(), I2V_FIXTURE_PATH),
    fixture_sha256_short: sha256Short,
    fixture_bytes: buf.length,
    width,
    height,
    color_type: colorType,
    color_type_label: colorTypeLabel,
    data_url_length: dataUrl.length,
    // First 24 chars only: 'data:image/png;base64,' prefix
    data_url_prefix: dataUrl.slice(0, 24),
    data_url_present: 'yes',
    // NOT exposed in any log path: dataUrl itself.
    data_url_for_payload_only: dataUrl,
  };
}

// Same checks, but stricter: actually decodes the PNG via pngjs so
// we know the IDAT payload is well-formed, not just the IHDR header.
// Used by the validator script and by smoke:i2v dry-run as a fast
// pre-flight.
async function validateI2VFixture() {
  if (!fs.existsSync(I2V_FIXTURE_PATH)) {
    return { ok: false, checks: [{ name: 'fixture exists', ok: false }] };
  }
  const checks = [];
  const buf = fs.readFileSync(I2V_FIXTURE_PATH);
  const expectedMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const magicOk = buf.length >= 8 && buf.subarray(0, 8).equals(expectedMagic);
  checks.push({ name: 'PNG magic bytes', ok: magicOk });
  if (!magicOk) return { ok: false, checks };

  let png = null;
  try {
    // Lazy require pngjs so the script stays runnable in environments
    // without the devDependency (e.g. legacy CI). In that case the
    // harness falls back to IHDR-only checks.
    const { PNG } = require('pngjs');
    png = PNG.sync.read(buf);
    checks.push({ name: 'pngjs decode', ok: true });
  } catch (err) {
    checks.push({ name: 'pngjs decode', ok: false, detail: err.message });
    return { ok: false, checks };
  }

  checks.push({
    name: `width == ${I2V_FIXTURE_WIDTH}`,
    ok: png.width === I2V_FIXTURE_WIDTH,
    detail: `got=${png.width}`,
  });
  checks.push({
    name: `height == ${I2V_FIXTURE_HEIGHT}`,
    ok: png.height === I2V_FIXTURE_HEIGHT,
    detail: `got=${png.height}`,
  });
  const expectedPixels = png.width * png.height * 4;
  checks.push({
    name: 'RGBA pixel buffer length',
    ok: png.data && png.data.length === expectedPixels,
    detail: `expected=${expectedPixels} actual=${png.data ? png.data.length : 0}`,
  });
  checks.push({
    name: 'file size <= 20MB',
    ok: buf.length <= I2V_FIXTURE_MAX_BYTES,
    detail: `bytes=${buf.length}`,
  });
  const shortSide = Math.min(png.width, png.height);
  const aspect =
    shortSide > 0 ? Math.max(png.width, png.height) / shortSide : 0;
  checks.push({
    name: 'short side >= 300px',
    ok: shortSide >= I2V_FIXTURE_MIN_SHORT_SIDE_PX,
    detail: `short_side=${shortSide}`,
  });
  checks.push({
    name: 'aspect ratio in [0.40, 2.50]',
    ok: aspect >= I2V_FIXTURE_ASPECT_MIN && aspect <= I2V_FIXTURE_ASPECT_MAX,
    detail: `aspect=${aspect.toFixed(3)}`,
  });

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

function buildI2VPayload(dataUrl, sha256Short) {
  return {
    model: i2vModelConfig.defaults.model,
    prompt:
      'A calm abstract gradient slowly blooming outward, soft pastel lighting, no people, no text, no logos, gentle cinematic motion, 6 seconds.',
    first_frame_image: dataUrl,
    duration: i2vModelConfig.defaults.duration,
    resolution: i2vModelConfig.defaults.resolution,
    prompt_optimizer: i2vModelConfig.defaults.prompt_optimizer,
  };
}

function payloadSummaryForLog(payload) {
  const imageBytes = payload.first_frame_image
    ? payload.first_frame_image.length
    : 0;
  return {
    model: payload.model,
    prompt: payload.prompt,
    duration: payload.duration,
    resolution: payload.resolution,
    prompt_optimizer: payload.prompt_optimizer,
    first_frame_image_kind: payload.first_frame_image
      ? payload.first_frame_image.startsWith('data:image/png;base64,')
        ? 'data_url_png'
        : 'unknown'
      : 'absent',
    first_frame_image_bytes_estimated: imageBytes,
    first_frame_image_sha256_short: payload.first_frame_image
      ? crypto
          .createHash('sha256')
          .update(payload.first_frame_image)
          .digest('hex')
          .slice(0, 8)
      : null,
  };
}

async function persistSmokeTaskProgress(task) {
  const status = normalizeMiniMaxStatus(task.status);
  const patch = {
    status,
    fail_reason: task.fail_reason || 'No fail reason yet',
    file_id: task.file_id || null,
    download_url: task.download_url || null,
  };
  return updateTaskByTaskId(task.task_id, patch);
}

async function runRealI2VSmoke(context, dataUrl, fixtureSha256Short) {
  const payload = buildI2VPayload(dataUrl, fixtureSha256Short);
  context.payloadSummary = payloadSummaryForLog(payload);

  const created = await createImageToVideo(payload);
  if (!created.task_id) {
    throw new Error('No task_id returned from create API');
  }

  context.created = 'Yes';
  context.createdStatus = normalizeMiniMaxStatus(created.status);
  context.taskId = created.task_id;

  let taskRecord = await upsertTaskByTaskId(created.task_id, {
    generation_mode: 'image_to_video',
    prompt: payload.prompt,
    model: payload.model,
    duration: payload.duration,
    resolution: payload.resolution,
    prompt_optimizer: payload.prompt_optimizer,
    input_image_present: true,
    input_image_type: 'data_url',
    input_image_sha256_short: context.payloadSummary.first_frame_image_sha256_short,
    input_image_summary: 'Fixture-driven first frame, abstract gradient, no copyrighted content',
    status: normalizeMiniMaxStatus(created.status) || 'Queueing',
    file_id: created.file_id || null,
    download_url: created.download_url || null,
    fail_reason: created.fail_reason || null,
  });

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const task = await queryVideoTask(created.task_id);
    taskRecord = await persistSmokeTaskProgress({
      task_id: created.task_id,
      status: task.status,
      fail_reason: task.fail_reason,
      file_id: task.file_id,
      download_url: task.download_url,
    });

    context.finalStatus = normalizeMiniMaxStatus(task.status);
    context.taskId = created.task_id;
    context.fileId = task.file_id || 'N/A';
    context.failReason = task.fail_reason || 'N/A';

    if (context.finalStatus === 'Success' && task.file_id) {
      const file = await retrieveVideoFile(task.file_id);
      context.fileId = file.file_id || task.file_id || 'N/A';
      context.downloadUrl = file.download_url ? 'present' : 'absent';
      await persistSmokeTaskProgress({
        task_id: created.task_id,
        status: context.finalStatus,
        fail_reason: context.failReason,
        file_id: context.fileId,
        download_url: file.download_url || task.download_url || null,
      });
      break;
    }

    if (context.finalStatus === 'Fail') {
      context.downloadUrl = 'absent';
      break;
    }

    await sleep(CHECK_INTERVAL_MS);
    if (i === MAX_ATTEMPTS - 1) {
      context.finalStatus = 'timed out';
      context.failReason = 'Polling reached max attempts before completion.';
      if (taskRecord) {
        await updateTaskByTaskId(created.task_id, {
          fail_reason: context.failReason,
          status: taskRecord.status,
        });
      }
    }
  }

  return taskRecord;
}

function renderDryRunReport(context) {
  return `# I2V Smoke dry-run (local)

This file is written by \`scripts/smoke-image-to-video.js\` in
\`CONFIRM_REAL_VIDEO != 1\` or \`CONFIRM_REAL_I2V != 1\` mode. It is
intentionally stored under \`reports/local/\` so it is **not** picked up
by git. It is a machine-local breadcrumb only.

## Snapshot
- run_at: ${safeText(context.startedAt)}
- finished_at: ${safeText(context.finishedAt)}
- confirm_real_video: ${safeText(process.env.CONFIRM_REAL_VIDEO || '0')}
- confirm_real_i2v: ${safeText(process.env.CONFIRM_REAL_I2V || '0')}
- api_base: ${safeText(process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com')}
- api_key_present: ${process.env.MINIMAX_API_KEY ? 'yes (masked elsewhere)' : 'no'}
- final_status: ${safeText(context.finalStatus)}
- fail_reason: ${safeText(context.failReason)}
- real_quota_consumed: ${safeText(context.chargeUsed)}

## Fixture (Phase J.3)
- fixture_path: ${safeText(context.fixture && context.fixture.fixture_path)}
- fixture_exists: ${context.fixture ? (context.fixture.error ? 'no' : 'yes') : 'unknown'}
- fixture_validation: ${safeText(context.fixtureValidation)}
- fixture_bytes: ${context.fixture ? safeText(context.fixture.fixture_bytes) : 'N/A'}
- fixture_sha256_short: ${context.fixture ? safeText(context.fixture.fixture_sha256_short) : 'N/A'}
- fixture_width: ${context.fixture ? safeText(context.fixture.width) : 'N/A'}
- fixture_height: ${context.fixture ? safeText(context.fixture.height) : 'N/A'}
- fixture_color_type: ${context.fixture ? safeText(context.fixture.color_type_label) : 'N/A'}
- data_url_present: ${context.fixture ? safeText(context.fixture.data_url_present) : 'no'}

## Payload summary (no image data)
${context.payloadSummary ? JSON.stringify(context.payloadSummary, null, 2) : 'N/A'}

## Note
- This file is regenerated on every dry-run.
- The public \`docs/PHASE_J3_I2V_SMOKE_HARNESS_FIX_REPORT.md\` is
  not touched by the smoke script. It is updated only by a
  dedicated phase with masked identifiers.
`;
}

function renderRealLocalReport(context) {
  return `# Phase J - Real I2V Smoke (Local)

## Execution mode
- confirm_real_video: ${safeText(process.env.CONFIRM_REAL_VIDEO)}
- confirm_real_i2v: ${safeText(process.env.CONFIRM_REAL_I2V)}
- generation_mode: image_to_video

## Payload summary (no image data, no base64)
${context.payloadSummary ? JSON.stringify(context.payloadSummary, null, 2) : 'N/A'}

## Result
- created: ${safeText(context.created)}
- request_task_started: ${safeText(context.requestTaskStarted)}
- created_status: ${safeText(context.createdStatus)}
- final_status: ${safeText(context.finalStatus)}
- task_id: ${safeText(context.taskId)}
- file_id: ${safeText(context.fileId)}
- download_url_present: ${safeText(context.downloadUrl)}
- fail_reason: ${safeText(context.failReason)}
- real_quota_consumed: ${safeText(context.chargeUsed)}

## Time
- started_at: ${safeText(context.startedAt)}
- finished_at: ${safeText(context.finishedAt)}
`;
}

async function writeDryRunReports(context) {
  await fs.promises.mkdir(I2V_DRY_RUN_LOCAL_DIR, { recursive: true });
  await fs.promises.writeFile(I2V_DRY_RUN_LOCAL_MD, renderDryRunReport(context), 'utf8');
  await fs.promises.writeFile(I2V_DRY_RUN_LOCAL_JSON, JSON.stringify(context, null, 2), 'utf8');
  console.log('I2V smoke dry-run console summary:');
  console.log(`  - final_status: ${safeText(context.finalStatus)}`);
  console.log(`  - real_quota_consumed: ${safeText(context.chargeUsed)}`);
  console.log(`  - fail_reason: ${safeText(context.failReason)}`);
  console.log(`  - fixture_path: ${context.fixture ? safeText(context.fixture.fixture_path) : 'N/A'}`);
  console.log(`  - fixture_validation: ${safeText(context.fixtureValidation)}`);
  console.log(`  - data_url_present: ${context.fixture ? safeText(context.fixture.data_url_present) : 'no'}`);
  console.log(`  - payload_summary: ${JSON.stringify(context.payloadSummary || {})}`);
  console.log(`  - local_md: ${I2V_DRY_RUN_LOCAL_MD}`);
  console.log(`  - local_json: ${I2V_DRY_RUN_LOCAL_JSON}`);
}

async function writeRealLocalReports(context) {
  await fs.promises.mkdir(I2V_REAL_LOCAL_DIR, { recursive: true });
  await fs.promises.writeFile(I2V_REAL_LOCAL_MD, renderRealLocalReport(context), 'utf8');
  await fs.promises.writeFile(I2V_REAL_LOCAL_JSON, JSON.stringify(context, null, 2), 'utf8');
  console.log(`Local I2V report saved: ${I2V_REAL_LOCAL_MD}`);
  console.log(`Local I2V JSON saved: ${I2V_REAL_LOCAL_JSON}`);
}

// Phase J.2 incident containment: once-only local lock for the real
// I2V branch. The lock is a JSON file under reports/local/ (gitignored)
// so it is never committed. It carries the masked task_id and the
// timestamp of the submit attempt. To re-authorize a real submit, the
// operator must explicitly delete the lock file.
async function readI2VRealLock() {
  try {
    const raw = await fs.promises.readFile(I2V_REAL_LOCK_PATH, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return { raw_present: true, unparseable: true };
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeI2VRealLock(payload) {
  await fs.promises.mkdir(path.dirname(I2V_REAL_LOCK_PATH), { recursive: true });
  await fs.promises.writeFile(
    I2V_REAL_LOCK_PATH,
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

function maskTaskIdForLock(taskId) {
  if (!taskId) return 'N/A';
  const s = String(taskId);
  if (s.length <= 8) return 'redacted';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function renderLockBlockedReport(existingLock) {
  return `# I2V Smoke - Refused by Once-Only Lock

This run refused to submit because a real-I2V submit has already
been recorded in this checkout. Real I2V smoke is a one-shot per
checkout operation; re-running it consumes MiniMax video quota
without operator oversight.

## Existing lock

- lock_path: ${I2V_REAL_LOCK_PATH}
- created_at: ${existingLock && existingLock.created_at ? existingLock.created_at : 'unknown'}
- previous_task_id_masked: ${existingLock && existingLock.task_id_masked ? existingLock.task_id_masked : 'unknown'}
- previous_real_run_finished_at: ${existingLock && existingLock.finished_at ? existingLock.finished_at : 'unknown'}

## How to re-authorize

If you have a fresh operator authorization and explicitly want to
allow another real submit:

1. Delete the lock file at \`${I2V_REAL_LOCK_PATH}\`.
2. Re-run with \`CONFIRM_REAL_VIDEO=1 CONFIRM_REAL_I2V=1 npm run
   smoke:i2v\`.

The lock file lives under \`reports/local/\`, which is gitignored,
so deleting it does not affect the public repository.

## Why this exists

The Phase J.2 incident on 2026-06-16 created two real I2V submits
instead of the one authorized. The root cause was an
execution-discipline violation: a \`node -e\` debugging replay of
the smoke script ran with the \`CONFIRM_REAL_*\` env vars in scope
and submitted a second task. This lock makes a second real submit
mechanically impossible unless the operator explicitly deletes it.
`;
}

function renderFixtureInvalidReport(fixtureInfo) {
  return `# I2V Smoke - Refused: Fixture Invalid

The I2V smoke fixture is missing, unreadable, or fails one or
more pre-flight checks. The real I2V branch refuses to proceed
because sending an invalid PNG to MiniMax would consume video
quota for a guaranteed failure (the Phase J.2 incident root
cause).

## Fixture pre-flight

- fixture_path: ${fixtureInfo ? safeText(fixtureInfo.fixture_path) : 'N/A'}
- fixture_error: ${fixtureInfo && fixtureInfo.error ? safeText(fixtureInfo.error) : 'unknown'}

## How to fix

1. Run \`npm run fixture:i2v:generate\` to (re)create the fixture.
2. Run \`npm run fixture:i2v:validate\` to confirm it is healthy.
3. Re-run \`npm run smoke:i2v\`.

Do not bypass the fixture check by editing \`scripts/smoke-image-to-video.js\`.
`;
}

async function main() {
  const start = new Date().toISOString();
  const report = {
    created: 'No',
    requestTaskStarted: 'No',
    createdStatus: 'N/A',
    finalStatus: 'N/A',
    taskId: 'N/A',
    fileId: 'N/A',
    downloadUrl: 'N/A',
    failReason: 'N/A',
    chargeUsed: 'No',
    startedAt: start,
    finishedAt: start,
    payloadSummary: null,
    fixture: null,
    fixtureValidation: 'skipped',
  };

  const keyExists = Boolean(process.env.MINIMAX_API_KEY);
  const confirmRealVideo = String(process.env.CONFIRM_REAL_VIDEO || '').trim() === '1';
  const confirmRealI2V = String(process.env.CONFIRM_REAL_I2V || '').trim() === '1';
  const testLockOnly =
    String(process.env.I2V_SMOKE_TEST_LOCK_ONLY || '').trim() === '1';

  console.log('MiniMax I2V smoke test:');
  console.log(`MINIMAX_API_KEY exists: ${keyExists ? 'yes' : 'no'}`);
  console.log(`API base: ${process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com'}`);

  if (!confirmRealVideo || !confirmRealI2V) {
    // DRY-RUN branch.
    // 1. Validate fixture (strict, pngjs decode).
    const fixture = await loadI2VFixtureDataUrl();
    report.fixture = {
      fixture_path: fixture.fixture_path,
      fixture_sha256_short: fixture.fixture_sha256_short,
      fixture_bytes: fixture.fixture_bytes,
      width: fixture.width,
      height: fixture.height,
      color_type_label: fixture.color_type_label,
      data_url_present: fixture.data_url_present,
      error: fixture.error,
    };
    const validation = await validateI2VFixture();
    report.fixtureValidation = validation.ok
      ? 'PASS'
      : `FAIL (${validation.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')})`;
    report.failReason =
      'Skipped by default. Set CONFIRM_REAL_VIDEO=1 and CONFIRM_REAL_I2V=1 and run again for one controlled real call.';
    report.finishedAt = new Date().toISOString();
    report.finalStatus = validation.ok ? 'dry_run_ok' : 'dry_run_fixture_invalid';
    // Build payload summary from the actual fixture so the dry-run
    // exercise is real (it still does NOT call MiniMax).
    if (validation.ok && fixture.ok) {
      report.payloadSummary = payloadSummaryForLog(
        buildI2VPayload(fixture.data_url_for_payload_only, fixture.fixture_sha256_short),
      );
      // Defensive: strip the full data URL from the JSON we write
      // to reports/local/. The summary exposes length / sha8 / kind
      // / bytes but never the bytes themselves.
      if (report.payloadSummary && report.payloadSummary.first_frame_image_bytes_estimated) {
        delete report.payloadSummary.first_frame_image_bytes_estimated;
        report.payloadSummary.first_frame_image_data_url_chars = fixture.data_url_length;
      }
    } else {
      report.payloadSummary = {
        first_frame_image_kind: 'absent',
        fixture_error: fixture.error || 'unknown',
      };
    }
    await writeDryRunReports(report);
    return;
  }

  // REAL branch.
  // I2V_SMOKE_TEST_LOCK_ONLY is a check:api-only path: it forces
  // the script through the lock-blocked code path with no remote
  // call. It MUST NEVER be combined with the actual remote call.
  if (testLockOnly) {
    const fixture = await loadI2VFixtureDataUrl();
    report.fixture = {
      fixture_path: fixture.fixture_path,
      fixture_sha256_short: fixture.fixture_sha256_short,
      fixture_bytes: fixture.fixture_bytes,
      width: fixture.width,
      height: fixture.height,
      color_type_label: fixture.color_type_label,
      data_url_present: fixture.data_url_present,
      error: fixture.error,
    };
    const validation = await validateI2VFixture();
    report.fixtureValidation = validation.ok ? 'PASS' : 'FAIL';
    if (!validation.ok) {
      report.failReason = 'Fixture validation failed; refuse to proceed.';
      report.finalStatus = 'refused_by_fixture';
      report.finishedAt = new Date().toISOString();
      await fs.promises.mkdir(I2V_REAL_LOCAL_DIR, { recursive: true });
      const blockedPath = path.resolve(
        I2V_REAL_LOCAL_DIR,
        'i2v-smoke-blocked-by-fixture.local.md',
      );
      await fs.promises.writeFile(blockedPath, renderFixtureInvalidReport(report.fixture), 'utf8');
      console.error(report.failReason);
      console.error(`Block report: ${blockedPath}`);
      await writeRealLocalReports(report);
      await writeDryRunReports(report);
      return;
    }
    // Synthetic lock for the test path: only present if test mode
    // AND the harness placed one there for us. The actual check:api
    // step creates this file before invoking the script.
    const existingLock = await readI2VRealLock();
    if (existingLock) {
      report.failReason =
        'Refused: real I2V smoke has already been run in this checkout. ' +
        'Delete reports/local/i2v-real-smoke.lock to re-authorize.';
      report.createdStatus = 'not_created';
      report.finalStatus = 'refused_by_lock';
      report.chargeUsed = 'No';
      report.finishedAt = new Date().toISOString();
      await fs.promises.mkdir(I2V_REAL_LOCAL_DIR, { recursive: true });
      const blockedPath = path.resolve(
        I2V_REAL_LOCAL_DIR,
        'i2v-smoke-blocked-by-lock.local.md',
      );
      await fs.promises.writeFile(blockedPath, renderLockBlockedReport(existingLock), 'utf8');
      console.error(report.failReason);
      console.error(`Existing lock: ${I2V_REAL_LOCK_PATH}`);
      console.error(`Block report: ${blockedPath}`);
      await writeRealLocalReports(report);
      await writeDryRunReports(report);
      return;
    }
    // No lock present: test mode reached the end without firing.
    report.failReason = 'I2V_SMOKE_TEST_LOCK_ONLY=1 set but no lock present';
    report.finalStatus = 'refused_by_test_mode_no_lock';
    report.chargeUsed = 'No';
    report.finishedAt = new Date().toISOString();
    await writeRealLocalReports(report);
    await writeDryRunReports(report);
    process.exitCode = 2;
    return;
  }

  if (!keyExists) {
    report.failReason = 'Missing MINIMAX_API_KEY';
    report.createdStatus = 'not_created';
    report.finalStatus = 'failed';
    report.finishedAt = new Date().toISOString();
    report.chargeUsed = 'No';
    await writeRealLocalReports(report);
    await writeDryRunReports(report);
    return;
  }

  // Phase J.3 fixture pre-flight: refuse to submit if the fixture
  // is missing or invalid. This prevents the Phase J.2 incident
  // class (sending an invalid PNG to MiniMax) from recurring.
  const fixture = await loadI2VFixtureDataUrl();
  report.fixture = {
    fixture_path: fixture.fixture_path,
    fixture_sha256_short: fixture.fixture_sha256_short,
    fixture_bytes: fixture.fixture_bytes,
    width: fixture.width,
    height: fixture.height,
    color_type_label: fixture.color_type_label,
    data_url_present: fixture.data_url_present,
    error: fixture.error,
  };
  const validation = await validateI2VFixture();
  report.fixtureValidation = validation.ok ? 'PASS' : 'FAIL';
  if (!validation.ok) {
    report.failReason = `Refused: fixture validation failed (${validation.checks
      .filter((c) => !c.ok)
      .map((c) => c.name)
      .join(', ')})`;
    report.createdStatus = 'not_created';
    report.finalStatus = 'refused_by_fixture';
    report.chargeUsed = 'No';
    report.finishedAt = new Date().toISOString();
    await fs.promises.mkdir(I2V_REAL_LOCAL_DIR, { recursive: true });
    const blockedPath = path.resolve(
      I2V_REAL_LOCAL_DIR,
      'i2v-smoke-blocked-by-fixture.local.md',
    );
    await fs.promises.writeFile(blockedPath, renderFixtureInvalidReport(report.fixture), 'utf8');
    console.error(report.failReason);
    console.error(`Block report: ${blockedPath}`);
    await writeRealLocalReports(report);
    await writeDryRunReports(report);
    return;
  }

  // Phase J.2 incident containment: once-only local lock. If a real
  // submit has already happened in this checkout, refuse to submit
  // again. The operator can delete the lock file to re-authorize.
  const existingLock = await readI2VRealLock();
  if (existingLock) {
    report.failReason =
      'Refused: real I2V smoke has already been run in this checkout. ' +
      'Delete reports/local/i2v-real-smoke.lock to re-authorize.';
    report.createdStatus = 'not_created';
    report.finalStatus = 'refused_by_lock';
    report.chargeUsed = 'No';
    report.finishedAt = new Date().toISOString();
    await fs.promises.mkdir(I2V_REAL_LOCAL_DIR, { recursive: true });
    const blockedPath = path.resolve(
      I2V_REAL_LOCAL_DIR,
      'i2v-smoke-blocked-by-lock.local.md',
    );
    await fs.promises.writeFile(blockedPath, renderLockBlockedReport(existingLock), 'utf8');
    console.error(report.failReason);
    console.error(`Existing lock: ${I2V_REAL_LOCK_PATH}`);
    console.error(`Block report: ${blockedPath}`);
    await writeRealLocalReports(report);
    await writeDryRunReports(report);
    return;
  }

  report.chargeUsed = 'Yes';
  report.requestTaskStarted = 'Yes';

  try {
    await runRealI2VSmoke(
      report,
      fixture.data_url_for_payload_only,
      fixture.fixture_sha256_short,
    );
    await writeI2VRealLock({
      created_at: start,
      finished_at: report.finishedAt,
      task_id_masked: maskTaskIdForLock(report.taskId),
      final_status: report.finalStatus,
      fail_reason_kind:
        report.finalStatus === 'Success'
          ? 'success'
          : report.failReason
          ? 'failed'
          : 'unknown',
    });
  } catch (error) {
    report.finalStatus = 'failed';
    report.failReason = error.message || 'unknown error';
    console.error(error.message || error);
    try {
      await writeI2VRealLock({
        created_at: start,
        finished_at: new Date().toISOString(),
        task_id_masked: maskTaskIdForLock(report.taskId),
        final_status: report.finalStatus,
        fail_reason_kind: 'failed',
        error_message_kind: (error && error.message) ? error.message.split('\n')[0].slice(0, 200) : 'unknown',
      });
    } catch (_lockErr) {
      // best-effort lock write; never throw from the finally.
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    report.downloadUrl = safeText(report.downloadUrl);
    await writeRealLocalReports(report);
    await writeDryRunReports(report);
    console.log(`Final status: ${report.finalStatus}`);
    console.log('I2V smoke flow completed.');
    if (report.taskId !== 'N/A') {
      console.log('task record: redacted');
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});