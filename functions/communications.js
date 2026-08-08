'use strict';
/**
 * Internal Communications API endpoint (server-owned, operator-authenticated).
 *
 * Single dispatcher for the Communications UI. All Supabase and Telnyx
 * credentials stay server-side (env only) — the browser calls THIS function and
 * never sees a service-role or provider key. THIS ENDPOINT HAS NO PUBLIC
 * ACTIONS: every action requires a valid Rosalia operator session (same gate as
 * functions/api.js), and every state-changing action additionally requires the
 * session-bound CSRF token. The Telnyx provider webhooks live in separate
 * handlers (telnyx-inbound.js / telnyx-status.js) and authenticate via Ed25519
 * signature — they are NOT routed through here.
 *
 *   GET  ?action=listConversations&limit=&offset=      (session)
 *   GET  ?action=thread&conversationId=&limit=&offset= (session)
 *   GET  ?action=messageStatus&id=                     (session)
 *   POST {action:'findOrCreate', phone, links?}        (session + CSRF)
 *   POST {action:'addLink', conversationId, type, id}  (session + CSRF)
 *   POST {action:'send', phone?|conversationId?, body, idempotencyKey?, links?} (session + CSRF)
 *   POST {action:'markRead', conversationId}           (session + CSRF)
 *   GET  ?action=listCallsAttention&limit=             (session)
 *   POST {action:'clearCallAttention', id}             (session + CSRF)
 *   GET  ?action=listEmailAttention                    (session)
 *   POST {action:'clearEmailAttention', leadId}        (session + CSRF)
 *
 * Stable JSON error shape: { ok:false, error:{ code, message } }.
 */

const { createCommContext } = require('./_lib/commContext');
const { requireSession, requireCsrf } = require('./_lib/operatorGate');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_BODY = 64 * 1024; // bounded request size; comms payloads are small text
function reply(statusCode, obj) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) }; }
function httpFor(result) {
  if (result.ok) return 200;
  const code = result.error && result.error.code;
  if (code === 'conversation_not_found' || code === 'message_not_found' || code === 'call_not_found' || code === 'lead_not_found') return 404;
  if (code === 'missing_phone' || code === 'invalid_phone' || code === 'unsupported_entity_type' ||
      code === 'missing_entity_id' || code === 'missing_conversation_id' || code === 'missing_message_id' ||
      code === 'missing_call_id' || code === 'missing_lead_id' || code === 'empty_body') return 400;
  if (code === 'opted_out') return 409;
  return 422;
}

// Explicit action allowlist. No default branch ever executes an action.
// method: required HTTP method; mutation: whether CSRF is required.
const ACTIONS = {
  listConversations: { method: 'GET',  mutation: false },
  thread:            { method: 'GET',  mutation: false },
  leadThread:        { method: 'GET',  mutation: false },
  messageStatus:     { method: 'GET',  mutation: false },
  findOrCreate:      { method: 'POST', mutation: true },
  addLink:           { method: 'POST', mutation: true },
  send:              { method: 'POST', mutation: true },
  markRead:          { method: 'POST', mutation: true },
  listCallsAttention:{ method: 'GET',  mutation: false },
  clearCallAttention:{ method: 'POST', mutation: true },
  listEmailAttention:{ method: 'GET',  mutation: false },
  clearEmailAttention:{ method: 'POST', mutation: true },
};

// Factory so tests can inject a fake context (no real Supabase/Telnyx). The
// exported handler uses the real env-wired context.
function makeHandler(deps = {}) {
  const makeContext = deps.makeContext || createCommContext;

  return async (event) => {
    const method = String((event && event.httpMethod) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      return reply(405, { ok: false, error: { code: 'method_not_allowed', message: 'GET or POST only' } });
    }

    const rawBody = (event && event.body) || '';
    if (rawBody.length > MAX_BODY) {
      return reply(413, { ok: false, error: { code: 'payload_too_large', message: 'request body too large' } });
    }

    // --- Operator authentication gate ---
    // Runs BEFORE parsing privileged action parameters, constructing the
    // Communications context, or making any Supabase/Telnyx call.
    const sess = requireSession(event);
    if (!sess.ok) {
      return reply(sess.status, { ok: false, error: {
        code: sess.code,
        message: sess.code === 'unauthenticated' ? 'authentication required' : 'server not configured',
      } });
    }

    // Parse routing/params only after authentication succeeds.
    let body = {};
    if (method === 'POST' && rawBody) {
      try { body = JSON.parse(rawBody); }
      catch (_) { return reply(400, { ok: false, error: { code: 'bad_json', message: 'invalid JSON body' } }); }
    }
    const q = (event && event.queryStringParameters) || {};
    const action = (method === 'GET' ? q.action : body.action) || '';

    const spec = ACTIONS[action];
    if (!spec) return reply(400, { ok: false, error: { code: 'unknown_action', message: `unknown action '${action}'` } });
    if (spec.method !== method) {
      return reply(405, { ok: false, error: { code: 'method_not_allowed', message: `action '${action}' requires ${spec.method}` } });
    }

    // CSRF for state-changing actions (mirrors api.js writes).
    if (spec.mutation && !requireCsrf(event, sess.token)) {
      return reply(403, { ok: false, error: { code: 'csrf_failed', message: 'missing or invalid CSRF token' } });
    }

    // Only now build the privileged context and dispatch.
    let ctx;
    try { ctx = makeContext(); }
    catch (e) { return reply(500, { ok: false, error: { code: 'server_misconfigured', message: 'Communications backend not configured' } }); }
    const api = ctx.commApi;

    try {
      let result;
      switch (action) {
        case 'listConversations': result = await api.listConversations({ limit: q.limit, offset: q.offset }); break;
        case 'thread':            result = await api.getThread({ conversationId: q.conversationId, limit: q.limit, offset: q.offset }); break;
        case 'leadThread':        result = await api.getLeadThread({ leadId: q.leadId, limit: q.limit, offset: q.offset }); break;
        case 'messageStatus':     result = await api.getMessageStatus({ id: q.id }); break;
        case 'findOrCreate':      result = await api.findOrCreateConversation({ phone: body.phone, links: body.links, createdBy: sess.user || 'comm-ui' }); break;
        case 'addLink':           result = await api.addLink({ conversationId: body.conversationId, type: body.type, id: body.id }); break;
        case 'send':              result = await api.sendMessage({ phone: body.phone, conversationId: body.conversationId, body: body.body, idempotencyKey: body.idempotencyKey, links: body.links, createdBy: sess.user || 'comm-ui' }); break;
        case 'markRead':          result = await api.markRead({ conversationId: body.conversationId }); break;
        case 'listCallsAttention': result = await api.listCallsNeedingAttention({ limit: q.limit }); break;
        case 'clearCallAttention': result = await api.clearCallAttention({ id: body.id }); break;
        case 'listEmailAttention': result = await api.listEmailAttention(); break;
        case 'clearEmailAttention': result = await api.clearEmailAttention({ leadId: body.leadId }); break;
      }
      return reply(httpFor(result), result);
    } catch (e) {
      return reply(500, { ok: false, error: { code: 'internal_error', message: 'unexpected error' } });
    }
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
