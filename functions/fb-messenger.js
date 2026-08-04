const crypto = require('crypto');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const APP_SECRET = process.env.FB_APP_SECRET;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const TEXTBELT_KEY = process.env.TEXTBELT_KEY;
const ANA_PHONE = process.env.ROSALIA_ANA_MOBILE || '+12014970225';

// Phrases that mean a human should take over. Cheap, but it catches the
// cases where an automated reply would actually do damage.
const HANDOFF = /\b(lawyer|attorney|discriminat|complain|lawsuit|sue|harass|emergency|eviction)\b/i;

// Wholesalers and agents identify themselves pretty reliably. Catching
// them means Ana hears about it and the bot doesn't run buyer intake on
// someone who was never going to be the buyer.
const TRADE_INQUIRY =
  /\b(wholesal|assign(ment|able)?\s+(the\s+)?contract|end buyer|cash buyer list|off.?market deal|double clos|my (buyer|client)|i'?m an? (agent|realtor|broker|investor)|co.?brok|referral fee|commission split)\b/i;

// ── supabase ──────────────────────────────────────────────────
const sbHeaders = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.status === 204 ? null : res.json();
}

async function getThread(psid) {
  const rows = await sb(`fb_threads?psid=eq.${psid}&limit=1`);
  return rows?.[0] || null;
}

async function upsertThread(psid, fields) {
  await sb('fb_threads?on_conflict=psid', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ psid, last_message_at: new Date().toISOString(), ...fields }),
  });
}

async function getHistory(psid, limit = 20) {
  const rows = await sb(
    `fb_messages?psid=eq.${psid}&order=created_at.desc&limit=${limit}&select=role,content`
  );
  return (rows || []).reverse().map((r) => ({ role: r.role, content: r.content }));
}

async function saveMessage(psid, role, content, mid = null) {
  try {
    await sb('fb_messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ psid, role, content, mid }),
    });
    return true;
  } catch (err) {
    // Unique violation on mid means Meta retried a delivery we already
    // handled. Swallow it — that's the dedupe working.
    if (/duplicate key|23505/.test(err.message)) return false;
    throw err;
  }
}

async function getActiveListings() {
  const rows = await sb(
    'listings?client=eq.rosalia&status=eq.active&order=created_at.desc&limit=25' +
      '&select=id,title,listing_type,city,state,price,bedrooms,bathrooms,sqft,available_date,pets_allowed,laundry,parking,utilities' +
      ',is_our_listing,listing_agent_name,listing_agent_agency,listing_agent_phone,principals_only,no_assignment,buyer_agent_comp'
  );
  return rows || [];
}

async function saveLead(psid, profile, transcript) {
  const existing = await sb(
    `leads?source=eq.facebook&message=ilike.*${psid}*&limit=1`
  ).catch(() => []);
  if (existing?.length) return existing[0];

  const saved = await sb('leads', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null,
      source: 'facebook',
      client: 'rosalia',
      status: 'new',
      message: `Messenger PSID ${psid}`,
      notes: transcript.slice(0, 2000),
      replied_at: new Date().toISOString(),
      follow_up_count: 0,
    }),
  });
  return Array.isArray(saved) ? saved[0] : saved;
}

// ── graph ─────────────────────────────────────────────────────
async function graph(path, body) {
  const res = await fetch(`${GRAPH}/${path}?access_token=${PAGE_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Graph ${data.error.code}: ${data.error.message}`);
  return data;
}

const sendAction = (psid, action) =>
  graph('me/messages', { recipient: { id: psid }, sender_action: action }).catch(() => {});

const sendText = (psid, text) =>
  graph('me/messages', {
    recipient: { id: psid },
    messaging_type: 'RESPONSE',
    message: { text: text.slice(0, 1900) },
  });

async function getProfile(psid) {
  try {
    const res = await fetch(`${GRAPH}/${psid}?fields=first_name,last_name&access_token=${PAGE_TOKEN}`);
    const data = await res.json();
    return data.error ? {} : data;
  } catch {
    return {};
  }
}

// ── sms ───────────────────────────────────────────────────────
async function notifyAna(message) {
  if (!TEXTBELT_KEY) return;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ANA_PHONE, message, key: TEXTBELT_KEY }),
    });
  } catch (err) {
    console.error('Ana SMS failed:', err.message);
  }
}

