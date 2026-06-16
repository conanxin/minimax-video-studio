// Phase I Recovery - toSafeTaskPayload is a pure projection that maps
// a raw DB row to a safe public API payload. It hides the full
// first_frame_image (which is never persisted anyway), summarizes
// download_url freshness, and decorates Fail rows with a
// MiniMax error classification.

const { normalizeMiniMaxStatus } = require('./taskStore');
const freshness = require('./downloadLinkFreshness');
const errorClassifier = require('./errorClassifier');

const GENERATION_MODE_LABELS = {
  text_to_video: '文生视频',
  image_to_video: '图生视频',
};

const INPUT_IMAGE_TYPE_LABELS = {
  public_url: '公网 URL',
  data_url: 'Data URL',
  absent: '无',
};

function labelGenerationMode(mode) {
  if (!mode) return GENERATION_MODE_LABELS.text_to_video;
  return GENERATION_MODE_LABELS[mode] || GENERATION_MODE_LABELS.text_to_video;
}

function labelInputImageType(type) {
  if (!type) return INPUT_IMAGE_TYPE_LABELS.absent;
  return INPUT_IMAGE_TYPE_LABELS[type] || type;
}

function summarizeInputImage(task) {
  if (!task || !task.input_image_present) {
    return {
      present: false,
      type: 'absent',
      type_label: INPUT_IMAGE_TYPE_LABELS.absent,
      host: null,
      mime: null,
      approx_bytes: null,
      sha256_short: null,
      summary: null,
    };
  }
  return {
    present: true,
    type: task.input_image_type || 'unknown',
    type_label: labelInputImageType(task.input_image_type),
    host: task.input_image_host || null,
    mime: task.input_image_mime || null,
    approx_bytes: task.input_image_approx_bytes,
    sha256_short: task.input_image_sha256_short || null,
    summary: task.input_image_summary || null,
  };
}

function toSafeTaskPayload(task) {
  if (!task) return null;
  const summary = freshness.classify(task);
  const errorInfo = errorClassifier.classifyFromTask(task);
  return {
    id: task.id,
    task_id: task.task_id,
    prompt: task.prompt,
    model: task.model,
    duration: Number(task.duration),
    resolution: task.resolution,
    prompt_optimizer: Boolean(task.prompt_optimizer),
    status: normalizeMiniMaxStatus(task.status),
    file_id: task.file_id,
    download_url: task.download_url,
    fail_reason: task.fail_reason,
    created_at: task.created_at,
    updated_at: task.updated_at,
    generation_mode: task.generation_mode || 'text_to_video',
    generation_mode_label: labelGenerationMode(task.generation_mode),
    input_image: summarizeInputImage(task),
    input_image_present: Boolean(task.input_image_present),
    input_image_type: task.input_image_present ? (task.input_image_type || 'unknown') : 'absent',
    input_image_type_label: task.input_image_present
      ? labelInputImageType(task.input_image_type)
      : INPUT_IMAGE_TYPE_LABELS.absent,
    input_image_host: task.input_image_present ? (task.input_image_host || null) : null,
    input_image_mime: task.input_image_present ? (task.input_image_mime || null) : null,
    input_image_approx_bytes: task.input_image_present ? task.input_image_approx_bytes : null,
    input_image_sha256_short: task.input_image_present
      ? (task.input_image_sha256_short || null)
      : null,
    input_image_summary: task.input_image_present ? (task.input_image_summary || null) : null,
    download_url_refreshed_at: task.download_url_refreshed_at || null,
    download_url_present: summary.download_url_present,
    download_url_status: summary.download_url_status,
    download_url_age_hours: summary.download_url_age_hours,
    should_refresh_download_url: summary.should_refresh_download_url,
    error_category: errorInfo.error_category,
    error_severity: errorInfo.severity,
    error_user_message: errorInfo.user_message,
    error_suggested_action: errorInfo.suggested_action,
    error_can_retry: errorInfo.can_retry,
    error_retry_hint: errorInfo.retry_hint,
  };
}

module.exports = {
  toSafeTaskPayload,
  summarizeInputImage,
  labelGenerationMode,
  labelInputImageType,
  GENERATION_MODE_LABELS,
  INPUT_IMAGE_TYPE_LABELS,
};
