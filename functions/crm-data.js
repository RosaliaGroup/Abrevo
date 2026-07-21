'use strict';
/**
 * Server-owned CRM data endpoint. Replaces crm.html's direct Supabase access
 * (which shipped the service-role key to the browser). The service-role key
 * stays server-side (env). Raw DB errors/credentials are never returned.
 *
 * Access protection: consistent with the current Abrevo architecture (functions
 * are unauthenticated), this endpoint is open by default BUT supports an
 * optional shared-secret gate: if env CRM_API_TOKEN is set, requests must send
 * header `x-crm-token` matching it. Recommended hardening: set CRM_API_TOKEN
 * and/or enable Netlify site password / Identity on /crm. See the rotation
 * runbook (docs/PHASE2.6-CREDENTIAL-CONTAINMENT.md).
 *
 * Actions:
 *   GET  ?action=leads|agents|deals|commissions|tasks|sequences
 *   GET  ?action=bookings&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET  ?action=activities&lead_id=ID
 *   POST {action:'createLead'|'createDeal'|'createTask'|'createAgent', data:{...}}
 *   POST {action:'completeTask', id}
 *   POST {action:'payCommission', id}
 */

const { createCrmData } = require('./_lib/crmData');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
function reply(statusCode, obj) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) }; }
function httpFor(r) {
  if (r.ok) return 200;
  const c = r.error && r.error.code;
  if (c === 'validation' || c === 'bad_params' || c === 'bad_id') return 400;
  if (c === 'unknown_action') return 400;
  return 502; // read_failed / write_failed — upstream problem, details hidden
}
function header(event, name) { const h = event.headers || {}; return h[name] || h[name.toLowerCase()] || null; }

exports.handler = async (event) => {
  // Optional internal-access gate.
  const required = process.env.CRM_API_TOKEN;
  if (required && header(event, 'x-crm-token') !== required) {
    return reply(401, { ok: false, error: { code: 'unauthorized', message: 'access denied' } });
  }

  let crm;
  try { crm = createCrmData(); }
  catch (e) { return reply(500, { ok: false, error: { code: 'server_misconfigured', message: 'CRM backend not configured' } }); }

  try {
    const method = event.httpMethod || 'GET';
    const q = event.queryStringParameters || {};
    let body = {};
    if (event.body) { try { body = JSON.parse(event.body); } catch (_) { return reply(400, { ok: false, error: { code: 'bad_json', message: 'invalid JSON' } }); } }
    const action = (method === 'GET' ? q.action : body.action) || '';

    let result;
    switch (action) {
      case 'leads': case 'agents': case 'deals': case 'commissions': case 'tasks': case 'sequences':
        result = await crm.list(action); break;
      case 'bookings':    result = await crm.bookings({ from: q.from, to: q.to }); break;
      case 'activities':  result = await crm.activities({ lead_id: q.lead_id }); break;
      case 'createLead':  result = await crm.create('leads', body.data); break;
      case 'createDeal':  result = await crm.create('deals', body.data); break;
      case 'createTask':  result = await crm.create('tasks', body.data); break;
      case 'createAgent': result = await crm.create('agents', body.data); break;
      case 'completeTask':  result = await crm.completeTask({ id: body.id }); break;
      case 'payCommission': result = await crm.payCommission({ id: body.id }); break;
      default: return reply(400, { ok: false, error: { code: 'unknown_action', message: `unknown action '${action}'` } });
    }
    return reply(httpFor(result), result);
  } catch (e) {
    console.error('[crm-data] error:', e && e.message);
    return reply(500, { ok: false, error: { code: 'internal_error', message: 'unexpected error' } });
  }
};
