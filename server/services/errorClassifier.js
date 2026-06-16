// Phase H - MiniMax error categorization (pure function).
//
// We do not classify "real" or "fake" here; we only inspect the
// shape of an error envelope and return a stable category, plus a
// user-friendly message and a suggested next action. The output
// is consumed by `toSafeTaskPayload` and rendered by the React
// task detail panel.
//
// Hard rules:
//   - Pure function. No I/O, no side effects, no network.
//   - No new dependencies.
//   - Never echoes a real download_url / task_id / file_id /
//     MINIMAX_API_KEY. Inputs are normalized to short
//     category-tag strings; the user-friendly message is a
//     stable template, not a copy of the raw error text.
//   - The unknown category is the safe fallback. It must never
//     auto-retry, auto-fill, or auto-anything.

const CATEGORIES = {
  QUOTA: 'quota',
  RATE_LIMIT: 'rate_limit',
  INVALID_PARAMS: 'invalid_params',
  AUTH: 'auth',
  SERVER_ERROR: 'server_error',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  IMAGE_UNAVAILABLE: 'image_unavailable',
  IMAGE_TOO_LARGE: 'image_too_large',
  UNSUPPORTED_IMAGE_FORMAT: 'unsupported_image_format',
  INVALID_IMAGE_DIMENSIONS: 'invalid_image_dimensions',
  UNKNOWN: 'unknown',
};

const SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
};

const QUOTA_PATTERNS = [
  /\bquota\b/i,
  /\binsufficient\b/i,
  /\bbalance\b/i,
  /\bcredits?\b/i,
  /token\s*plan/i,
  /额度/,
  /余额/,
];

const RATE_LIMIT_PATTERNS = [
  /\brate[-_ ]?limit\b/i,
  /\btoo many requests\b/i,
  /\b429\b/,
  /\bRPM\b/,
  /限流/,
];

const INVALID_PARAMS_PATTERNS = [
  /\binvalid\b/i,
  /\bunsupported\b/i,
  /\bparameter\b/i,
  /\bprompt too long\b/i,
  /\bprompt[_\s-]?length\b/i,
  /\bprompt_optimizer\b/i,
  /\bunsupported (?:model|combination|duration|resolution)\b/i,
  /不支持/,
  /参数/,
];

const AUTH_PATTERNS = [
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\binvalid api key\b/i,
  /\binvalid apikey\b/i,
  /\b401\b/,
  /\b403\b/,
  /未授权/,
  /鉴权/,
];

const SERVER_ERROR_PATTERNS = [
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /\binternal error\b/i,
  /\bservice unavailable\b/i,
  /\bbad gateway\b/i,
  /服务异常/,
  /服务器错误/,
];

const NETWORK_PATTERNS = [
  /\bECONNRESET\b/,
  /\bETIMEDOUT\b/,
  /\bENOTFOUND\b/,
  /\bEAI_AGAIN\b/,
  /\bfetch failed\b/i,
  /\bnetwork\b/i,
  /网络/,
];

const TIMEOUT_PATTERNS = [
  /\bmax attempts\b/i,
  /\bexceeded max duration\b/i,
  /\bpolling timeout\b/i,
  /\btimed out\b/i,
  /\bpolling reached\b/i,
  /超时/,
];

// Phase I Recovery - image-related error categories. These match
// fail_reason / status_msg / message text from MiniMax I2V failures.
const IMAGE_UNAVAILABLE_PATTERNS = [
  /image\s+url\s+unavailable/i,
  /failed\s+to\s+download\s+image/i,
  /image\s+inaccessible/i,
  /image\s+not\s+found/i,
  /image\s+fetch\s+failed/i,
];

const IMAGE_TOO_LARGE_PATTERNS = [
  /image\s+too\s+large/i,
  /exceeds?\s+20\s*mb/i,
  /file\s+too\s+large/i,
  /payload\s+too\s+large/i,
];

const UNSUPPORTED_IMAGE_FORMAT_PATTERNS = [
  /unsupported\s+image\s+format/i,
  /invalid\s+image\s+type/i,
  /not\s+(?:a\s+)?(?:jpg|jpeg|png|webp)/i,
  /unsupported\s+mime/i,
];

