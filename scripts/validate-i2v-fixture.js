#!/usr/bin/env node
/**
 * Phase J.3 - I2V first-frame image fixture validator.
 *
 * Reads the fixture produced by scripts/generate-i2v-fixture.js
 * and verifies that it is suitable as a first_frame_image for
 * the MiniMax I2V smoke.
 *
 * Checks (all must PASS for the fixture to be considered valid):
 *   1. The file exists at test/fixtures/i2v-smoke-first-frame.png.
 *   2. It starts with the PNG magic bytes.
 *   3. pngjs can decode it without error.
 *   4. Decoded width  == 1024.
 *   5. Decoded height == 768.
 *   6. Decoded pixel buffer length == width * height * 4 (RGBA).
 *   7. File size on disk is under 20 MB (MiniMax cap).
 *   8. Short side (min(width,height)) is >= 300 px (MiniMax rule).
 *   9. Aspect ratio (max/min) is between 0.40 and 2.50 (MiniMax rule).
 *  10. Extension and PNG header both report image/png.
 *
 * Exit codes:
 *   0 - all checks passed
 *   1 - one or more checks failed (details in stdout)
 *
 * The script NEVER echoes the raw bytes or the full base64 of
 * the image. It only prints a redacted summary suitable for
 * logs and CI.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  'test',
  'fixtures',
  'i2v-smoke-first-frame.png',
);

const EXPECTED_WIDTH = 1024;
const EXPECTED_HEIGHT = 768;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_SHORT_SIDE_PX = 300;
const ASPECT_RATIO_MIN = 0.4;
const ASPECT_RATIO_MAX = 2.5;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${name}${detail ? ` - ${detail}` : ''}`);
}

function main() {
  // 1. exists
  let buf = null;
  if (!fs.existsSync(FIXTURE_PATH)) {
    record('fixture exists', false, `missing: ${path.relative(process.cwd(), FIXTURE_PATH)}`);
    return finalize();
  }
  const stat = fs.statSync(FIXTURE_PATH);
  record(
    'fixture exists',
    true,
    `${path.relative(process.cwd(), FIXTURE_PATH)} (${stat.size} bytes)`,
  );

  // 2. magic
  buf = fs.readFileSync(FIXTURE_PATH);
  const magicOk = buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
  record('PNG magic bytes', magicOk, magicOk ? '0x89 0x50 0x4e 0x47 ... present' : 'magic mismatch');

  // 3. decodable
  let png = null;
  try {
    png = PNG.sync.read(buf);
    record('pngjs decode', true, `decoded in-memory`);
  } catch (err) {
    record('pngjs decode', false, err.message);
    return finalize();
  }

  // 4. width
  record('width == 1024', png.width === EXPECTED_WIDTH, `got=${png.width}`);

  // 5. height
  record('height == 768', png.height === EXPECTED_HEIGHT, `got=${png.height}`);

  // 6. pixel buffer length
  const expectedPixels = png.width * png.height * 4; // RGBA
  const actualPixels = png.data ? png.data.length : 0;
  record(
    'RGBA pixel buffer length == width * height * 4',
    actualPixels === expectedPixels,
    `expected=${expectedPixels} actual=${actualPixels}`,
  );

  // 7. file size cap
  record(
    'file size <= 20MB',
    buf.length <= MAX_BYTES,
    `bytes=${buf.length} cap=${MAX_BYTES}`,
  );

  // 8. short side
  const shortSide = Math.min(png.width, png.height);
  record(
    'short side >= 300px',
    shortSide >= MIN_SHORT_SIDE_PX,
    `short_side=${shortSide}`,
  );

  // 9. aspect ratio
  const longSide = Math.max(png.width, png.height);
  const aspect = shortSide > 0 ? longSide / shortSide : 0;
  record(
    'aspect ratio in [0.40, 2.50]',
    aspect >= ASPECT_RATIO_MIN && aspect <= ASPECT_RATIO_MAX,
    `aspect=${aspect.toFixed(3)}`,
  );

  // 10. extension / mime agreement
  const ext = path.extname(FIXTURE_PATH).toLowerCase();
  record(
    'extension + PNG header both report image/png',
    ext === '.png' && png.colorType !== undefined,
    `ext=${ext} color_type=${png.colorType}`,
  );

  // Final fingerprint
  const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  console.log(`fixture sha256[0:8]: ${sha}`);

  return finalize();
}

function finalize() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`summary: ${passed}/${results.length} checks passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();