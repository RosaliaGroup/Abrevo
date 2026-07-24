/**
 * functions/send-link.js
 *
 * Vapi tool endpoint. Lets an assistant text the caller a booking link
 * mid-conversation ("I'll send that to you right now").
 *
 * Rosalia assistants only. Mechanical is out of scope and untouched.
 *
 * Endpoint:  POST /.netlify/functions/send-link
 * Auth:      x-vapi-secret header must match process.env.VAPI_TOOL_SECRET
 *
 * Env vars:
 *   VAPI_TOOL_SECRET
 *   TELNYX_API_KEY
 *   TELNYX_MESSAGING_PROFILE_ID
 *   TELNYX_FROM_ROSALIA      — +12014269354
 */

const crypto = require('crypto');
const { header } = require('./lib/auth');
const { sendSMS } = require('./lib/sms');

/** Constant-time compare. lib/auth.js keeps its own copy private, so mirror it here. */
function timingEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * One entry per Rosalia assistant context. `key` is what the Vapi tool passes.
 * All send from Rosalia's own registered number.
 */
const CONTEXTS = {
  rosalia: {
    url: 'https://book.rosaliagroup.com/book',
    from: process.env.TELNYX_FROM_ROSALIA,
    team: 'Rosalia Group',
    agent: 'Ana',
    label: 'tour',
  },
  iron65: {
    url: 'https://book.rosaliagroup.com/iron65',
    from: process.env.TELNYX_FROM_ROSALIA,
    team: 'Rosalia Group',
    agent: 'Ana',
    label: 'tour',
  },
  ironpointe: {
    url: 'https://book.rosaliagroup.com/book',
    from: process.env.TELNYX_FROM_ROSALIA,
    team: 'Rosalia Group',
    agent: 'Ana',
    label: 'tour',
  },
};

const DEFAULT_CONTEXT = 'rosalia';

/** Vapi sends tool params flat, or wrapped in message.toolCalls[]. Handle both. */
function parseToolCall(rawBody) {
  let body = {};
  try {
    body = JSON.parse(rawBody || '{}');
  } catch (e) {
    return { args: {}, toolCallId: null };
  }

  const call = body?.message?.toolCalls?.[0] || body?.message?.toolCallList?.[0];
  if (call) {
    let args = call.function?.arguments ?? call.arguments ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch (e) {
        args = {};
      }
    }
    const customer = body?.message?.call?.customer?.number;
    if (customer && !args.phone) args.phone = customer;
    return { args, toolCallId: call.id || null };
  }

  return { args: body, toolCallId: null };
}

/** Vapi reads `results[].result` for custom tools; plain JSON for API Request tools. */
function respond(statusCode, toolCallId, message, extra = {}) {
  const payload = { ...extra, result: message, message };
  if (toolCallId) payload.results = [{ toolCallId, result: message }];
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, null, 'Method not allowed');
  }

  // --- auth: constant-time compare, matching the lib/auth.js convention ---
  const expected = process.env.VAPI_TOOL_SECRET;
  const provided = header(event, 'x-vapi-secret');

  if (!expected || !timingEqualStr(provided, expected)) {
    console.warn('[send-link] rejected: bad or missing x-vapi-secret');
    return respond(401, null, 'Unauthorized');
  }

  const { args, toolCallId } = parseToolCall(event.body);
  const { phone, name, context: ctxKey, property } = args;

  const ctx = CONTEXTS[String(ctxKey || DEFAULT_CONTEXT).toLowerCase()] || CONTEXTS[DEFAULT_CONTEXT];

  if (!ctx.from) {
    console.error(`[send-link] no sender number configured for context "${ctxKey}"`);
    return respond(200, toolCallId, "I couldn't send that text right now, but I can take your details on the call.");
  }
  if (!phone) {
    return respond(200, toolCallId, "I don't have a mobile number to text — could you read it to me?");
  }

  const first = String(name || '').trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first}, ` : 'Hi, ';
  const about = property ? ` about ${property}` : '';
  const body =
    `${greeting}this is ${ctx.agent} from ${ctx.team}. ` +
    `Here's the link to book your ${ctx.label}${about}: ${ctx.url}`;

  const res = await sendSMS(phone, body, { from: ctx.from, optOut: true });

  if (!res.success) {
    console.error('[send-link] send failed:', res.error);
    const msg =
      res.error === 'invalid_phone'
        ? "That number didn't look right — could you read it back to me?"
        : "I had trouble sending that text, but I can email it to you instead.";
    return respond(200, toolCallId, msg, { success: false, error: res.error });
  }

  console.log(`[send-link] sent context=${ctxKey || DEFAULT_CONTEXT} id=${res.id}`);
  return respond(200, toolCallId, 'Sent! You should have that text in a few seconds.', {
    success: true,
    messageId: res.id,
  });
};
