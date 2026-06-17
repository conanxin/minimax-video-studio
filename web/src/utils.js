// Phase Q.2: state-free utilities extracted from web/src/App.jsx.
// Every function here is pure or uses only browser globals (Date, File,
// FileReader, Image, URL, etc.) — no React hooks, no component state.
// Putting them in their own ES module guarantees that lexical bindings
// for these helpers exist before the App component begins to render,
// which is the structural fix for the Phase Q.1 / Q.2 TDZ regressions.

import { FALLBACK_I2V_CONFIG } from './constants.js';

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatAgeLabel(hours) {
  if (hours === null || hours === undefined) return null;
  const numeric = Number(hours);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 1) {
    const minutes = Math.max(1, Math.round(numeric * 60));
    return `${minutes} 分钟前刷新`;
  }
  if (numeric < 24) {
    const rounded = Math.round(numeric);
    return `${rounded} 小时前刷新`;
  }
  const days = Math.round(numeric / 24);
  return `${days} 天前刷新`;
}

export function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();
  if (!value) return 'Unknown';
  const map = {
    preparing: 'Preparing',
    queueing: 'Queueing',
    processing: 'Processing',
    running: 'Processing',
    success: 'Success',
    completed: 'Success',
    fail: 'Fail',
    failed: 'Fail',
    error: 'Fail',
  };
  return map[value] || (value[0].toUpperCase() + value.slice(1).toLowerCase());
}

export function isTerminalStatus(status) {
  const n = normalizeStatus(status);
  return n === 'Success' || n === 'Fail';
}

export function shortId(value) {
  if (!value) return '-';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function shortTaskId(taskId) {
  return shortId(taskId);
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countOccurrences(text, token) {
  const regex = new RegExp(escapeRegExp(token), 'gi');
  const matches = String(text).match(regex);
  return matches ? matches.length : 0;
}

export function formatReadableTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('en-US');
  } catch {
    return value;
  }
}

export function summarizePrompt(value, max = 80) {
  if (!value) return '(empty prompt)';
  const flat = String(value).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

export function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function groupLabelForIso(value) {
  if (!value) return 'Earlier';
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return 'Earlier';
  const today = startOfLocalDay(new Date());
  const taskDay = startOfLocalDay(target);
  const diffDays = Math.round((today - taskDay) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return 'Earlier';
}

export function groupTasksByDate(tasks) {
  const groups = new Map();
  for (const task of tasks || []) {
    const label = groupLabelForIso(task.updated_at || task.created_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(task);
  }
  return ['Today', 'Yesterday', 'Earlier']
    .filter((label) => groups.has(label))
    .map((label) => ({ label, tasks: groups.get(label) }));
}

export function buildModelList(config) {
  return Object.keys(config.compatibility || {});
}

export function getDurations(config, model) {
  const durations = Object.keys(config.compatibility?.[model] || {});
  const sorted = durations.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return sorted.sort((a, b) => a - b);
}

export function getResolutionOptions(config, model, duration) {
  return config.compatibility?.[model]?.[String(duration)] || [];
}

export function supportHint(config, model, duration) {
  const item = config.compatibility?.[model] || {};
  const parts = Object.entries(item).map(([sec, resolutions]) => `${sec}s: ${resolutions.join(' / ')}`);
  return `${model} supports: ${parts.join('; ')}`;
}

export function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (min !== undefined && numeric < min) return min;
  if (max !== undefined && numeric > max) return max;
  return numeric;
}

export function pickPollingConfig(remote, fallback) {
  if (!remote || typeof remote !== 'object') return fallback;
  return {
    initialIntervalMs: clampNumber(remote.initialIntervalMs, fallback.initialIntervalMs, 1000, 5 * 60_000),
    maxIntervalMs: clampNumber(remote.maxIntervalMs, fallback.maxIntervalMs, 1000, 10 * 60_000),
    maxAttempts: clampNumber(remote.maxAttempts, fallback.maxAttempts, 1, 1000),
    maxDurationMinutes: clampNumber(remote.maxDurationMinutes, fallback.maxDurationMinutes, 1, 240),
    backoffFactor: clampNumber(remote.backoffFactor, fallback.backoffFactor, 1, 5),
    jitterMs: clampNumber(remote.jitterMs, fallback.jitterMs, 0, 60_000),
  };
}

// Inspect an image file (FileReader -> Data URL + Image element) and
// return a Promise with a structured result. Always resolves; never
// rejects. Callers should treat ok=false as a soft validation failure
// (grey out submit, show the reason).
export function inspectImageFile(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ ok: false, reason: 'no_file', error: 'No file provided.' });
      return;
    }
    const mime = (file.type || '').toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      resolve({
        ok: false,
        reason: 'unsupported_mime',
        error: `Unsupported image type: ${mime || 'unknown'}. Allowed: JPG/JPEG, PNG, WebP.`,
      });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      resolve({
        ok: false,
        reason: 'too_large',
        error: `Image is too large: ${formatBytes(file.size)} > 20 MB.`,
      });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      resolve({ ok: false, reason: 'read_error', error: 'Failed to read the image file.' });
    };
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onerror = () => {
        resolve({
          ok: false,
          reason: 'decode_error',
          error: 'Could not decode the image. Try a different file.',
        });
      };
      img.onload = () => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const shortSide = Math.min(width, height);
        const longSide = Math.max(width, height);
        const ratio = height > 0 && width > 0 ? longSide / shortSide : 0;
        const minShort = FALLBACK_I2V_CONFIG.image_constraints.min_short_side_px;
        const ratioMin = FALLBACK_I2V_CONFIG.image_constraints.aspect_ratio_min;
        const ratioMax = FALLBACK_I2V_CONFIG.image_constraints.aspect_ratio_max;
        if (shortSide < minShort) {
          resolve({
            ok: false,
            reason: 'too_small',
            error: `Image short side is ${shortSide}px; must be at least ${minShort}px.`,
            dataUrl,
            width,
            height,
            mime,
            sizeBytes: file.size,
          });
          return;
        }
        if (ratio < ratioMin || ratio > ratioMax) {
          resolve({
            ok: false,
            reason: 'bad_aspect',
            error: `Aspect ratio ${ratio.toFixed(2)} outside 2:5 to 5:2 (${ratioMin}–${ratioMax}).`,
            dataUrl,
            width,
            height,
            mime,
            sizeBytes: file.size,
          });
          return;
        }
        resolve({
          ok: true,
          dataUrl,
          width,
          height,
          mime,
          sizeBytes: file.size,
          ratio,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function validateImageUrlInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, error: 'first_frame_image is required for image_to_video.' };
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(raw)) {
    return { ok: true };
  }
  if (/^https:\/\//i.test(raw)) {
    return { ok: true };
  }
  if (/^data:image\//i.test(raw)) {
    return { ok: false, error: 'Unsupported Data URL image format. Allowed: JPG/JPEG, PNG, WebP.' };
  }
  if (/^http:\/\//i.test(raw)) {
    return { ok: false, error: 'http:// URLs are not allowed. Use https://.' };
  }
  if (/^file:\/\//i.test(raw)) {
    return { ok: false, error: 'file:// URLs are not allowed. Upload the image instead.' };
  }
  return { ok: false, error: 'Provide an https:// URL or upload an image.' };
}

// Build a query-string from a base path and a params object. Uses
// window.location.origin so it works both server-rendered (where
// `window` is undefined) and client-rendered. In our app this is
// always client-rendered so `window` is guaranteed.
export function buildQueryString(base, params) {
  const url = new URL(base, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}
