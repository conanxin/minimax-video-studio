const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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
const CHECK_INTERVAL_MS = 10_000;
const MAX_ATTEMPTS = 60;
const I2V_TEST_IMAGE_WIDTH = 1024;
const I2V_TEST_IMAGE_HEIGHT = 768;

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

// Build a minimal valid PNG without any external image dependency.
// Produces a 3x2 RGB gradient that satisfies the MiniMax I2V
// `data:image/png;base64,...` input contract. Strictly a placeholder
// frame with no copyrighted content.
function buildMinimalPngDataUrl(width = I2V_TEST_IMAGE_WIDTH, height = I2V_TEST_IMAGE_HEIGHT) {
  if (width < 3 || height < 2) {
    throw new Error('Test image dimensions too small for PNG encoding.');
  }
  // Use 3x2 base pattern repeated to fill the requested canvas.
  const baseW = 3;
  const baseH = 2;
  const basePixels = [
    [240, 200, 160],
    [120, 80, 200],
    [200, 220, 240],
    [60, 40, 80],
    [180, 200, 220],
    [255, 255, 200],
  ];
  const rowBytes = baseW * 3;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0; // PNG filter byte: None
    for (let x = 0; x < width; x += 1) {
      const srcY = y % baseH;
      const srcX = x % baseW;
      const src = basePixels[srcY * baseW + srcX];
      const off = y * (1 + width * 3) + 1 + x * 3;
      raw[off] = src[0];
      raw[off + 1] = src[1];
      raw[off + 2] = src[2];
    }
  }
  // Build IDAT from baseH=2 raw rows repeated to height.
  const idatRaw = Buffer.alloc(height * (1 + baseW * 3));
  for (let y = 0; y < height; y += 1) {
    idatRaw[y * (1 + baseW * 3)] = 0;
    for (let x = 0; x < baseW; x += 1) {
      const src = basePixels[y % baseH * baseW + x];
      const off = y * (1 + baseW * 3) + 1 + x * 3;
      idatRaw[off] = src[0];
      idatRaw[off + 1] = src[1];
      idatRaw[off + 2] = src[2];
    }
  }
  // Avoid double-suppress unused warnings.
  void rowBytes;
  void raw;
  const idatData = zlib.deflateSync(idatRaw);
  // CRC32 over chunk type + data
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcInput) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  function crc32(buf) {
    let table = crc32.table;
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
      }
      crc32.table = table;
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c = (table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(baseW, 0);
  ihdr.writeUInt32BE(baseH, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const iend = Buffer.alloc(0);
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', iend)]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function buildI2VPayload() {
  return {
    model: i2vModelConfig.defaults.model,
    prompt: 'A calm abstract gradient slowly blooming outward, soft pastel lighting, no people, no text, no logos, gentle cinematic motion, 6 seconds.',
    first_frame_image: buildMinimalPngDataUrl(),
    duration: i2vModelConfig.defaults.duration,
    resolution: i2vModelConfig.defaults.resolution,
    prompt_optimizer: i2vModelConfig.defaults.prompt_optimizer,
  };
}

function payloadSummaryForLog(payload) {
  return {
    model: payload.model,
    prompt: payload.prompt,
    duration: payload.duration,
    resolution: payload.resolution,
    prompt_optimizer: payload.prompt_optimizer,
    first_frame_image_kind: payload.first_frame_image.startsWith('data:image/png;base64,')
      ? 'data_url_png'
      : 'unknown',
    first_frame_image_bytes_estimated: payload.first_frame_image.length,
    first_frame_image_sha256_short: crypto
      .createHash('sha256')
      .update(payload.first_frame_image)
      .digest('hex')
      .slice(0, 8),
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

async function runRealI2VSmoke(context) {
  const payload = buildI2VPayload();
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
    input_image_summary: 'PNG placeholder frame, no copyrighted content',
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

## Payload summary (no image data)
${context.payloadSummary ? JSON.stringify(context.payloadSummary, null, 2) : 'N/A'}

## Note
- This file is regenerated on every dry-run.
- The public \`docs/PHASE_J_REAL_I2V_SMOKE_REPORT.md\` is not touched
  by the smoke script. It is updated only by a dedicated phase with
  masked identifiers.
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
  };

  const keyExists = Boolean(process.env.MINIMAX_API_KEY);
  const confirmRealVideo = String(process.env.CONFIRM_REAL_VIDEO || '').trim() === '1';
  const confirmRealI2V = String(process.env.CONFIRM_REAL_I2V || '').trim() === '1';

  console.log('MiniMax I2V smoke test:');
  console.log(`MINIMAX_API_KEY exists: ${keyExists ? 'yes' : 'no'}`);
  console.log(`API base: ${process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com'}`);

  if (!confirmRealVideo || !confirmRealI2V) {
    report.failReason =
      'Skipped by default. Set CONFIRM_REAL_VIDEO=1 and CONFIRM_REAL_I2V=1 and run again for one controlled real call.';
    report.finishedAt = new Date().toISOString();
    report.finalStatus = 'skipped';
    report.payloadSummary = payloadSummaryForLog(buildI2VPayload());
    await writeDryRunReports(report);
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

  report.chargeUsed = 'Yes';
  report.requestTaskStarted = 'Yes';

  try {
    await runRealI2VSmoke(report);
  } catch (error) {
    report.finalStatus = 'failed';
    report.failReason = error.message || 'unknown error';
    console.error(error.message || error);
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
