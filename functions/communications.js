'use strict';
/**
 * Internal Communications API endpoint (server-owned).
 *
 * Single dispatcher for the Communications UI. All Supabase and Telnyx
 * credentials stay server-side (env only) — the browser calls THIS function and
 * never sees a service-role or provider key. Actions:
 *
 *   GET  ?action=listConversations&limit=&offset=
 *   GET  ?action=thread&conversationId=&limit=&offset=
 *   GET  ?action=messageStatus&id=
 *   POST {action:'findOrCreate', phone, links?}
 *   POST {action:'addLink', conversationId, type, id}
 *   POST {action:'send', phone?|conversationId?, body, idempotencyKey?, links?}
 *   POST {action:'markRead', conversationId}
 *
 * Stable JSON error shape: { ok:false, error:{ code, message } }.
 */

const { createCommContext } = require('./_lib/commContext');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
function reply(statusCode, obj) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) }; }
function httpFor(result) {
  if (result.ok) return 200;
  const code = result.error && result.error.code;
  if (code === 'conversation_not_found' || code === 'message_not_found') return 404;
  if (code === 'missing_phone' || code === 'invalid_phone' || code === 'unsupported_entity_type' ||
      code === 'missing_entity_id' || code === 'missing_conversation_id' || code === 'missing_message_id' ||
      code === 'empty_body') return 400;
  if (code === 'opted_out') return 409;
  return 422;
}

exports.handler = async (event) => {
  let ctx;
  try { ctx = createCommContext(); }
  catch (e) { return reply(500, { ok: false, error: { code: 'server_misconfigured', message: 'Communications backend not configured' } }); }
  const api = ctx.commApi;

  try {
    const method = event.httpMethod || 'GET';
    const q = event.queryStringParameters || {};
    let body = {};
    if (event.body) { try { body = JSON.parse(event.body); } catch (_) { return reply(400, { ok: false, error: { code: 'bad_json', message: 'invalid JSON body' } }); } }
    const action = (method === 'GET' ? q.action : body.action) || '';

    let result;
    switch (action) {
      case 'listConversations': result = await api.listConversations({ limit: q.limit, offset: q.offset }); break;
      case 'thread':            result = await api.getThread({ conversationId: q.conversationId, limit: q.limit, offset: q.offset }); break;
      case 'messageStatus':     result = await api.getMessageStatus({ id: q.id }); break;
      case 'findOrCreate':      result = await api.findOrCreateConversation({ phone: body.phone, links: body.links, createdBy: 'comm-ui' }); break;
      case 'addLink':           result = await api.addLink({ conversationId: body.conversationId, type: body.type, id: body.id }); break;
      case 'send':              result = await api.sendMessage({ phone: body.phone, conversationId: body.conversationId, body: body.body, idempotencyKey: body.idempotencyKey, links: body.links, createdBy: 'comm-ui' }); break;
      case 'markRead':          result = await api.markRead({ conversationId: body.conversationId }); break;
      default: return reply(400, { ok: false, error: { code: 'unknown_action', message: `unknown action '${action}'` } });
    }
    return reply(httpFor(result), result);
  } catch (e) {
    return reply(500, { ok: false, error: { code: 'internal_error', message: 'unexpected error' } });
  }
};
