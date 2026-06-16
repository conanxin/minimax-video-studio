// Phase G - download_url freshness calculation.
//
// Soft advisory TTL only. We do NOT auto-refresh. The user always has
// to click "Refresh download link" to ask the backend to call
// /v1/files/retrieve again. The state machine is:
//
//   Success + file_id + no download_url        -> absent   / should_refresh=true
//   Success + file_id + url age <= warningTtl -> fresh    / should_refresh=false
//   Success + file_id + url age <= softTtl     -> aging    / should_refresh=true
//   Success + file_id + url age >  softTtl     -> stale    / should_refresh=true
//   any other status                            -> unknown  / should_refresh=false
//
// `download_url_refreshed_at` is preferred; we fall back to
// `updated_at` for legacy rows that were created before Phase G.
const config = require('../../shared/downloadLinkConfig.json');

const STATUSES = {
  ABSENT: 'absent',
  FRESH: 'fresh',
  AGING: 'aging',
  STALE: 'stale',
  UNKNOWN: 'unknown',
};

const TERMINAL_STATUS = 'Success';

function getWarningTtlHours() {
  const value = Number(config.warningTtlHours);
  return Number.isFinite(value) && value > 0 ? value : 12;
}

function getSoftTtlHours() {
  const value = Number(config.softTtlHours);
  return Number.isFinite(value) && value > 0 ? value : 24;
}

function normalizeStatus(rawStatus) {
  const s = String(rawStatus || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower === 'success' || lower === 'completed' || lower === 'done') return TERMINAL_STATUS;
  return lower.charAt(0).toUpperCase() + lower.slice(1).toLowerCase();
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function ageHours(timestamp, now = new Date()) {
  if (!timestamp) return null;
  const diffMs = now.getTime() - timestamp.getTime();
  if (!Number.isFinite(diffMs)) return null;
  return diffMs / (1000 * 60 * 60);
}

function classify(task, now = new Date()) {
  const status = normalizeStatus(task?.status);
  const hasDownloadUrl = Boolean(task?.download_url);
  const hasFileId = Boolean(task?.file_id);

  if (status !== TERMINAL_STATUS) {
    return {
      download_url_present: hasDownloadUrl,
      download_url_status: STATUSES.UNKNOWN,
      download_url_age_hours: null,
      should_refresh_download_url: false,
    };
  }

  if (!hasFileId) {
    return {
      download_url_present: hasDownloadUrl,
      download_url_status: STATUSES.UNKNOWN,
      download_url_age_hours: null,
      should_refresh_download_url: false,
    };
  }

  if (!hasDownloadUrl) {
    return {
      download_url_present: false,
      download_url_status: STATUSES.ABSENT,
      download_url_age_hours: null,
      should_refresh_download_url: true,
    };
  }

  const refreshed = parseTimestamp(task.download_url_refreshed_at)
    || parseTimestamp(task.updated_at);
  const hours = ageHours(refreshed, now);
  if (hours === null) {
    return {
      download_url_present: true,
      download_url_status: STATUSES.UNKNOWN,
      download_url_age_hours: null,
      should_refresh_download_url: true,
    };
  }

  if (hours < getWarningTtlHours()) {
    return {
      download_url_present: true,
      download_url_status: STATUSES.FRESH,
      download_url_age_hours: roundHours(hours),
      should_refresh_download_url: false,
    };
  }
  if (hours < getSoftTtlHours()) {
    return {
      download_url_present: true,
      download_url_status: STATUSES.AGING,
      download_url_age_hours: roundHours(hours),
      should_refresh_download_url: true,
    };
  }
  return {
    download_url_present: true,
    download_url_status: STATUSES.STALE,
    download_url_age_hours: roundHours(hours),
    should_refresh_download_url: true,
  };
}

function roundHours(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function describeStatus(status) {
  switch (status) {
    case STATUSES.FRESH:
      return { label: 'fresh', zh: '下载链接可用' };
    case STATUSES.AGING:
      return { label: 'aging', zh: '链接较久，建议刷新' };
    case STATUSES.STALE:
      return { label: 'stale', zh: '链接可能已过期' };
    case STATUSES.ABSENT:
      return { label: 'absent', zh: '未获取下载链接' };
    case STATUSES.UNKNOWN:
    default:
      return { label: 'unknown', zh: '暂无链接状态' };
  }
}

function formatAgeLabel(hours) {
  if (hours === null || hours === undefined) return null;
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `less than ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (hours < 24) {
    const rounded = Math.round(hours);
    return `${rounded} hour${rounded === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

module.exports = {
  STATUSES,
  classify,
  describeStatus,
  formatAgeLabel,
  getWarningTtlHours,
  getSoftTtlHours,
};