// ── claude ────────────────────────────────────────────────────
function describeListing(l) {
  const size = [
    l.bedrooms != null ? `${l.bedrooms}bd` : null,
    l.bathrooms != null ? `${l.bathrooms}ba` : null,
    l.sqft ? `${l.sqft}sqft` : null,
  ]
    .filter(Boolean)
    .join('/');
  const extras = [
    l.laundry ? `laundry ${l.laundry}` : null,
    l.parking ? `parking: ${l.parking}` : null,
    l.utilities ? `utilities: ${l.utilities}` : null,
    l.pets_allowed === true ? 'pets ok' : l.pets_allowed === false ? 'no pets' : null,
    l.available_date ? `available ${l.available_date}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const terms = [
    l.is_our_listing
      ? 'OUR LISTING'
      : `courtesy of ${l.listing_agent_name}, ${l.listing_agent_agency}${
          l.listing_agent_phone ? `, ${l.listing_agent_phone}` : ''
        } — Ana is the cooperating agent here`,
    l.principals_only ? 'PRINCIPALS ONLY — no represented buyers' : null,
    l.no_assignment ? 'contract not assignable, no wholesalers' : null,
    l.buyer_agent_comp === 'not_offered' ? "no buyer's agent compensation offered" : null,
  ]
    .filter(Boolean)
    .join('; ');

  return `- ${l.title} (${l.city}, ${l.state}) — $${Number(l.price).toLocaleString('en-US')}${
    l.listing_type === 'rent' ? '/mo' : ''
  }, ${size}${extras ? `. ${extras}` : ''} [${terms}]`;
}

function systemPrompt(listings, firstName, thread) {
  const inventory = listings.length
    ? listings.map(describeListing).join('\n')
    : '(no active listings right now)';

  const collected = thread?.prequal && Object.keys(thread.prequal).length
    ? `\nAlready collected from this person — do not ask again:\n${JSON.stringify(thread.prequal)}`
    : '';

  return `You are Ana Haynes's assistant at Rosalia Group, a real estate and leasing office in New Jersey covering Newark, Jersey City, East Orange, Elizabeth, and Orange. You are replying on Facebook Messenger.

CURRENT AVAILABLE LISTINGS:
${inventory}

Work out early whether this person is a BUYER (interested in a listing for sale) or a RENTER (interested in a rental), then run the matching intake below, a question or two at a time, woven into normal conversation. Never fire the whole list at once.

BUYER INTAKE — for sale
1. What areas and price range they're considering
2. Timeline to buy
3. Financing: pre-approved, paying cash, or would they like a lender referral
4. Whether they have a home to sell first
5. Whether they're already working with an agent — if yes, say Ana won't interfere and wish them well
Once you have those, invite them to book a buyer consultation: ${process.env.BUYER_CONSULT_URL || 'https://abrevo.co/consultation'}

RENTER INTAKE — for rent
1. Target move-in date
2. How many bedrooms they need
3. What monthly rent they're comfortable with
4. Pets
5. Which towns work for them
6. Best phone number and a couple of times that suit a tour
Then confirm Ana will reach out to lock in the tour.

NEVER ASK A RENTER — this is not a style preference, these are unlawful in New Jersey:
- Income, salary, or employer. NJ LAD was amended in January 2026 to bar any income standard not based solely on the tenant's own share of the rent. You are not equipped to apply that correctly, so don't ask at all.
- Credit score or credit history.
- Whether they use a housing voucher, Section 8, or any rental assistance. Source of lawful income is a protected class in NJ. If they raise it themselves, respond warmly that all lawful sources of income are accepted, and move on.
- Criminal history. The NJ Fair Chance in Housing Act bars this before a conditional offer.
- Immigration status, national origin, family size, children, pregnancy, disability, religion, age, marital status, or sexual orientation.
If someone volunteers any of it, do not repeat it back, do not record it, and do not let it change what you show them. Income and credit are handled by a human on a uniform written application, later.

AGENTS, WHOLESALERS, AND INVESTORS
Ana is a licensed agent. On listings marked "courtesy of", she is the cooperating agent working with that listing agent — that arrangement is already in place and is not open to a third agent.

So when another agent, broker, wholesaler, or investor contacts you about a listing, do not run buyer intake and do not treat them as a lead. Be brief and courteous:
- If the listing is "courtesy of" another agency: tell them Ana represents buyers and tenants on this one, and they should contact the listing agency directly. Give them the listing agent's name, agency, and phone from the data above if it's there.
- If it is OUR LISTING: tell them Ana handles agent inquiries directly and give her the sales line, (862) 419-1814. If the listing is marked PRINCIPALS ONLY or "no wholesalers", say so plainly — it's a term of the listing, not a judgment about them.

Set intent to "trade" either way. Never quote or negotiate commission, referral fees, co-broke splits, or compensation — that is Ana's alone, and you should not imply any arrangement is available.

A buyer or renter who already has their own agent is different from an agent contacting you. In that case, wish them well and don't try to take them on.

OTHER RULES
- Only state facts from the listing data above. If asked something not listed, say you'll check with Ana. Never guess a price, fee, or availability date.
- If the listing is another agency's, and they ask, be straight about it: Rosalia Group can show it, but it's listed by another office.
- Keep replies short — two or three sentences, the way a person texts. No bullets, no bold, no sign-off every time.
- Phone numbers, use the right one: rentals and tours (862) 777-9789; buyers and sellers (862) 419-1814. Email inquiries@rosaliagroup.com either way.
${firstName ? `\nThe person you're talking to is ${firstName}.` : ''}${collected}

Reply with ONLY a JSON object, no markdown fence:
{"reply": "your message to them", "intent": "buyer" | "renter" | "trade" | "unknown", "collected": {}, "prequal_complete": false}
"collected" holds only the intake answers listed above that they have given you so far. Never put income, credit, voucher, background, or protected-characteristic information in it, even if they volunteered it.`;
}

function parseModelOutput(raw) {
  const cleaned = (raw || '').replace(/```json|```/g, '').trim();

  // Straight JSON, the happy path.
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.reply) return parsed;
  } catch { /* keep going */ }

  // Models sometimes answer in prose and then append the JSON, or wrap the
  // object in commentary. Pull out the first balanced object rather than
  // trusting the whole string — otherwise the raw JSON ends up pasted into
  // the chat, which is exactly what happened the first time this ran live.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (parsed.reply) return parsed;
    } catch { /* keep going */ }
  }

  // No usable object. Use the prose, minus anything that looks like a
  // stray JSON blob, and flag it for a human.
  const prose = (start !== -1 ? cleaned.slice(0, start) : cleaned).trim();
  return {
    reply: prose || cleaned,
    intent: 'unknown',
    collected: {},
    prequal_complete: false,
    needs_human: true,
  };
}

async function generateReply(history, listings, firstName, thread) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt(listings, firstName, thread),
      messages: history,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Anthropic: ${data.error.message}`);
  return parseModelOutput(data.content?.[0]?.text?.trim() || '');
}

