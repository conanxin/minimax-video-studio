import { useEffect, useMemo, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 10_000;

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

function shortTaskId(taskId) {
  if (!taskId) return '-';
  if (taskId.length <= 16) return taskId;
  return `${taskId.slice(0, 8)}...${taskId.slice(-6)}`;
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

export default function App() {
  const [modelConfig, setModelConfig] = useState(FALLBACK_MODEL_CONFIG);
  const [passcode, setPasscode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(FALLBACK_MODEL_CONFIG.defaults.model);
  const [duration, setDuration] = useState(FALLBACK_MODEL_CONFIG.defaults.duration);
  const [resolution, setResolution] = useState(FALLBACK_MODEL_CONFIG.defaults.resolution);
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [currentTask, setCurrentTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [tasks, setTasks] = useState([]);
  const pollingTimer = useRef(null);

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
    if (passcode) {
      loadTasks();
    }
  }, [passcode]);

  useEffect(() => {
    if (!passcode) {
      return;
    }
    loadTasks();
  }, [selectedTask, currentTask]);

  useEffect(() => {
    return () => {
      if (pollingTimer.current) {
        clearInterval(pollingTimer.current);
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

  async function loadTasks() {
    try {
      const rows = await requestJson('/api/tasks');
      const mapped = rows.map((row) => ({
        ...row,
        status: normalizeStatus(row.status),
      }));
      setTasks(mapped);
    } catch (err) {
      setError(err.message || 'Failed to load task history.');
    }
  }

  function updateCurrentTask(task) {
    setCurrentTask(task);
    if (selectedTask?.task_id === task.task_id) {
      setSelectedTask(task);
    }
    if (isTerminalStatus(task.status)) {
      stopPolling();
      loadTasks();
    }
  }

  function stopPolling() {
    if (pollingTimer.current) {
      clearInterval(pollingTimer.current);
      pollingTimer.current = null;
    }
  }

  async function pollTask(taskId) {
    try {
      const remoteTask = await requestJson(`/api/video/task/${encodeURIComponent(taskId)}`);
      updateCurrentTask(remoteTask);
    } catch (err) {
      setError(err.message || 'Failed to query task status. Please retry.');
      stopPolling();
      setLoading(false);
    }
  }

  function startPolling(taskId) {
    stopPolling();
    pollTask(taskId);
    pollingTimer.current = setInterval(() => {
      pollTask(taskId);
    }, POLL_INTERVAL_MS);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');

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
      setMessage(`Task submitted. Task ID: ${shortTaskId(safeTask.task_id)}`);
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

    if (passcode.trim()) {
      try {
        const detail = await requestJson(`/api/video/task/${encodeURIComponent(task.task_id)}`);
        setSelectedTask({ ...detail, status: normalizeStatus(detail.status) });
      } catch (err) {
        setError(err.message || 'Failed to load task detail.');
      }
    }
  }

  async function refreshDownload(task) {
    if (!task?.file_id) {
      setError('No file_id in this task.');
      return;
    }

    try {
      const response = await requestJson(`/api/video/file/${encodeURIComponent(task.file_id)}`);
      const updated = {
        ...task,
        status: normalizeStatus(response.status || task.status),
        file_id: response.file_id,
        download_url: response.download_url,
      };
      setCurrentTask(updated);
      setSelectedTask(updated);
      loadTasks();
    } catch (err) {
      setError(err.message || 'Failed to refresh download link.');
    }
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

  return (
    <main className="page">
      <header className="hero">
        <h1>MiniMax Text-to-Video MVP</h1>
        <p>Phase D: task history alignment and compatibility matrix.</p>
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

        <button className="button" type="submit" disabled={loading || !comboSupported || isPromptTooLong}>
          {showLoadingMessage}
        </button>
      </form>

      <section className="card">
        <h2>Task status</h2>
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}

        {!selectedTask && <p>No task selected. Submit one or open from history.</p>}
        {selectedTask && (
          <div className="task-block">
            <p><strong>Task ID:</strong> {shortTaskId(selectedTask.task_id)}</p>
            <p><strong>Model:</strong> {selectedTask.model}</p>
            <p><strong>Duration:</strong> {selectedTask.duration}s</p>
            <p><strong>Resolution:</strong> {selectedTask.resolution}</p>
            <p><strong>Status:</strong> {STATUS_TEXT[normalizeStatus(selectedTask.status)] || normalizeStatus(selectedTask.status)}</p>
            <p><strong>Has file_id:</strong> {selectedTask.file_id ? 'Yes' : 'No'}</p>
            <p><strong>Has download URL:</strong> {selectedTask.download_url ? 'Yes' : 'No'}</p>
            <p><strong>Created:</strong> {formatReadableTime(selectedTask.created_at)}</p>
            <p><strong>Updated:</strong> {formatReadableTime(selectedTask.updated_at)}</p>
            {selectedTask.fail_reason && (
              <p className="error">Fail reason: {selectedTask.fail_reason}</p>
            )}
          </div>
        )}

        {selectedTask?.status === 'Success' && selectedTask.download_url && (
          <div className="video-area">
            <h3>Generated result</h3>
            <video controls src={selectedTask.download_url} />
            <a className="link" href={selectedTask.download_url} target="_blank" rel="noreferrer">
              Download video
            </a>
          </div>
        )}

        {selectedTask?.status === 'Success' && selectedTask.file_id && !selectedTask.download_url && (
          <div className="notice">
            <p>已生成，等待获取下载链接。</p>
            <button
              className="button ghost"
              type="button"
              onClick={() => refreshDownload(selectedTask)}
            >
              刷新下载链接
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="history-header">
          <h2>Task history</h2>
          <button className="button ghost" type="button" onClick={loadTasks}>Refresh</button>
        </div>

        {tasks.length === 0 ? (
          <p>No local task history yet.</p>
        ) : (
          <ul className="history-list">
            {tasks.map((task) => (
              <li
                key={task.task_id}
                className={`history-item ${selectedTask?.task_id === task.task_id ? 'selected' : ''}`}
                onClick={() => openTask(task)}
              >
                <div>
                  <strong>{shortTaskId(task.task_id)}</strong>
                  <p>{formatReadableTime(task.created_at)}</p>
                  <p>{STATUS_TEXT[task.status] || task.status}</p>
                </div>
                <span className={`badge ${task.status.toLowerCase()}`}>{STATUS_TEXT[task.status] || task.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
