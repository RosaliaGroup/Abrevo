'use strict';
/**
 * Shared server-side Telnyx client foundation.
 *
 * - Server-only. No client-side Telnyx calls, ever.
 * - Credentials come ONLY from the environment; nothing is hardcoded:
 *     TELNYX_API_KEY
 *     TELNYX_FROM_NUMBER   (E.164 sender)
 * - `transport` (an fetch-compatible fn) is injectable so tests exercise request
 *   construction and failure handling with NO real network I/O.
 * - This foundation does not perform any production send on its own during
 *   Phase 1; higher layers decide when to call sendSms, and Phase 1 wiring only
 *   ever uses a mock transport.
 */

const TELNYX_MESSAGES_URL = 'https://api.telnyx.com/v2/messages';

function createTelnyxClient(opts = {}) {
  const apiKey = opts.apiKey || process.env.TELNYX_API_KEY || null;
  const fromNumber = opts.fromNumber || process.env.TELNYX_FROM_NUMBER || null;
  const transport = opts.transport || (typeof fetch !== 'undefined' ? fetch : null);

  function isConfigured() {
    return Boolean(apiKey && fromNumber);
  }

  /**
   * Non-sending health/config check. Reports presence of required config
   * WITHOUT exposing any credential value. Sends no SMS and touches no network.
   * @returns {{ ok: boolean, provider: 'telnyx', apiKeyPresent: boolean,
   *             fromNumberPresent: boolean, fromNumberValid: boolean }}
   */
  function configCheck() {
    const apiKeyPresent = Boolean(apiKey);
    const fromNumberPresent = Boolean(fromNumber);
    const fromNumberValid = fromNumberPresent && /^\+[1-9]\d{6,14}$/.test(String(fromNumber));
    return {
      ok: apiKeyPresent && fromNumberValid,
      provider: 'telnyx',
      apiKeyPresent,
      fromNumberPresent,
      fromNumberValid,
    };
  }

  /**
   * Send one SMS via Telnyx. Returns a normalized result; never throws for a
   * provider/network error (caller persists the outcome).
   * @param {{ to: string, text: string }} msg
   */
  async function sendSms({ to, text }) {
    if (!isConfigured()) {
      return { success: false, status: 'unconfigured', providerMessageId: null,
        errorCode: 'telnyx_not_configured',
        errorMessage: 'TELNYX_API_KEY / TELNYX_FROM_NUMBER missing' };
    }
    if (!transport) {
      return { success: false, status: 'no_transport', providerMessageId: null,
        errorCode: 'no_transport', errorMessage: 'no fetch/transport available' };
    }
    const payload = { from: fromNumber, to, text };
    try {
      const res = await transport(TELNYX_MESSAGES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      let json = null;
      if (raw) { try { json = JSON.parse(raw); } catch (_) { json = null; } }

      if (res.status < 200 || res.status >= 300) {
        const errDetail = json && json.errors && json.errors[0];
        return {
          success: false,
          status: 'provider_error',
          providerMessageId: null,
          httpStatus: res.status,
          errorCode: (errDetail && errDetail.code) || `http_${res.status}`,
          errorMessage: (errDetail && errDetail.detail) || raw.slice(0, 200),
        };
      }
      const providerMessageId = json && json.data && json.data.id ? json.data.id : null;
      return { success: true, status: 'sent', providerMessageId, httpStatus: res.status };
    } catch (err) {
      return {
        success: false,
        status: 'network_error',
        providerMessageId: null,
        errorCode: 'network_error',
        errorMessage: (err && err.message) || String(err),
      };
    }
  }

  return { isConfigured, configCheck, sendSms, TELNYX_MESSAGES_URL };
}

module.exports = { createTelnyxClient, TELNYX_MESSAGES_URL };
