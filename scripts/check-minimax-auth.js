#!/usr/bin/env node
/**
 * Phase J.1 - MiniMax auth-only diagnostic script.
 *
 * Goals:
 *   1. Read MINIMAX_API_KEY from .env, never print the raw value.
 *   2. NEVER call /v1/video_generation. NEVER submit any video task.
 *   3. NEVER consume any MiniMax video quota.
 *   4. NEVER set CONFIRM_REAL_VIDEO / CONFIRM_REAL_I2V.
 *   5. Only call the Token Plan usage endpoint:
 *        GET https://www.minimaxi.com/v1/token_plan/remains
 *      with Authorization: Bearer <key>.
 *   6. Print a redacted summary suitable for the public report.
 *
 * Exit code:
 *   0 - script ran to completion (regardless of upstream auth verdict)
 *   1 - configuration problem (key missing / Bearer prefix / etc.)
 *
 * The script NEVER exits with a failure caused by an upstream 1004.
 * 1004 is reported in the summary; that is information, not a script
 * error. Only configuration problems (missing key, accidental Bearer
 * prefix, accidental quotes / whitespace) are script-level failures.
 */

const crypto = require('crypto');
const axios = require('axios');
const { config } = require('dotenv');
const {
  normalizeMiniMaxApiKey,
  buildAuthorizationHeader,
} = require('../server/services/minimaxClient');

config();

