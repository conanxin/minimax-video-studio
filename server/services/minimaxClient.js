const axios = require('axios');

const BASE_URL = (process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com').replace(/\/+$/, '');

const CREATE_PATH = '/v1/video_generation';
const QUERY_PATH = '/v1/query/video_generation';
const FILE_PATH = '/v1/files/retrieve';

function assertApiKey() {
  if (!process.env.MINIMAX_API_KEY) {
    const err = new Error('MINIMAX_API_KEY is required.');
    err.status = 401;
    throw err;
  }
}

function requestHeaders() {
  assertApiKey();
  return {
    Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

function safeApiError(error) {
  const response = error?.response || null;
  const data = response?.data || {};
  const baseResp = data?.base_resp || {};

  const summary = {
    message: error?.message || 'Unknown MiniMax error',
    status: response?.status || null,
    base_resp: {
      status_code: baseResp.status_code ?? null,
      status_msg: baseResp.status_msg || null,
    },
    raw: {
      request_path: response?.request?.path || null,
      request_status: response?.status || null,
      request_status_text: response?.statusText || null,
      data_snapshot: typeof data === 'object' ? JSON.stringify(data).slice(0, 1200) : String(data),
    },
  };

  const err = new Error(summary.message);
  Object.assign(err, summary);
  err.status = summary.status || 500;
  return err;
}

function extractTaskId(data) {
  return data?.task_id || data?.id || null;
}

function extractStatus(data) {
  return (
    data?.status ||
    data?.result?.status ||
    null
  );
}

function extractFileId(data) {
  return (
    data?.file_id ||
    data?.result?.file_id ||
    null
  );
}

function extractDownloadUrl(data) {
  return (
    data?.file?.download_url ||
    data?.result?.download_url ||
    null
  );
}

function extractFailReason(data) {
  return (
    data?.fail_reason ||
    data?.base_resp?.status_msg ||
    data?.error?.message ||
    data?.message ||
    'Unknown MiniMax error'
  );
}

function checkBusinessError(payload) {
  const statusCode = payload?.base_resp?.status_code;
  if (statusCode === undefined || statusCode === null) return;
  if (statusCode !== 0) {
    const err = new Error(payload?.base_resp?.status_msg || 'MiniMax business error');
    err.status = 400;
    err.base_resp = payload?.base_resp || null;
    err.message = payload?.base_resp?.status_msg || 'MiniMax business error';
    throw err;
  }
}

async function createTextToVideo(payload) {
  try {
    const response = await axios.post(
      `${BASE_URL}${CREATE_PATH}`,
      {
        model: payload.model,
        prompt: payload.prompt,
        duration: Number(payload.duration),
        resolution: payload.resolution,
        prompt_optimizer: Boolean(payload.prompt_optimizer),
      },
      {
        headers: requestHeaders(),
        timeout: 30000,
      }
    );

    const data = response.data || {};
    checkBusinessError(data);

    return {
      task_id: extractTaskId(data),
      status: extractStatus(data) || 'submitted',
      file_id: extractFileId(data),
      download_url: extractDownloadUrl(data),
      fail_reason: null,
      raw: data,
    };
  } catch (error) {
    throw safeApiError(error);
  }
}

async function queryVideoTask(taskId) {
  try {
    const response = await axios.get(`${BASE_URL}${QUERY_PATH}`, {
      headers: requestHeaders(),
      params: { task_id: taskId },
      timeout: 30000,
    });

    const data = response.data || {};
    checkBusinessError(data);

    const status = extractStatus(data);
    const compatibleStatus = mapTaskStatus(status);
    return {
      task_id: extractTaskId(data) || taskId,
      status: compatibleStatus,
      file_id: extractFileId(data),
      download_url: extractDownloadUrl(data),
      fail_reason: extractFailReason(data),
      raw: data,
    };
  } catch (error) {
    throw safeApiError(error);
  }
}

async function retrieveVideoFile(fileId) {
  try {
    const response = await axios.get(`${BASE_URL}${FILE_PATH}`, {
      headers: requestHeaders(),
      params: { file_id: fileId },
      timeout: 30000,
    });

    const data = response.data || {};
    checkBusinessError(data);

    return {
      file_id: extractFileId(data) || fileId,
      download_url: extractDownloadUrl(data),
      raw: data,
    };
  } catch (error) {
    throw safeApiError(error);
  }
}

function mapTaskStatus(status) {
  if (!status) return 'unknown';

  const normalized = String(status).toLowerCase();
  const states = {
    preparing: 'preparing',
    queueing: 'queueing',
    processing: 'processing',
    running: 'processing',
    success: 'success',
    completed: 'success',
    done: 'success',
    fail: 'fail',
    failed: 'fail',
    error: 'fail',
  };

  return states[normalized] || normalized;
}

module.exports = {
  createTextToVideo,
  queryVideoTask,
  retrieveVideoFile,
};
