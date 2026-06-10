import { useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 10_000;
const MODEL_OPTIONS = [
  'MiniMax-Hailuo-2.3',
  'MiniMax-Hailuo-02',
  'T2V-01-Director',
  'T2V-01',
];
const SAFE_COMBOS = new Set([
  'MiniMax-Hailuo-2.3|6|768P',
]);

function formatReadableTime(value) {
  try {
    return new Date(value).toLocaleString('en-US');
  } catch {
    return value || '-';
  }
}

function isTerminalStatus(status) {
  const value = String(status || '').toLowerCase();
  return value === 'success' || value === 'fail' || value === 'failed';
}

function statusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'success') return 'Success';
  if (s === 'fail' || s === 'failed' || s === 'error') return 'Failed';
  if (s === 'preparing') return 'Preparing';
  if (s === 'queueing') return 'Queueing';
  if (s === 'processing' || s === 'running') return 'Processing';
  if (s === 'submitted' || s === 'pending') return 'Submitted';
  return status || 'Unknown';
}

function getModelCombinationKey(model, duration, resolution) {
  return `${model}|${duration}|${resolution}`;
}

function isKnownSafeCombination(model, duration, resolution) {
  return SAFE_COMBOS.has(getModelCombinationKey(model, duration, resolution));
}

export default function App() {
  const [passcode, setPasscode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('MiniMax-Hailuo-2.3');
  const [duration, setDuration] = useState(6);
  const [resolution, setResolution] = useState('768P');
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [currentTask, setCurrentTask] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const pollingTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (pollingTimer.current) clearInterval(pollingTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!passcode) return;
    loadTasks();
  }, [passcode]);

  function buildQueryString(base, params) {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return `${url.pathname}${url.search}`;
  }

  async function requestJson(path, options = {}) {
    const method = options.method || 'GET';
    const isGet = method.toUpperCase() === 'GET';

    const withPasscode =
      typeof options.body === 'string' || !isGet
        ? {
            ...options,
            body: options.body
              ? JSON.stringify({
                  ...JSON.parse(options.body),
                  passcode,
                })
              : JSON.stringify({ passcode }),
          }
        : options;

    const url = isGet ? buildQueryString(path, { passcode }) : path;

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...withPasscode,
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
      setTasks(rows);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load task history.');
    }
  }

  function updateCurrentTask(task) {
    setCurrentTask(task);
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

    setLoading(true);
    try {
      const result = await requestJson('/api/video/create', {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          duration: Number(duration),
          resolution,
          prompt_optimizer: promptOptimizer,
        }),
      });

      setMessage(`Task submitted. Task ID: ${result.task_id}`);
      setCurrentTask({ task_id: result.task_id, status: result.status || 'submitted' });
      startPolling(result.task_id);
      setPrompt('');
      setLoading(false);
    } catch (err) {
      setError(err.message || 'Submission failed.');
      setLoading(false);
    }
  }

  const comboSupported = isKnownSafeCombination(model, duration, resolution);

  return (
    <main className="page">
      <header className="hero">
        <h1>MiniMax Text-to-Video MVP</h1>
        <p>Phase A + Phase B, text-to-video only.</p>
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

        <div className="grid">
          <div>
            <label htmlFor="model">Model</label>
            <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODEL_OPTIONS.map((option) => (
                <option value={option} key={option}>{option}</option>
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
              <option value={6}>6</option>
              <option value={8}>8</option>
              <option value={10}>10</option>
            </select>
          </div>

          <div>
            <label htmlFor="resolution">Resolution</label>
            <select
              id="resolution"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            >
              <option value="768P">768P</option>
              <option value="1080P">1080P</option>
            </select>
          </div>
        </div>

        {!comboSupported && (
          <p className="warning">
            该组合可能不被当前模型支持，请参考 MiniMax 官方文档或改用默认配置。
          </p>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={promptOptimizer}
            onChange={(e) => setPromptOptimizer(e.target.checked)}
          />
          <span>Enable prompt_optimizer</span>
        </label>

        <button className="button" type="submit" disabled={loading}>
          {loading ? 'Submitting...' : 'Submit task'}
        </button>
      </form>

      <section className="card">
        <h2>Task info</h2>
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}
        {!currentTask && <p>No task yet. Enter prompt and submit to create a task.</p>}
        {currentTask && (
          <div className="task-block">
            <p><strong>Task ID:</strong> {currentTask.task_id}</p>
            <p><strong>Status:</strong> {statusLabel(currentTask.status)}</p>
            {currentTask.file_id && <p><strong>File ID:</strong> {currentTask.file_id}</p>}
            {currentTask.fail_reason && <p className="error">Fail reason: {currentTask.fail_reason}</p>}
          </div>
        )}
        {currentTask?.download_url && (
          <div className="video-area">
            <h3>Generated result</h3>
            <video controls src={currentTask.download_url} />
            <a className="link" href={currentTask.download_url} target="_blank" rel="noreferrer">
              Download video
            </a>
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
              <li key={task.task_id}>
                <div>
                  <strong>{task.task_id}</strong>
                  <p>{formatReadableTime(task.created_at)}</p>
                  <p>{task.prompt}</p>
                </div>
                <span className={`badge ${task.status}`}>{statusLabel(task.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
