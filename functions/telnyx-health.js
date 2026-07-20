'use strict';
/**
 * Telnyx health check — NON-SENDING.
 *
 * Decision (Phase 1, B.5): validate required server-side configuration only.
 * This handler:
 *   - does NOT send an SMS,
 *   - does NOT create or touch a conversation,
 *   - does NOT make any Telnyx network call,
 *   - does NOT expose any credential value (returns booleans only).
 *
 * It reports whether TELNYX_API_KEY is present and TELNYX_FROM_NUMBER is present
 * and well-formed E.164. This replaces the old Textbelt quota check as the
 * provider health signal WHEN healthcheck.js is migrated in Phase 2; the
 * existing Textbelt healthcheck.js is intentionally left unchanged for now.
 *
 * (A live read-only Telnyx account API check was considered and deferred: it is
 * unnecessary for a health signal and would add an external dependency/cost.
 * Config validation is sufficient and side-effect free.)
 */

const { createTelnyxClient } = require('./_lib/telnyx');

exports.handler = async () => {
  const check = createTelnyxClient().configCheck(); // booleans only; no send, no network
  return {
    statusCode: check.ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(check),
  };
};
