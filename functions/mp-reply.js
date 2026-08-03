// Reply generator for Facebook Marketplace conversations.
//
// The Marketplace inbox has no API, so the browser extension scrapes the
// open thread and posts it here. This function does the thinking; the
// extension only reads and types. That keeps the Anthropic key server-side
// and keeps one prompt shared with the Page bot.
//
// POST { thread_key, listing_hint, first_name, messages: [{role, content}] }
// →    { reply, intent, auto_send, needs_human }

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  HANDOFF,
  TRADE_INQUIRY,
  getActiveListings,
  generateReply,
  scrubCollected,
} = require('./shared/listing-reply');

const SHARED_SECRET = process.env.MP_RELAY_SECRET;

const sbHeaders = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

async function getThread(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fb_threads?psid=eq.mp:${key}&limit=1`, {
    headers: sbHeaders,
  });
  const rows = await res.json();
  return rows?.[0] || null;
}

async function saveThread(key, fields) {
  await fetch(`${SUPABASE_URL}/rest/v1/fb_threads?on_conflict=psid`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      psid: `mp:${key}`,
      last_message_at: new Date().toISOString(),
      ...fields,
    }),
  });
}

async function notifyAna(message) {
  if (!process.env.TEXTBELT_KEY) return;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '+12014970225',
        message,
        key: process.env.TEXTBELT_KEY,
      }),
    });
  } catch (err) {
    console.error('Ana SMS failed:', err.message);
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Secret',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // The endpoint is public, so require a shared secret the extension holds.
  // Without it, anyone who finds the URL can burn your Anthropic quota.
  if (SHARED_SECRET) {
    const got = event.headers['x-relay-secret'] || event.headers['X-Relay-Secret'];
    if (got !== SHARED_SECRET) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
    }
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { thread_key, listing_hint, first_name, messages = [] } = body;

    if (!thread_key || !messages.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'thread_key and messages required' }),
      };
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const inboundCount = messages.filter((m) => m.role === 'user').length;

    const thread = await getThread(thread_key);

    // Already escalated — stay quiet.
    if (thread?.handoff) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ reply: null, auto_send: false, needs_human: true, reason: 'handoff' }),
      };
    }

    // Escalate and stop.
    if (HANDOFF.test(lastUser)) {
      await saveThread(thread_key, { handoff: true, first_name: first_name || null });
      await notifyAna(
        `Marketplace message needs YOU:\n${first_name || 'Unknown'}\n\n"${lastUser.slice(0, 250)}"\n\nBot has stopped on this thread.`
      );
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          reply: "Let me get Ana on this directly — she'll reach out shortly.",
          auto_send: false,
          needs_human: true,
        }),
      };
    }

    const isTrade = TRADE_INQUIRY.test(lastUser);
    const listings = await getActiveListings();

    const out = await generateReply({
      history: messages,
      listings,
      firstName: first_name,
      collected: thread?.prequal || {},
      channel: 'marketplace',
      listingHint: listing_hint,
    });

    const merged = { ...(thread?.prequal || {}), ...scrubCollected(out.collected) };
    const justFinished = out.prequal_complete && !thread?.prequal_done_at;

    await saveThread(thread_key, {
      first_name: first_name || thread?.first_name || null,
      intent: isTrade ? 'trade' : out.intent && out.intent !== 'unknown' ? out.intent : thread?.intent || null,
      prequal: merged,
      prequal_done_at: justFinished ? new Date().toISOString() : thread?.prequal_done_at || null,
    });

    if (justFinished) {
      const summary = Object.entries(merged)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
        .join('\n');
      await notifyAna(
        `${out.intent === 'buyer' ? 'BUYER' : 'RENTER'} prequalified on Marketplace!\n${first_name || ''}\n${listing_hint || ''}\n\n${summary}`
      );
    }

    if (isTrade && !thread?.intent) {
      await notifyAna(
        `Agent/wholesaler on Marketplace — bot is redirecting them:\n${first_name || 'Unknown'}\n\n"${lastUser.slice(0, 250)}"`
      );
    }

    // Auto-send only the opening reply. First contact on Marketplace is
    // almost always "is this available?", where a fast answer is what wins
    // and a wrong answer costs little. Everything after that is where a
    // bad reply actually does damage, so a human presses Enter.
    const autoSend = inboundCount <= 1 && !out.needs_human && !isTrade;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply: out.reply,
        intent: out.intent,
        auto_send: autoSend,
        needs_human: Boolean(out.needs_human),
      }),
    };
  } catch (err) {
    console.error('mp-reply error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
