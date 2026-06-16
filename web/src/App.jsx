import { useEffect, useMemo, useRef, useState } from 'react';

const FALLBACK_POLLING_CONFIG = {
  initialIntervalMs: 10_000,
  maxIntervalMs: 30_000,
  maxAttempts: 60,
  maxDurationMinutes: 20,
  backoffFactor: 1.5,
  jitterMs: 1500,
};

const FALLBACK_MODEL_CONFIG = {
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

const STATUS_TEXT = {
  Preparing: '准备中',
  Queueing: '排队中',
  Processing: '生成中',
  Success: '成功',
  Fail: '失败',
  Unknown: '未知',
};

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'Success', label: '成功' },
  { value: 'Fail', label: '失败' },
  { value: 'in_progress', label: '生成中' },
];

const HISTORY_PAGE_SIZE = 20;

const DOWNLOAD_URL_STATUS_TEXT = {
  fresh: '下载链接可用',
  aging: '链接较久，建议刷新',
  stale: '链接可能已过期',
  absent: '未获取下载链接',
  unknown: '暂无链接状态',
};

const DOWNLOAD_URL_STATUS_PILL_TEXT = {
  fresh: 'fresh',
  aging: 'aging',
  stale: 'stale',
  absent: 'absent',
  unknown: 'unknown',
};

