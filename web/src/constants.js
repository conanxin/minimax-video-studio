// Phase Q.2: module-level pure constants extracted from web/src/App.jsx.
// Nothing here depends on React state, props, or browser-only globals
// beyond `window`/`document` references inside async utilities (which
// are kept in utils.js instead). Importing these from App.jsx ensures
// the values are initialized as ES-module lexical bindings before any
// React component renders, which removes a whole class of TDZ hazards
// (an outer const can never be in TDZ by the time any component code
// runs — module evaluation finishes before the first render).

export const FALLBACK_POLLING_CONFIG = {
  initialIntervalMs: 10_000,
  maxIntervalMs: 30_000,
  maxAttempts: 60,
  maxDurationMinutes: 20,
  backoffFactor: 1.5,
  jitterMs: 1500,
};

export const FALLBACK_MODEL_CONFIG = {
  defaults: {
    model: 'MiniMax-Hailuo-2.3',
    duration: 6,
    resolution: '768P',
    prompt_optimizer: true,
  },
  max_prompt_length: 2000,
  camera_moves: ['固定', '推进', '拉远', '左摇', '右摇', '上升', '下降', '跟随'],
  compatibility: {
    'MiniMax-Hailuo-2.3': {
      '6': ['768P', '1080P'],
      '10': ['768P'],
    },
    'MiniMax-Hailuo-02': {
      '6': ['768P', '1080P'],
      '10': ['768P'],
    },
    'T2V-01-Director': {
      '6': ['720P'],
    },
    'T2V-01': {
      '6': ['720P'],
    },
  },
};

// Frontend I2V fallback. The authoritative copy lives at
// /api/video/i2v/models; this constant is only used when the network
// call fails so the UI still knows the basic constraints.
export const FALLBACK_I2V_CONFIG = {
  defaults: {
    model: 'MiniMax-Hailuo-2.3',
    duration: 6,
    resolution: '768P',
    prompt_optimizer: true,
  },
  max_prompt_length: 2000,
  image_constraints: {
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    max_bytes: 20971520,
    min_short_side_px: 300,
    aspect_ratio_min: 0.4,
    aspect_ratio_max: 2.5,
    input_types: ['public_url', 'data_url'],
  },
  compatibility: {
    'MiniMax-Hailuo-2.3': { '6': ['768P', '1080P'], '10': ['768P'] },
    'MiniMax-Hailuo-2.3-Fast': { '6': ['768P', '1080P'], '10': ['768P'] },
    'MiniMax-Hailuo-02': { '6': ['512P', '768P', '1080P'], '10': ['512P', '768P'] },
    'I2V-01-Director': { '6': ['720P'] },
    'I2V-01-live': { '6': ['720P'] },
    'I2V-01': { '6': ['720P'] },
  },
};

export const GENERATION_MODE_OPTIONS = [
  { value: 'text_to_video', label: '文生视频' },
  { value: 'image_to_video', label: '图生视频' },
];

export const GENERATION_MODE_LABEL = {
  text_to_video: '文生视频',
  image_to_video: '图生视频',
};

export const I2V_FORMAT_LABELS = {
  'image/jpeg': 'JPG/JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

export const STATUS_TEXT = {
  Preparing: '准备中',
  Queueing: '排队中',
  Processing: '生成中',
  Success: '成功',
  Fail: '失败',
  Unknown: '未知',
};

export const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'Success', label: '成功' },
  { value: 'Fail', label: '失败' },
  { value: 'in_progress', label: '生成中' },
];

export const HISTORY_PAGE_SIZE = 20;

export const DOWNLOAD_URL_STATUS_TEXT = {
  fresh: '下载链接可用',
  aging: '链接较久，建议刷新',
  stale: '链接可能已过期',
  absent: '未获取下载链接',
  unknown: '暂无链接状态',
};

export const DOWNLOAD_URL_STATUS_PILL_TEXT = {
  fresh: 'fresh',
  aging: 'aging',
  stale: 'stale',
  absent: 'absent',
  unknown: 'unknown',
};

export const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier'];

// Default runtime-config used before /api/runtime-config responds.
// Mirrors the server's production defaults when REQUIRE_SITE_PASSCODE
// is true and CLOUDFLARE_ACCESS_EXPECTED is false (a conservative
// "show the passcode input" choice that matches the server fail-closed
// behavior).
export const DEFAULT_RUNTIME_CONFIG = {
  require_site_passcode: true,
  cloudflare_access_expected: false,
  version: '',
};