const INVALID_IMAGE_DIMENSIONS_PATTERNS = [
  /image\s+dimension/i,
  /\bshort\s+side\b/i,
  /\baspect\s+ratio\b/i,
  /\btoo\s+small\b/i,
  /invalid\s+ratio/i,
];

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function anyMatch(patterns, text) {
  if (!text) return false;
  for (const p of patterns) {
    if (p.test(text)) return true;
  }
  return false;
}

function defaultFor(category) {
  switch (category) {
    case CATEGORIES.QUOTA:
      return {
        severity: SEVERITY.ERROR,
        user_message: 'MiniMax 报告额度不足。任务没有生成视频。',
        suggested_action: '检查 MiniMax Token Plan 余额或降低规格后重试。',
        can_retry: false,
        retry_hint: '补充额度或换更短时长 / 更低分辨率后手动重新提交；重新提交会消耗额度。',
      };
    case CATEGORIES.RATE_LIMIT:
      return {
        severity: SEVERITY.WARNING,
        user_message: '请求被 MiniMax 限流。',
        suggested_action: '等待几分钟后从任务历史刷新状态或重新提交。',
        can_retry: true,
        retry_hint: '可以稍后再试；本系统不会自动重新提交。',
      };
    case CATEGORIES.INVALID_PARAMS:
      return {
        severity: SEVERITY.WARNING,
        user_message: '参数不被 MiniMax 接受（例如模型 / 时长 / 分辨率 / Prompt 长度）。',
        suggested_action: '点击"用此参数填回表单"并修改模型、时长、分辨率或 Prompt。',
        can_retry: true,
        retry_hint: '修改参数后手动重新提交；重新提交会消耗额度。',
      };
    case CATEGORIES.AUTH:
      return {
        severity: SEVERITY.ERROR,
        user_message: 'API Key 未通过 MiniMax 鉴权。',
        suggested_action: '检查 .env 中的 Token Plan API Key 是否正确且未过期。',
        can_retry: false,
        retry_hint: '修正 API Key 后才能继续；不要向公开报告提交真实 Key。',
      };
    case CATEGORIES.SERVER_ERROR:
      return {
        severity: SEVERITY.WARNING,
        user_message: 'MiniMax 内部错误或服务暂时不可用。',
        suggested_action: '稍后再试，或从任务历史刷新当前状态。',
        can_retry: true,
        retry_hint: '可以稍后再试；本系统不会自动重新提交。',
      };
    case CATEGORIES.NETWORK:
      return {
        severity: SEVERITY.WARNING,
        user_message: '本地到 MiniMax 的网络请求失败。',
        suggested_action: '检查网络连通性，稍后再试。',
        can_retry: true,
        retry_hint: '可以稍后再试；本系统不会自动重新提交。',
      };
    case CATEGORIES.TIMEOUT:
      return {
        severity: SEVERITY.INFO,
        user_message: '轮询已达上限，但任务可能仍在 MiniMax 端继续。',
        suggested_action: '从任务历史中打开此任务，刷新状态查看最新结果。',
        can_retry: true,
        retry_hint: '不要自动重新生成；先刷新状态确认是否已经完成。',
      };
    case CATEGORIES.IMAGE_UNAVAILABLE:
      return {
        severity: SEVERITY.WARNING,
        user_message: 'MiniMax 拉取首帧图片失败：图片不可访问或已失效。',
        suggested_action: '换一张可公网访问的图片（https URL），或重新上传本地图片后再次提交。',
        can_retry: true,
        retry_hint: '重新提交会消耗额度；先确认图片 URL 公开可访问。',
      };
    case CATEGORIES.IMAGE_TOO_LARGE:
      return {
        severity: SEVERITY.WARNING,
        user_message: '首帧图片超过 20MB 限制。',
        suggested_action: '将图片压缩到 20MB 以下后再重新提交。',
        can_retry: true,
        retry_hint: '重新提交会消耗额度；先压缩图片。',
      };
    case CATEGORIES.UNSUPPORTED_IMAGE_FORMAT:
      return {
        severity: SEVERITY.WARNING,
        user_message: '首帧图片格式不被支持。',
        suggested_action: '将图片转换为 JPG / PNG / WebP 之一后再重新提交。',
        can_retry: true,
        retry_hint: '重新提交会消耗额度；先转换格式。',
      };
    case CATEGORIES.INVALID_IMAGE_DIMENSIONS:
      return {
        severity: SEVERITY.WARNING,
        user_message: '首帧图片尺寸或长宽比不符合 MiniMax 要求。',
        suggested_action: '调整图片短边大于 300px、长宽比在 2:5 到 5:2 之间后重新提交。',
        can_retry: true,
        retry_hint: '重新提交会消耗额度；先调整图片尺寸。',
      };
    case CATEGORIES.UNKNOWN:
    default:
      return {
        severity: SEVERITY.WARNING,
        user_message: '无法识别错误原因，请查看 fail_reason 原文。',
        suggested_action: '复制参数到本地后人工排查；如需重新提交请确认会消耗额度。',
        can_retry: false,
        retry_hint: '本系统不会自动重新提交。',
      };
  }
}