function formatAgeLabel(hours) {
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

function normalizeStatus(status) {
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
  return map[value] || value[0].toUpperCase() + value.slice(1).toLowerCase();
}

function isTerminalStatus(status) {
  return normalizeStatus(status) === 'Success' || normalizeStatus(status) === 'Fail';
}

function shortId(value) {
  if (!value) return '-';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function shortTaskId(taskId) {
  return shortId(taskId);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(text, token) {
  const regex = new RegExp(escapeRegExp(token), 'gi');
  const matches = String(text).match(regex);
  return matches ? matches.length : 0;
}

function formatReadableTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('en-US');
  } catch {
    return value;
  }
}

function summarizePrompt(value, max = 80) {
  if (!value) return '(empty prompt)';
  const flat = String(value).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function groupLabelForIso(value) {
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

const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier'];

function groupTasksByDate(tasks) {
  const groups = new Map();
  for (const task of tasks || []) {
    const label = groupLabelForIso(task.updated_at || task.created_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(task);
  }
  return GROUP_ORDER.filter((label) => groups.has(label)).map((label) => ({
    label,
    tasks: groups.get(label),
  }));
}

function buildModelList(config) {
  return Object.keys(config.compatibility || {});
}

function getDurations(config, model) {
  const durations = Object.keys(config.compatibility?.[model] || {});
  const sorted = durations.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return sorted.sort((a, b) => a - b);
}

function getResolutionOptions(config, model, duration) {
  return config.compatibility?.[model]?.[String(duration)] || [];
}

function supportHint(config, model, duration) {
  const item = config.compatibility?.[model] || {};
  const parts = Object.entries(item).map(([sec, resolutions]) => `${sec}s: ${resolutions.join(' / ')}`);
  return `${model} supports: ${parts.join('; ')}`;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (min !== undefined && numeric < min) return min;
  if (max !== undefined && numeric > max) return max;
  return numeric;
}

function pickPollingConfig(remote) {
  const fallback = FALLBACK_POLLING_CONFIG;
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

export default function App() {
  const [modelConfig, setModelConfig] = useState(FALLBACK_MODEL_CONFIG);
  const [pollingConfig, setPollingConfig] = useState(FALLBACK_POLLING_CONFIG);
  const [passcode, setPasscode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(FALLBACK_MODEL_CONFIG.defaults.model);
  const [duration, setDuration] = useState(FALLBACK_MODEL_CONFIG.defaults.duration);
  const [resolution, setResolution] = useState(FALLBACK_MODEL_CONFIG.defaults.resolution);
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [refreshingId, setRefreshingId] = useState('');
  const [currentTask, setCurrentTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskPagination, setTaskPagination] = useState({ limit: HISTORY_PAGE_SIZE, offset: 0, total: 0, hasMore: false });
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historySearchInput, setHistorySearchInput] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyNotice, setHistoryNotice] = useState('');
  const [videoError, setVideoError] = useState(false);
  const [pollingState, setPollingState] = useState({ active: false, attempt: 0, exhausted: false });
  const pollingTimer = useRef(null);
  const pollingStartedAt = useRef(null);
  const pollingAttempt = useRef(0);
  const pollingTaskId = useRef(null);

  const models = useMemo(() => buildModelList(modelConfig), [modelConfig]);
  const durations = useMemo(() => getDurations(modelConfig, model), [modelConfig, model]);
  const resolutions = useMemo(() => getResolutionOptions(modelConfig, model, duration), [modelConfig, model, duration]);

  const maxPromptLength = modelConfig.max_prompt_length || FALLBACK_MODEL_CONFIG.max_prompt_length;
  const promptLength = prompt.length;
  const isPromptTooLong = promptLength > maxPromptLength;
  const comboSupported = resolutions.includes(resolution) && durations.includes(duration);
  const comboHint = comboSupported ? '' : supportHint(modelConfig, model, duration);

  useEffect(() => {
    async function loadConfig() {
      try {
        const cfg = await requestJson('/api/video/models', { method: 'GET' }, false);
        setModelConfig(cfg || FALLBACK_MODEL_CONFIG);
      } catch {
        setModelConfig(FALLBACK_MODEL_CONFIG);
      }
    }
    loadConfig();
  }, []);

  useEffect(() => {
    async function loadPolling() {
      try {
        const cfg = await requestJson('/api/polling/config', { method: 'GET' }, false);
        setPollingConfig(pickPollingConfig(cfg));
      } catch {
        setPollingConfig(FALLBACK_POLLING_CONFIG);
      }
    }
    loadPolling();
  }, []);

  useEffect(() => {
    if (!durations.includes(duration)) {
      setDuration(durations[0] || FALLBACK_MODEL_CONFIG.defaults.duration);
    }
  }, [model, durations, duration]);

  useEffect(() => {
    if (!resolutions.includes(resolution)) {
      setResolution(resolutions[0] || FALLBACK_MODEL_CONFIG.defaults.resolution);
    }
  }, [duration, durations, model, resolutions, resolution, modelConfig]);

  useEffect(() => {
    if (!passcode) return;
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passcode, historyStatus, historySearch]);

  useEffect(() => {
    if (!passcode) return;
    if (!currentTask && !selectedTask) return;
    loadTasks({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask, currentTask]);

  useEffect(() => {
    return () => {
      if (pollingTimer.current) {
        clearTimeout(pollingTimer.current);
      }
    };
  }, []);

  function buildQueryString(base, params) {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return `${url.pathname}${url.search}`;
  }

  async function requestJson(path, options = {}, includePasscode = true) {
    const method = options.method || 'GET';
    const isGet = String(method).toUpperCase() === 'GET';
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

    let body = options.body;
    if (includePasscode && !isGet) {
      const payload = body ? JSON.parse(body) : {};
      payload.passcode = passcode;
      body = JSON.stringify(payload);
    }

    const url = isGet
      ? buildQueryString(path, includePasscode ? { passcode } : {})
      : path;

    const response = await fetch(url, {
      method,
      headers,
      body,
      ...options,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Request failed with HTTP ${response.status}`);
    }
    return data;
  }

  function buildApiStatusFilter() {
    if (historyStatus === 'in_progress') {
      return 'Processing';
    }
    if (historyStatus === 'all') return null;
    return historyStatus;
  }

  async function loadTasks({ offset = 0, silent = false } = {}) {
    if (!passcode) return;
    if (!silent) setHistoryLoading(true);
    setHistoryNotice('');
    try {
      const params = new URLSearchParams();
      params.set('passcode', passcode);
      params.set('limit', String(HISTORY_PAGE_SIZE));
      params.set('offset', String(offset));
      const apiStatus = buildApiStatusFilter();
      if (apiStatus) params.set('status', apiStatus);
      if (historySearch) params.set('q', historySearch);

      const response = await fetch(`/api/tasks?${params.toString()}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.error || `Request failed with HTTP ${response.status}`;
        setError(message);
        return;
      }

      const rows = Array.isArray(data?.tasks) ? data.tasks : [];
      const mapped = rows.map((row) => ({
        ...row,
        status: normalizeStatus(row.status),
      }));
      setTasks(mapped);
      setTaskPagination({
        limit: data?.pagination?.limit ?? HISTORY_PAGE_SIZE,
        offset: data?.pagination?.offset ?? offset,
        total: data?.pagination?.total ?? mapped.length,
        hasMore: Boolean(data?.pagination?.hasMore),
      });
      if (!silent) setError('');
    } catch (err) {
      setError(err?.message || 'Failed to load task history.');
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    setHistorySearch(historySearchInput.trim());
  }

  function handleSearchReset() {
    setHistorySearchInput('');
    setHistorySearch('');
  }

  function handlePageChange(nextOffset) {
    if (nextOffset < 0) return;
    loadTasks({ offset: nextOffset });
  }

  async function copyTextToClipboard(text) {
    if (!text) return false;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // fall through to fallback
      }
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function copyPromptToClipboard(task) {
    if (!task?.prompt) return;
    const ok = await copyTextToClipboard(String(task.prompt));
    setInfo(ok ? 'Prompt 已复制到剪贴板。' : '复制失败，请手动复制。');
    setError('');
  }

  async function copyParamsToClipboard(task) {
    if (!task) return;
    const payload = {
      prompt: task.prompt || '',
      model: task.model || FALLBACK_MODEL_CONFIG.defaults.model,
      duration: Number(task.duration) || FALLBACK_MODEL_CONFIG.defaults.duration,
      resolution: task.resolution || FALLBACK_MODEL_CONFIG.defaults.resolution,
      prompt_optimizer: task.prompt_optimizer !== false,
    };
    const ok = await copyTextToClipboard(JSON.stringify(payload, null, 2));
    setInfo(ok ? '任务参数 JSON 已复制到剪贴板。' : '复制失败，请手动复制。');
    setError('');
  }

  function updateCurrentTask(task) {
    setCurrentTask(task);
    if (selectedTask?.task_id === task.task_id) {
      setSelectedTask(task);
    }
    if (isTerminalStatus(task.status)) {
      stopPolling('reached terminal status');
      loadTasks({ silent: true });
    }
  }

  function stopPolling(reason) {
    if (pollingTimer.current) {
      clearTimeout(pollingTimer.current);
      pollingTimer.current = null;
    }
    pollingStartedAt.current = null;
    pollingAttempt.current = 0;
    pollingTaskId.current = null;
    setPollingState({ active: false, attempt: 0, exhausted: false, reason: reason || null });
  }

  function scheduleNextPoll(taskId) {
    if (pollingTaskId.current !== taskId) return;
    const elapsedMs = Date.now() - (pollingStartedAt.current || Date.now());
    const maxMs = pollingConfig.maxDurationMinutes * 60_000;
    if (elapsedMs >= maxMs) {
      setError(
        `Polling reached the configured max duration of ${pollingConfig.maxDurationMinutes} minutes. ` +
          'Please refresh this task from history later.',
      );
      stopPolling('reached max duration');
      return;
    }
    if (pollingAttempt.current >= pollingConfig.maxAttempts) {
      setError(
        `Polling reached the configured max attempts of ${pollingConfig.maxAttempts}. ` +
          'Please refresh this task from history later.',
      );
      stopPolling('reached max attempts');
      return;
    }

    const baseInterval = Math.min(
      pollingConfig.initialIntervalMs * Math.pow(pollingConfig.backoffFactor, pollingAttempt.current - 1),
      pollingConfig.maxIntervalMs,
    );
    const jitter = pollingConfig.jitterMs > 0 ? Math.floor(Math.random() * pollingConfig.jitterMs) : 0;
    const nextDelay = Math.max(1000, Math.round(baseInterval + jitter));

    pollingTimer.current = setTimeout(() => {
      pollTask(taskId);
    }, nextDelay);
  }

  async function pollTask(taskId) {
    if (pollingTaskId.current !== taskId) return;
    try {
      const remoteTask = await requestJson(`/api/video/task/${encodeURIComponent(taskId)}`);
      pollingAttempt.current += 1;
      setPollingState({
        active: true,
        attempt: pollingAttempt.current,
        exhausted: false,
        taskId,
      });
      updateCurrentTask(remoteTask);
      if (!isTerminalStatus(remoteTask.status)) {
        scheduleNextPoll(taskId);
      }
    } catch (err) {
      setError(err.message || 'Failed to query task status. Please retry.');
      stopPolling('query error');
      setLoading(false);
    }
  }

  function startPolling(taskId) {
    stopPolling('restarting');
    pollingTaskId.current = taskId;
    pollingStartedAt.current = Date.now();
    pollingAttempt.current = 0;
    setPollingState({ active: true, attempt: 0, exhausted: false, taskId });
    pollTask(taskId);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setInfo('');

    if (!passcode.trim()) {
      setError('Please enter SITE_PASSCODE before submitting.');
      return;
    }

    if (!prompt.trim()) {
      setError('Prompt is required.');
      return;
    }

    if (isPromptTooLong) {
      setError(`Prompt length must be no more than ${maxPromptLength} characters.`);
      return;
    }

    if (!comboSupported) {
      setError(`Unsupported combo. ${comboHint}`);
      return;
    }

    setLoading(true);
    try {
      const result = await requestJson('/api/video/create', {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          duration,
          resolution,
          prompt_optimizer: promptOptimizer,
        }),
      });

      const safeTask = {
        ...result,
        status: normalizeStatus(result.status || 'Queueing'),
      };
      setMessage(`Task submitted. Task ID: ${shortTaskId(safeTask.task_id)}. Note: a real submission consumes MiniMax quota.`);
      setCurrentTask(safeTask);
      setSelectedTask(safeTask);
      startPolling(safeTask.task_id);
    } catch (err) {
      setError(err.message || 'Submission failed.');
    } finally {
      setLoading(false);
    }
  }

  async function openTask(task) {
    if (!task?.task_id) return;
    setSelectedTask(task);
    setError('');
    setInfo('');
    setVideoError(false);

    if (passcode.trim()) {
      try {
        const detail = await requestJson(`/api/video/task/${encodeURIComponent(task.task_id)}`);
        setSelectedTask({ ...detail, status: normalizeStatus(detail.status) });
        setVideoError(false);
      } catch (err) {
        setError(err.message || 'Failed to load task detail.');
      }
    }
  }

  async function refreshTaskStatus(task) {
    if (!task?.task_id) return;
    setRefreshingId(task.task_id);
    setError('');
    setInfo('');
    try {
      const detail = await requestJson(`/api/video/task/${encodeURIComponent(task.task_id)}`);
      const normalized = { ...detail, status: normalizeStatus(detail.status) };
      setCurrentTask(normalized);
      setSelectedTask(normalized);
      setInfo(`Task ${shortTaskId(task.task_id)} status refreshed.`);
      loadTasks({ silent: true });
    } catch (err) {
      setError(err.message || 'Failed to refresh task status.');
    } finally {
      setRefreshingId('');
    }
  }

  async function refreshDownload(task) {
    if (!task?.file_id) {
      setError('No file_id in this task.');
      return;
    }

    setRefreshingId(task.file_id);
    setError('');
    setInfo('');
    setVideoError(false);
    try {
      const response = await requestJson(
        `/api/video/file/${encodeURIComponent(task.file_id)}/refresh`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const updated = {
        ...task,
        status: normalizeStatus(response.status || task.status),
        file_id: response.file_id,
        download_url: response.download_url,
        download_url_refreshed_at: response.download_url_refreshed_at || response.refreshed_at,
        download_url_status: response.download_url_status,
        download_url_age_hours: response.download_url_age_hours,
        should_refresh_download_url: response.should_refresh_download_url,
        updated_at: response.refreshed_at || task.updated_at,
      };
      setCurrentTask(updated);
      setSelectedTask(updated);
      setInfo(response.message || 'Download link refreshed.');
      loadTasks({ silent: true });
    } catch (err) {
      setError(err.message || 'Failed to refresh download link.');
    } finally {
      setRefreshingId('');
    }
  }

  function copyParamsToForm(task) {
    if (!task) return;
    setModel(task.model || FALLBACK_MODEL_CONFIG.defaults.model);
    setDuration(Number(task.duration) || FALLBACK_MODEL_CONFIG.defaults.duration);
    setResolution(task.resolution || FALLBACK_MODEL_CONFIG.defaults.resolution);
    setPromptOptimizer(task.prompt_optimizer !== false);
    if (typeof task.prompt === 'string') {
      setPrompt(task.prompt);
    }
    setInfo(
      'Parameters copied to the create form. Review and submit manually. ' +
        'A new submission will consume MiniMax quota.',
    );
    setError('');
  }

  function appendCameraMove(move) {
    if (countOccurrences(prompt, move) >= 3) {
      setError(`Camera move "${move}" has already been used 3 times. Please avoid excessive repetition.`);
      return;
    }

    const nextPrompt = prompt.trim() ? `${prompt.trim()} ${move}` : move;
    if (nextPrompt.length > maxPromptLength) {
      setError(`Prompt length must be no more than ${maxPromptLength} characters.`);
      return;
    }
    setPrompt(nextPrompt);
    setError('');
  }

  const showLoadingMessage = loading ? 'Submitting...' : 'Submit task';
  const terminalStatus = selectedTask ? normalizeStatus(selectedTask.status) : null;
  const hasFileId = Boolean(selectedTask?.file_id);
  const hasDownloadUrl = Boolean(selectedTask?.download_url);
  const isRefreshBusy = Boolean(refreshingId);

  return (
    <main className="page">
      <header className="hero">
        <h1>MiniMax Text-to-Video MVP</h1>
        <p>Phase G: download link freshness indicators and link-freshness UX.</p>
      </header>

      <section className="card">
        <h2>Passcode</h2>
        <input
          className="input"
          placeholder="SITE_PASSCODE"
          value={passcode}
          type="password"
          onChange={(e) => setPasscode(e.target.value)}
        />
      </section>

      <form className="card" onSubmit={onSubmit}>
        <h2>Create task</h2>

        <label htmlFor="prompt">Prompt</label>
        <textarea
          id="prompt"
          placeholder="A calm cinematic close-up of windmills at sunset."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <p className="count">{promptLength}/{maxPromptLength} characters</p>
        {isPromptTooLong && <p className="error">Prompt exceeds max length.</p>}

        <div className="camera-tools">
          <p className="camera-label">Camera move</p>
          <div className="camera-buttons">
            {(modelConfig.camera_moves || []).map((move) => {
              const used = countOccurrences(prompt, move);
              const disabled = used >= 3;
              return (
                <button
                  type="button"
                  className="chip"
                  key={move}
                  disabled={disabled}
                  onClick={() => appendCameraMove(move)}
                >
                  [{move}] {disabled ? `(max ${used})` : ''}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid">
          <div>
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="duration">Duration (seconds)</label>
            <select
              id="duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {durations.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="resolution">Resolution</label>
            <select
              id="resolution"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            >
              {resolutions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>

        {!comboSupported && (
          <p className="warning">
            该组合可能不被当前模型支持，请参考 MiniMax 官方文档或改用默认配置。
          </p>
        )}

        <p className="hint">{comboSupported ? supportHint(modelConfig, model, duration) : ''}</p>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={promptOptimizer}
            onChange={(e) => setPromptOptimizer(e.target.checked)}
          />
          <span>Enable prompt_optimizer</span>
        </label>

        <p className="warning">
          Submitting a new task will create a real MiniMax text-to-video job and consume quota.
        </p>

        <button className="button" type="submit" disabled={loading || !comboSupported || isPromptTooLong}>
          {showLoadingMessage}
        </button>
      </form>

      <section className="card">
        <h2>Task status</h2>
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}
        {info && <p className="hint">{info}</p>}

        {!selectedTask && <p>No task selected. Submit one or open from history.</p>}
        {selectedTask && (
          <div className="task-block">
            <p><strong>Task ID:</strong> {shortTaskId(selectedTask.task_id)}</p>
            <p><strong>Model:</strong> {selectedTask.model}</p>
            <p><strong>Duration:</strong> {selectedTask.duration}s</p>
            <p><strong>Resolution:</strong> {selectedTask.resolution}</p>
            <p><strong>Status:</strong> {STATUS_TEXT[normalizeStatus(selectedTask.status)] || normalizeStatus(selectedTask.status)}</p>
            <p><strong>file_id:</strong> {hasFileId ? `present (${shortId(selectedTask.file_id)})` : 'absent'}</p>
            <p><strong>download_url:</strong> {hasDownloadUrl ? 'present' : 'absent'}</p>
            <p><strong>Created:</strong> {formatReadableTime(selectedTask.created_at)}</p>
            <p><strong>Updated:</strong> {formatReadableTime(selectedTask.updated_at)}</p>
            {pollingState.active && (
              <p className="hint">
                Polling in progress (attempt {pollingState.attempt}/{pollingConfig.maxAttempts},
                {' '}max {pollingConfig.maxDurationMinutes} min).
              </p>
            )}
            {pollingState.reason && !pollingState.active && (
              <p className="warning">Polling stopped: {pollingState.reason}.</p>
            )}
            {selectedTask.fail_reason && (
              <p className="error">Fail reason: {selectedTask.fail_reason}</p>
            )}

            {terminalStatus === 'Success' && hasFileId && (
              <div className="freshness-block">
                <p>
                  <strong>下载链接状态:</strong>{' '}
                  <span className={`freshness-pill freshness-${(selectedTask.download_url_status || 'unknown')}`}>
                    {DOWNLOAD_URL_STATUS_PILL_TEXT[selectedTask.download_url_status] || selectedTask.download_url_status || 'unknown'}
                  </span>
                  <span className="freshness-zh">
                    {DOWNLOAD_URL_STATUS_TEXT[selectedTask.download_url_status] || ''}
                  </span>
                </p>
                {selectedTask.download_url && (
                  <p className="hint">
                    {formatAgeLabel(selectedTask.download_url_age_hours)
                      ? `${formatAgeLabel(selectedTask.download_url_age_hours)}。`
                      : ''}
                    {' '}这不是 MiniMax 强制过期时间，仅为软提示。
                  </p>
                )}
                {selectedTask.should_refresh_download_url && (
                  <p className="warning">
                    建议点击下方“{hasDownloadUrl ? '重新获取下载链接' : '获取下载链接'}”以避免使用过期链接。
                  </p>
                )}
              </div>
            )}

            <div className="task-actions">
              <button
                className="button ghost"
                type="button"
                disabled={isRefreshBusy}
                onClick={() => refreshTaskStatus(selectedTask)}
              >
                {isRefreshBusy && refreshingId === selectedTask.task_id
                  ? 'Refreshing status...'
                  : 'Refresh task status'}
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => copyPromptToClipboard(selectedTask)}
              >
                Copy Prompt
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => copyParamsToClipboard(selectedTask)}
              >
                Copy task params
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => copyParamsToForm(selectedTask)}
              >
                Fill form with these params
              </button>
              {terminalStatus === 'Fail' && (
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => copyParamsToForm(selectedTask)}
                >
                  Copy params to recreate
                </button>
              )}
            </div>
            {terminalStatus === 'Fail' && (
              <p className="warning">
                任务失败。重新提交会消耗 MiniMax 视频额度，请确认参数后再点击 Submit。
              </p>
            )}
          </div>
        )}

        {selectedTask?.status === 'Success' && hasDownloadUrl && (
          <div className="video-area">
            <h3>Generated result</h3>
            <video
              controls
              src={selectedTask.download_url}
              onError={() => setVideoError(true)}
              onLoadedData={() => setVideoError(false)}
            />
            {videoError && (
              <p className="warning">
                如果视频无法播放，请尝试“重新获取下载链接”——可能当前 download_url 已过期。
              </p>
            )}
            <a className="link" href={selectedTask.download_url} target="_blank" rel="noreferrer">
              Download video
            </a>
            <button
              className="button ghost"
              type="button"
              disabled={isRefreshBusy}
              onClick={() => refreshDownload(selectedTask)}
            >
              {isRefreshBusy && refreshingId === selectedTask.file_id
                ? 'Refreshing link...'
                : 'Re-fetch download link'}
            </button>
          </div>
        )}

        {selectedTask?.status === 'Success' && hasFileId && !hasDownloadUrl && (
          <div className="notice">
            <p>已生成，等待获取下载链接。</p>
            <button
              className="button"
              type="button"
              disabled={isRefreshBusy}
              onClick={() => refreshDownload(selectedTask)}
            >
              {isRefreshBusy && refreshingId === selectedTask.file_id
                ? 'Refreshing link...'
                : 'Refresh download link'}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="history-header">
          <h2>Task history</h2>
          <button
            className="button ghost"
            type="button"
            disabled={historyLoading}
            onClick={() => loadTasks({ offset: taskPagination.offset })}
          >
            {historyLoading ? 'Refreshing...' : 'Refresh list'}
          </button>
        </div>

        <div className="history-toolbar">
          <div className="history-status-filter" role="tablist" aria-label="Filter tasks by status">
            {STATUS_FILTER_OPTIONS.map((option) => {
              const active = historyStatus === option.value;
              return (
                <button
                  type="button"
                  key={option.value}
                  className={`chip ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    setHistoryStatus(option.value);
                    setHistoryNotice('');
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <form className="history-search" onSubmit={handleSearchSubmit}>
            <input
              className="input"
              type="search"
              placeholder="搜索 prompt / model / task_id"
              value={historySearchInput}
              onChange={(e) => setHistorySearchInput(e.target.value)}
            />
            <div className="history-search-actions">
              <button className="button ghost" type="submit">搜索</button>
              {(historySearch || historySearchInput) && (
                <button
                  className="button ghost"
                  type="button"
                  onClick={handleSearchReset}
                >
                  清空
                </button>
              )}
            </div>
          </form>
        </div>

        {historyNotice && <p className="hint">{historyNotice}</p>}

        <div className="history-summary">
          {historySearch || historyStatus !== 'all' ? (
            <span>
              当前筛选：{STATUS_FILTER_OPTIONS.find((opt) => opt.value === historyStatus)?.label || '全部'}
              {historySearch ? ` · 关键词 "${historySearch}"` : ''}
            </span>
          ) : (
            <span>显示最近的任务，默认按更新时间倒序。</span>
          )}
          <span>
            共 {taskPagination.total} 条 · 第 {taskPagination.offset + 1}–{Math.min(taskPagination.offset + taskPagination.limit, taskPagination.total)} 条
          </span>
        </div>

        {tasks.length === 0 ? (
          <p className="empty-state">
            {historySearch || historyStatus !== 'all'
              ? '没有匹配的任务，试试清空筛选条件。'
              : '还没有任务。创建一个文生视频任务后会显示在这里。'}
          </p>
        ) : (
          <div className="history-groups">
            {groupTasksByDate(tasks).map((group) => (
              <div className="history-group" key={group.label}>
                <h3 className="history-group-title">{group.label}</h3>
                <ul className="history-list">
                  {group.tasks.map((task) => {
                    const statusClass = String(task.status || '').toLowerCase();
                    const statusLabel = STATUS_TEXT[task.status] || task.status;
                    const fileIdLabel = task.file_id
                      ? `present (${shortId(task.file_id)})`
                      : 'absent';
                    const downloadLabel = task.download_url ? 'present' : 'absent';
                    const freshnessKey = task.download_url_status || 'unknown';
                    const freshnessLabel = DOWNLOAD_URL_STATUS_PILL_TEXT[freshnessKey] || freshnessKey;
                    const isSelected = selectedTask?.task_id === task.task_id;
                    return (
                      <li
                        key={task.task_id}
                        className={`history-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => openTask(task)}
                      >
                        <div className="history-item-main">
                          <p className="history-item-prompt" title={task.prompt || ''}>
                            {summarizePrompt(task.prompt)}
                          </p>
                          <p className="history-item-meta">
                            <span className={`status-pill status-${statusClass}`}>{statusLabel}</span>
                            <span>model: {task.model || '-'}</span>
                            <span>{task.duration || '-'}s · {task.resolution || '-'}</span>
                            <span>file_id: {fileIdLabel}</span>
                            <span>download_url: {downloadLabel}</span>
                            {normalizeStatus(task.status) === 'Success' && task.file_id && (
                              <span className={`freshness-pill freshness-${freshnessKey}`}>
                                link: {freshnessLabel}
                              </span>
                            )}
                          </p>
                          <p className="history-item-time">
                            更新 {formatReadableTime(task.updated_at)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="history-pagination">
          <button
            type="button"
            className="button ghost"
            disabled={historyLoading || taskPagination.offset === 0}
            onClick={() => handlePageChange(Math.max(0, taskPagination.offset - taskPagination.limit))}
          >
            上一页
          </button>
          <span className="pagination-info">
            第 {Math.floor(taskPagination.offset / taskPagination.limit) + 1} 页 · 每页 {taskPagination.limit} 条
          </span>
          <button
            type="button"
            className="button ghost"
            disabled={historyLoading || !taskPagination.hasMore}
            onClick={() => handlePageChange(taskPagination.offset + taskPagination.limit)}
          >
            下一页
          </button>
        </div>
      </section>
    </main>
  );
}