const BASE_URL = (process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com').replace(/\/+$/, '');
// Token Plan usage endpoint (read-only). Does NOT submit video tasks
// and does NOT consume any video-generation quota.
const TOKEN_PLAN_PATH = '/v1/token_plan/remains';

function sha8(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function classifyKeyShape(raw) {
  const key = normalizeMiniMaxApiKey(raw);
  const result = {
    raw_present: Boolean(raw && String(raw).length > 0),
    normalized_length: key.length,
    normalized_sha256_short: key ? sha8(key) : null,
    starts_with_bearer_prefix: /^bearer\s+/i.test(key),
    has_surrounding_quotes: Boolean(
      raw && ((String(raw).startsWith('"') && String(raw).endsWith('"')) ||
              (String(raw).startsWith("'") && String(raw).endsWith("'"))),
    ),
    has_internal_whitespace: Boolean(
      raw && /\s/.test(String(raw).replace(/^["']|["']$/g, '')),
    ),
    // Generic prefix detection. We only ever expose the generic
    // "sk-cp" / "eyJ" patterns; never the actual leading 4 chars of
    // the real key value.
    looks_like_subscription_key: /^sk-cp[-_]/i.test(key),
    looks_like_jwt: /^eyJ/i.test(key),
    // A coarse "is this just the README placeholder" check, used
    // only for a warning - never a hard failure. The diagnostic
    // stays neutral if the value does not obviously match.
    looks_like_placeholder_text:
      /replace[_-]?(with[_-]?)?(your[_-]?)?(minimax|minimax|api|token|key|secret)/i.test(
        String(raw || ''),
      ) || /change[_-]?me/i.test(String(raw || '')),
  };
  return result;
}

async function callTokenPlanRemains(authorizationHeader) {
  const url = `${BASE_URL}${TOKEN_PLAN_PATH}`;
  const startedAt = new Date().toISOString();
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: authorizationHeader,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    const data = response.data || {};
    const baseResp = data && data.base_resp ? data.base_resp : {};
    return {
      ok: true,
      network: 'ok',
      http_status: response.status,
      base_resp_status_code:
        baseResp && baseResp.status_code !== undefined ? baseResp.status_code : null,
      base_resp_status_msg:
        baseResp && baseResp.status_msg ? baseResp.status_msg : null,
      body_summary: {
        // Never echo the raw response. Token Plan may include
        // account-level fields we do not want in a public report.
        keys_present: data && typeof data === 'object' ? Object.keys(data) : [],
        has_data_field: Boolean(data && data.data),
        data_keys_present:
          data && data.data && typeof data.data === 'object'
            ? Object.keys(data.data)
            : [],
      },
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      network: err && err.code ? err.code : 'error',
      http_status: null,
      base_resp_status_code: null,
      base_resp_status_msg: null,
      body_summary: null,
      error_message: err && err.message ? err.message : 'unknown error',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  }
}

function deriveAuthVerdict(summary) {
  if (!summary.network_ok) return { auth_ok: 'unknown', reason: 'network' };
  if (summary.http_status === 200 && summary.base_resp_status_code === 0) {
    return { auth_ok: 'yes', reason: 'token_plan_200_and_base_resp_0' };
  }
  if (summary.base_resp_status_code === 1004) {
    return { auth_ok: 'no', reason: 'upstream_login_fail_1004' };
  }
  if (summary.http_status === 401 || summary.http_status === 403) {
    return { auth_ok: 'no', reason: `http_${summary.http_status}` };
  }
  return { auth_ok: 'unknown', reason: 'non_zero_base_resp_or_unusual_status' };
}

async function main() {
  const raw = process.env.MINIMAX_API_KEY;
  const shape = classifyKeyShape(raw);

  // 1. Configuration gate: bare key, no Bearer prefix, no quotes /
  //    whitespace. If any of these trip, abort BEFORE any network
  //    call so we never leak the bad header over the wire in a way
  //    that could be cached anywhere.
  if (!shape.raw_present) {
    const out = {
      phase: 'J.1',
      run_at: new Date().toISOString(),
      api_base: BASE_URL,
      endpoint: TOKEN_PLAN_PATH,
      key_shape: shape,
      configuration_error: 'MINIMAX_API_KEY is missing from .env',
      auth_call_attempted: false,
    };
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
    return;
  }

  if (shape.starts_with_bearer_prefix) {
    const out = {
      phase: 'J.1',
      run_at: new Date().toISOString(),
      api_base: BASE_URL,
      endpoint: TOKEN_PLAN_PATH,
      key_shape: shape,
      configuration_error:
        'MINIMAX_API_KEY in .env already starts with "Bearer ". ' +
        'Store the bare API key in .env, with no "Bearer " prefix.',
      auth_call_attempted: false,
    };
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
    return;
  }

  let authorizationHeader;
  try {
    authorizationHeader = buildAuthorizationHeader(raw);
  } catch (err) {
    const out = {
      phase: 'J.1',
      run_at: new Date().toISOString(),
      api_base: BASE_URL,
      endpoint: TOKEN_PLAN_PATH,
      key_shape: shape,
      configuration_error: err.message,
      auth_call_attempted: false,
    };
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
    return;
  }

  // 2. Auth-only network call. NEVER /v1/video_generation. NEVER
  //    consumes video quota. The Token Plan endpoint is a read-only
  //    usage query.
  const callResult = await callTokenPlanRemains(authorizationHeader);
  const verdict = deriveAuthVerdict({
    network_ok: callResult.ok,
    http_status: callResult.http_status,
    base_resp_status_code: callResult.base_resp_status_code,
  });

  const summary = {
    phase: 'J.1',
    run_at: new Date().toISOString(),
    api_base: BASE_URL,
    endpoint: TOKEN_PLAN_PATH,
    key_shape: shape,
    configuration_error: null,
    auth_call_attempted: true,
    network: callResult.network,
    http_status: callResult.http_status,
    base_resp_status_code: callResult.base_resp_status_code,
    base_resp_status_msg: callResult.base_resp_status_msg,
    body_summary: callResult.body_summary,
    auth_ok: verdict.auth_ok,
    auth_reason: verdict.reason,
    started_at: callResult.started_at,
    finished_at: callResult.finished_at,
    error_message: callResult.error_message || null,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (callResult.base_resp_status_code === 1004) {
    console.log(
      '\nNext step: auth failure (1004). Check Token Plan subscription key ' +
        '/ region / key active status / accidental Bearer prefix in .env.',
    );
  } else if (verdict.auth_ok === 'yes') {
    console.log(
      '\nNote: Token Plan endpoint accepted the key. This does NOT guarantee ' +
        'I2V / video_generation will succeed; it only proves the key reaches ' +
        'the Token Plan usage endpoint without 1004.',
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});