// Belt and braces: even if the model ignores instructions, these never
// reach the database.
const FORBIDDEN_KEYS = /income|salary|wage|employ|credit|score|voucher|section.?8|subsid|background|criminal|convict|citizen|immigrat|religio|disab|pregnan|children|marital/i;

function scrubCollected(collected) {
  if (!collected || typeof collected !== 'object') return {};
  return Object.fromEntries(
    Object.entries(collected).filter(([key]) => {
      if (FORBIDDEN_KEYS.test(key)) {
        console.warn('Dropped disallowed prequal field:', key);
        return false;
      }
      return true;
    })
  );
}

// ── security ──────────────────────────────────────────────────
// Meta signs every delivery. Without this check anyone who finds the URL
// can feed the bot fake messages.
function verifySignature(rawBody, header) {
  if (!APP_SECRET) return false;
  if (!header?.startsWith('sha256=')) return false;

  const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody, 'utf8').digest('hex');
  const got = header.slice(7);

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(got, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── event handling ────────────────────────────────────────────
async function handleMessage(psid, text, mid) {
  const isNew = await saveMessage(psid, 'user', text, mid);
  if (!isNew) {
    console.log('Duplicate delivery, skipping:', mid);
    return;
  }

  let thread = await getThread(psid);

  if (thread?.handoff) {
    console.log('Thread flagged for handoff, staying quiet:', psid);
    await notifyAna(`Facebook message from ${thread.first_name || psid} (you're handling this one):\n\n${text.slice(0, 300)}`);
    return;
  }

  if (HANDOFF.test(text)) {
    await upsertThread(psid, { handoff: true });
    await sendText(psid, "Let me get Ana on this directly — she'll reach out shortly.");
    await saveMessage(psid, 'assistant', 'Handed off to Ana.');
    await notifyAna(`Facebook message needs YOU:\n\n${text.slice(0, 300)}\n\nBot has stopped replying on this thread.`);
    return;
  }

  let profile = { first_name: thread?.first_name, last_name: thread?.last_name };
  if (!thread) {
    profile = await getProfile(psid);
    await upsertThread(psid, { first_name: profile.first_name, last_name: profile.last_name });
    await notifyAna(
      `New Facebook message!\nFrom: ${profile.first_name || 'Unknown'} ${profile.last_name || ''}\n\n"${text.slice(0, 200)}"`
    );
  }

  await sendAction(psid, 'mark_seen');
  await sendAction(psid, 'typing_on');

  // Agents and wholesalers get acknowledged and handed to Ana rather than
  // run through buyer intake. Terms of cooperation are hers to negotiate.
  if (TRADE_INQUIRY.test(text) && !thread?.intent) {
    await upsertThread(psid, { intent: 'trade' });
    await notifyAna(
      `Agent/wholesaler inquiry on Facebook — bot is redirecting them, not qualifying:\n${profile.first_name || ''} ${profile.last_name || ''}\n\n"${text.slice(0, 300)}"`
    );
  }

  const [history, listings] = await Promise.all([getHistory(psid), getActiveListings()]);
  const out = await generateReply(history, listings, profile.first_name, thread);

  if (!out.reply) {
    console.error('Empty reply from model for', psid);
    await sendAction(psid, 'typing_off');
    return;
  }

  await sendText(psid, out.reply);
  await saveMessage(psid, 'assistant', out.reply);

  // Merge what they've told us so far, minus anything we must not hold.
  const merged = { ...(thread?.prequal || {}), ...scrubCollected(out.collected) };
  const justFinished = out.prequal_complete && !thread?.prequal_done_at;

  await upsertThread(psid, {
    intent: out.intent && out.intent !== 'unknown' ? out.intent : thread?.intent || null,
    prequal: merged,
    prequal_done_at: justFinished ? new Date().toISOString() : thread?.prequal_done_at || null,
  });

  if (justFinished) {
    const summary = Object.entries(merged)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n');
    await notifyAna(
      `${out.intent === 'buyer' ? 'BUYER' : 'RENTER'} prequalified on Facebook!\n` +
        `${profile.first_name || ''} ${profile.last_name || ''}\n\n${summary}`
    );
  }

  // Capture the lead once the conversation has actual substance
  if (history.length >= 3) {
    const transcript = history.map((m) => `${m.role}: ${m.content}`).join('\n');
    await saveLead(psid, profile, transcript).catch((err) =>
      console.error('Lead save failed:', err.message)
    );
  }
}

// ── handler ───────────────────────────────────────────────────
exports.handler = async (event) => {
  // Webhook verification handshake
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === VERIFY_TOKEN) {
      return { statusCode: 200, body: q['hub.challenge'] || '' };
    }
    return { statusCode: 403, body: 'Verification failed' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  const signature =
    event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];

  if (!verifySignature(rawBody, signature)) {
    console.error('Bad or missing signature — rejecting');
    return { statusCode: 403, body: 'Invalid signature' };
  }

  // Always 200 fast. Meta retries anything else, and a retry storm on a
  // slow model call turns into duplicate replies.
  try {
    const body = JSON.parse(rawBody);
    if (body.object !== 'page') return { statusCode: 200, body: 'EVENT_RECEIVED' };

    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        const psid = ev.sender?.id;
        if (!psid) continue;

        // Echoes are the Page's own messages coming back, including ones
        // Ana types by hand in the inbox. Ignore them or the bot talks to itself.
        if (ev.message?.is_echo) continue;
        if (!ev.message?.text) continue;

        try {
          await handleMessage(psid, ev.message.text, ev.message.mid);
        } catch (err) {
          console.error('Handler error for', psid, '—', err.message);
          await sendAction(psid, 'typing_off');
        }
      }
    }
  } catch (err) {
    console.error('Webhook parse error:', err.message);
  }

  return { statusCode: 200, body: 'EVENT_RECEIVED' };
};
