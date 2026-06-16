// Phase I Recovery - shared validation helpers for the create-task path.
//
// Lives in its own file so that `taskStore.js` can stay focused on
// persistence and `index.js` can stay focused on HTTP wiring. The
// public surface is intentionally tiny:
//
//   - validateTaskInput(payload)  -> { ok, normalized, error, hint }
//   - validateImageInput(...)     -> { ok, summary, error, hint }
//
// All functions are pure: no I/O, no side effects, no MiniMax calls.
// Validation MUST be run before any remote API call so the server can
// return 400 with a user-friendly message instead of consuming quota.

// shared/videoModels.json is a flat config (defaults / compatibility / ... at root)
// shared/videoModelsI2V.json wraps its body in `i2vModelConfig` so future
// siblings can coexist under a single root. Always unwrap via the wrapper
// keys - never read the JSON as if it were flat.
const T2V = require('../../shared/videoModels.json');
const I2V = require('../../shared/videoModelsI2V.json').i2vModelConfig;

const ALLOWED_GENERATION_MODES = new Set(['text_to_video', 'image_to_video']);
const PUBLIC_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PUBLIC_IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[::1?\]$/i,
  /^\[fc[0-9a-f]{2}:/i,
  /^\[fd[0-9a-f]{2}:/i,
];

function asTrimmedString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeGenerationMode(value) {
  if (value === undefined || value === null || value === '') {
    return 'text_to_video';
  }
  const mode = String(value).trim().toLowerCase();
  if (!ALLOWED_GENERATION_MODES.has(mode)) {
    return null;
  }
  return mode;
}

function isValidT2VModel(model) {
  return Object.prototype.hasOwnProperty.call(T2V.compatibility, model);
}

function isValidI2VModel(model) {
  return Object.prototype.hasOwnProperty.call(I2V.compatibility, model);
}

function supportedI2VResolutions(model, duration) {
  const durationKey = String(duration);
  return I2V.compatibility[model]?.[durationKey] || [];
}

function supportedI2VDurations(model) {
  return Object.keys(I2V.compatibility[model] || {}).map((v) => Number(v));
}

function i2vCombinationHint(model) {
  if (!I2V.compatibility[model]) {
    return `Image-to-video model not in allowed list. Allowed: ${Object.keys(I2V.compatibility).join(' / ')}.`;
  }
  const pairs = Object.entries(I2V.compatibility[model])
    .map(([seconds, resolutions]) => `${seconds}s: ${resolutions.join(' / ')}`);
  return `Image-to-video ${model} supports ${pairs.join('; ')}.`;
}

function t2vCombinationHint(model) {
  if (!T2V.compatibility[model]) return 'Model not in allowed list.';
  const pairs = Object.entries(T2V.compatibility[model])
    .map(([seconds, resolutions]) => `${seconds}s: ${resolutions.join(' / ')}`);
  return `${model} supports ${pairs.join('; ')}.`;
}

function validateTextInput(payload) {
  const { model, duration, resolution, prompt, prompt_optimizer } = payload || {};

  if (!prompt || asTrimmedString(prompt).length === 0) {
    return { ok: false, error: 'Prompt is required.' };
  }
  if (asTrimmedString(prompt).length > T2V.max_prompt_length) {
    return {
      ok: false,
      error: `Prompt must be no more than ${T2V.max_prompt_length} characters.`,
    };
  }
  if (!isValidT2VModel(model)) {
    return {
      ok: false,
      error: 'Unsupported model.',
      hint: `Allowed: ${Object.keys(T2V.compatibility).join(' / ')}`,
    };
  }
  const normalizedDuration = Number(duration);
  if (!Number.isInteger(normalizedDuration) || normalizedDuration <= 0) {
    return { ok: false, error: 'Duration must be a positive integer.' };
  }
  const allowedResolutions = T2V.compatibility[model]?.[String(normalizedDuration)] || [];
  if (allowedResolutions.length === 0) {
    return {
      ok: false,
      error: `${model} does not support duration ${normalizedDuration}s.`,
      hint: t2vCombinationHint(model),
    };
  }
  if (!allowedResolutions.includes(String(resolution))) {
    return {
      ok: false,
      error: `${model} does not support ${normalizedDuration}s + ${resolution}.`,
      hint: t2vCombinationHint(model),
    };
  }
  return {
    ok: true,
    normalized: {
      generation_mode: 'text_to_video',
      model,
      duration: normalizedDuration,
      resolution: String(resolution),
      prompt: asTrimmedString(prompt),
      prompt_optimizer: prompt_optimizer !== false,
    },
  };
}

function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(value);
  if (!match) return null;
  return {
    mime: match[1].toLowerCase().replace('jpg', 'jpeg'),
    base64: match[2],
  };
}

function isPrivateHost(hostname) {
  if (!hostname) return true;
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(hostname));
}

function parsePublicUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch (_err) {
    return null;
  }
  if (url.protocol.toLowerCase() !== 'https:') return null;
  if (!url.hostname || isPrivateHost(url.hostname)) return null;
  return { url, host: url.hostname };
}

