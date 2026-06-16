#!/usr/bin/env node
/**
 * Phase J.3 - I2V first-frame image fixture generator.
 *
 * Generates a deterministic, abstract 1024x768 RGBA PNG that is
 * suitable as a first_frame_image for the MiniMax I2V smoke.
 *
 * Why this exists: the previous hand-written PNG encoder
 * (scripts/smoke-image-to-video.js::buildMinimalPngDataUrl) had
 * a known bug where the declared IHDR dimensions did not match
 * the actual IDAT pixel count. MiniMax's service-side decoder
 * rejected the resulting PNG with "invalid format / too much
 * pixel data", and Phase J.2 ended up submitting TWO real I2V
 * tasks that both failed for the same reason (one of them an
 * execution-discipline violation during debugging).
 *
 * This script uses pngjs (now a devDependency) to produce a
 * valid PNG. The image is a 1024x768 RGBA abstract gradient
 * containing no people, no logos, no copyrighted content.
 *
 * Output:
 *   test/fixtures/i2v-smoke-first-frame.png
 *
 * This file IS meant to be committed (it is a deterministic
 * abstract test fixture, not a sensitive asset).
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const FIXTURE_WIDTH = 1024;
const FIXTURE_HEIGHT = 768;
const FIXTURE_PATH = path.resolve(
  process.cwd(),
  'test',
  'fixtures',
  'i2v-smoke-first-frame.png',
);

function buildRgbaBuffer(width, height) {
  const png = new PNG({ width, height, colorType: 6 }); // RGBA
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) << 2;
      // Abstract two-band horizontal gradient with a soft
      // diagonal modulation. No people, no text, no logos.
      const t = y / (height - 1);
      const u = x / (width - 1);
      const r = Math.round(40 + 180 * t);
      const g = Math.round(60 + 140 * u);
      const b = Math.round(180 - 80 * t);
      // Modulation term: produces a soft diagonal sweep.
      const mod = Math.round(20 * Math.sin((x + y) * 0.02));
      png.data[idx] = Math.max(0, Math.min(255, r + mod));
      png.data[idx + 1] = Math.max(0, Math.min(255, g + mod));
      png.data[idx + 2] = Math.max(0, Math.min(255, b + mod));
      png.data[idx + 3] = 255; // fully opaque
    }
  }
  return png;
}

function main() {
  const png = buildRgbaBuffer(FIXTURE_WIDTH, FIXTURE_HEIGHT);
  const buf = PNG.sync.write(png, { colorType: 6 });
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, buf);

  // Sanity: decode what we just wrote and report a redacted
  // summary. Never log the file's raw bytes.
  const reread = PNG.sync.read(buf);
  const summary = {
    fixture_path: path.relative(process.cwd(), FIXTURE_PATH),
    width: reread.width,
    height: reread.height,
    color_type: reread.colorType,
    bytes: buf.length,
    sha256_short: require('crypto')
      .createHash('sha256')
      .update(buf)
      .digest('hex')
      .slice(0, 8),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();