function classifyVideoError(input) {
  const env = input || {};
  const statusCode = Number(env.status) || 0;
  const baseStatusCode = Number(env.base_resp?.status_code) || 0;
  const baseStatusMsg = normalizeText(env.base_resp?.status_msg);
  const failReason = normalizeText(env.fail_reason);
  const message = normalizeText(env.message);
  const haystack = [failReason, baseStatusMsg, message, normalizeText(env.raw)]
    .filter(Boolean)
    .join(' | ');

  let category = CATEGORIES.UNKNOWN;

  if (statusCode === 401 || statusCode === 403 || baseStatusCode === 401 || baseStatusCode === 403) {
    category = CATEGORIES.AUTH;
  } else if (statusCode === 429 || baseStatusCode === 429) {
    category = CATEGORIES.RATE_LIMIT;
  } else if (statusCode >= 500 && statusCode < 600) {
    category = CATEGORIES.SERVER_ERROR;
  } else if (anyMatch(QUOTA_PATTERNS, haystack)) {
    category = CATEGORIES.QUOTA;
  } else if (anyMatch(RATE_LIMIT_PATTERNS, haystack)) {
    category = CATEGORIES.RATE_LIMIT;
  } else if (anyMatch(AUTH_PATTERNS, haystack)) {
    category = CATEGORIES.AUTH;
  } else if (anyMatch(IMAGE_UNAVAILABLE_PATTERNS, haystack)) {
    category = CATEGORIES.IMAGE_UNAVAILABLE;
  } else if (anyMatch(IMAGE_TOO_LARGE_PATTERNS, haystack)) {
    category = CATEGORIES.IMAGE_TOO_LARGE;
  } else if (anyMatch(UNSUPPORTED_IMAGE_FORMAT_PATTERNS, haystack)) {
    category = CATEGORIES.UNSUPPORTED_IMAGE_FORMAT;
  } else if (anyMatch(INVALID_IMAGE_DIMENSIONS_PATTERNS, haystack)) {
    category = CATEGORIES.INVALID_IMAGE_DIMENSIONS;
  } else if (anyMatch(INVALID_PARAMS_PATTERNS, haystack)) {
    category = CATEGORIES.INVALID_PARAMS;
  } else if (anyMatch(SERVER_ERROR_PATTERNS, haystack)) {
    category = CATEGORIES.SERVER_ERROR;
  } else if (anyMatch(NETWORK_PATTERNS, haystack)) {
    category = CATEGORIES.NETWORK;
  } else if (anyMatch(TIMEOUT_PATTERNS, haystack)) {
    category = CATEGORIES.TIMEOUT;
  }

  const defaults = defaultFor(category);
  return {
    error_category: category,
    severity: defaults.severity,
    user_message: defaults.user_message,
    suggested_action: defaults.suggested_action,
    can_retry: defaults.can_retry,
    retry_hint: defaults.retry_hint,
  };
}

function classifyFromTask(task) {
  if (!task) {
    return classifyVideoError({});
  }
  return classifyVideoError({
    fail_reason: task.fail_reason,
    message: task.fail_reason,
  });
}

module.exports = {
  CATEGORIES,
  SEVERITY,
  classifyVideoError,
  classifyFromTask,
};