function validateImageInput(value) {
  const raw = asTrimmedString(value);
  if (!raw) {
    return {
      ok: false,
      error: 'first_frame_image is required for image_to_video.',
      hint: 'Provide an https:// image URL or a data:image/jpeg|png|webp;base64,... Data URL.',
    };
  }

  const dataUrl = parseDataUrl(raw);
  if (dataUrl) {
    const maxBytes = I2V.image_constraints?.max_bytes || 20 * 1024 * 1024;
    // 4 chars of base64 -> 3 bytes; round up
    const approxBytes = Math.ceil((dataUrl.base64.length * 3) / 4);
    if (approxBytes > maxBytes) {
      return {
        ok: false,
        error: `First frame image is too large (${approxBytes} bytes > ${maxBytes} bytes).`,
        hint: 'Use an image under 20MB or pass a public https URL instead.',
      };
    }
    if (!PUBLIC_IMAGE_MIMES.has(dataUrl.mime)) {
      return {
        ok: false,
        error: `Unsupported image MIME type: ${dataUrl.mime}.`,
        hint: 'Allowed MIME types: image/jpeg, image/png, image/webp.',
      };
    }
    return {
      ok: true,
      kind: 'data_url',
      mime: dataUrl.mime,
      approx_bytes: approxBytes,
    };
  }

  const publicUrl = parsePublicUrl(raw);
  if (publicUrl) {
    return {
      ok: true,
      kind: 'public_url',
      host: publicUrl.host,
    };
  }

  // Specific error branches for the common anti-patterns so the
  // frontend can show actionable messages without leaking the raw
  // string.
  if (/^data:image\//i.test(raw)) {
    return {
      ok: false,
      error: 'Unsupported Data URL image format. Allowed: image/jpeg, image/png, image/webp.',
      hint: 'Convert the image to JPG, PNG, or WebP before encoding as a Data URL.',
    };
  }
  if (/^https?:\/\//i.test(raw)) {
    return {
      ok: false,
      error: 'Only https:// public image URLs are allowed. http://, localhost, and private network addresses are rejected.',
      hint: 'Use a public CDN or an object storage URL that MiniMax can reach.',
    };
  }
  if (/^file:\/\//i.test(raw)) {
    return {
      ok: false,
      error: 'file:// URLs are not allowed for first_frame_image.',
      hint: 'Upload the image via the UI so it is encoded as a Data URL, or paste a public https URL.',
    };
  }
  return {
    ok: false,
    error: 'first_frame_image must be a public https:// URL or a data:image/jpeg|png|webp;base64,... Data URL.',
    hint: 'Local file paths, http:// URLs, and unsupported MIME types are rejected.',
  };
}

function validateImageInputDetailed(value) {
  return validateImageInput(value);
}

function validateImageToVideoInput(payload) {
  const prompt = asTrimmedString(payload?.prompt);
  if (!prompt) {
    return { ok: false, error: 'Prompt is required.' };
  }
  if (prompt.length > I2V.max_prompt_length) {
    return {
      ok: false,
      error: `Prompt must be no more than ${I2V.max_prompt_length} characters.`,
    };
  }
  const imageCheck = validateImageInputDetailed(payload?.first_frame_image);
  if (!imageCheck.ok) {
    return imageCheck;
  }
  const model = payload?.model;
  if (!isValidI2VModel(model)) {
    return {
      ok: false,
      error: `Model ${model} is not part of the image-to-video matrix.`,
      hint: `Allowed image-to-video models: ${Object.keys(I2V.compatibility).join(' / ')}.`,
    };
  }
  const normalizedDuration = Number(payload?.duration);
  if (!Number.isInteger(normalizedDuration) || normalizedDuration <= 0) {
    return { ok: false, error: 'Duration must be a positive integer.' };
  }
  const allowed = supportedI2VResolutions(model, normalizedDuration);
  if (allowed.length === 0) {
    return {
      ok: false,
      error: `${model} does not support duration ${normalizedDuration}s in image-to-video.`,
      hint: i2vCombinationHint(model),
    };
  }
  const resolution = String(payload?.resolution);
  if (!allowed.includes(resolution)) {
    return {
      ok: false,
      error: `${model} does not support ${normalizedDuration}s + ${resolution} in image-to-video.`,
      hint: i2vCombinationHint(model),
    };
  }
  return {
    ok: true,
    normalized: {
      generation_mode: 'image_to_video',
      model,
      duration: normalizedDuration,
      resolution,
      prompt,
      prompt_optimizer: payload?.prompt_optimizer !== false,
      first_frame_image: asTrimmedString(payload?.first_frame_image),
      first_frame_image_kind: imageCheck.kind,
      first_frame_image_mime: imageCheck.mime || null,
      first_frame_image_host: imageCheck.host || null,
      first_frame_image_approx_bytes: imageCheck.approx_bytes || null,
    },
  };
}

function validateTaskInput(payload) {
  const mode = normalizeGenerationMode(payload?.generation_mode);
  if (mode === null) {
    return {
      ok: false,
      error: `Invalid generation_mode. Allowed: ${Array.from(ALLOWED_GENERATION_MODES).join(', ')}.`,
    };
  }
  if (mode === 'image_to_video') {
    return validateImageToVideoInput(payload);
  }
  return validateTextInput(payload);
}

module.exports = {
  ALLOWED_GENERATION_MODES,
  PUBLIC_IMAGE_MIMES,
  PUBLIC_IMAGE_FORMATS,
  PRIVATE_HOST_PATTERNS,
  I2V_IMAGE_CONSTRAINTS: I2V.image_constraints,
  I2V_COMPATIBILITY: I2V.compatibility,
  I2V_DEFAULTS: I2V.defaults,
  T2V_DEFAULTS: T2V.defaults,
  normalizeGenerationMode,
  validateImageInput: validateImageInputDetailed,
  validateTaskInput,
};
