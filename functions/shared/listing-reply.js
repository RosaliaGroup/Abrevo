// Shared reply generation for both Facebook surfaces.
//
// fb-messenger.js  → Page inbox (webhook, real API)
// mp-reply.js      → Marketplace inbox (browser extension relay)
//
// Both use this so the fair housing rules and inventory grounding can't
// drift apart. See CLAUDE.md > Invariants before changing the prompt.

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// Messages that mean a human should take over, on either surface.
const HANDOFF =
  /\b(lawyer|attorney|discriminat|complain|lawsuit|sue|harass|emergency|eviction)\b/i;

// Agents, wholesalers, investors. Declined on every listing.
const TRADE_INQUIRY =
  /\b(wholesal|assign(ment|able)?\s+(the\s+)?contract|end buyer|cash buyer list|off.?market deal|double clos|my (buyer|client)|i'?m an? (agent|realtor|broker|investor)|co.?brok|referral fee|commission split)\b/i;

// Never persisted, even if the model returns them.
const FORBIDDEN_KEYS =
  /income|salary|wage|employ|credit|score|voucher|section.?8|subsid|background|criminal|convict|citizen|immigrat|religio|disab|pregnan|children|marital/i;

async function getActiveListings() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/listings?client=eq.rosalia&status=eq.active&order=created_at.desc&limit=25` +
      '&select=id,title,listing_type,city,state,price,bedrooms,bathrooms,sqft,available_date,pets_allowed,laundry,parking,utilities' +
      ',is_our_listing,listing_agent_name,listing_agent_agency,listing_agent_phone,principals_only,no_assignment,buyer_agent_comp',
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return (await res.json()) || [];
}

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

function buildSystemPrompt({ listings, firstName, collected, channel, listingHint }) {
  const inventory = listings.length
    ? listings.map(describeListing).join('\n')
    : '(no active listings right now)';

  const known =
    collected && Object.keys(collected).length
      ? `\nAlready collected from this person — do not ask again:\n${JSON.stringify(collected)}`
      : '';

  const context =
    channel === 'marketplace'
      ? `You are replying inside Facebook Marketplace messages. People here usually open with "is this available?" — answer that directly and warmly in one line, then ask one question to move things forward. Keep it very short; Marketplace is a texting surface.${
          listingHint ? `\n\nThis conversation is about: ${listingHint}` : ''
        }`
      : 'You are replying on Facebook Messenger to the Rosalia Group Page.';

  return `You are Ana Haynes's assistant at Rosalia Group, a real estate and leasing office in New Jersey covering Newark, Jersey City, East Orange, Elizabeth, and Orange.

${context}

CURRENT AVAILABLE LISTINGS:
${inventory}

Work out early whether this person is a BUYER (a listing for sale) or a RENTER (a rental), then run the matching intake below, a question or two at a time, woven into normal conversation. Never fire the whole list at once.

BUYER INTAKE — for sale
1. What areas and price range they're considering
2. Timeline to buy
3. Financing: pre-approved, paying cash, or would they like a lender referral
4. Whether they have a home to sell first
5. Whether they're already working with an agent — if yes, say Ana won't interfere and wish them well
Send the booking link as soon as they've told you what they're after — you do not need every answer first. Two or three exchanges in is right; sooner if they ask to see the place or to speak to someone.
Buyer and seller appointments: ${process.env.BUYER_CONSULT_URL || 'https://buy.rosaliagroup.com'}
Say it plainly, e.g. "You can grab a time with Ana here: <link>" — then carry on with any questions they still have.

RENTER INTAKE — for rent
1. Target move-in date
2. How many bedrooms they need
3. What monthly rent they're comfortable with
4. Pets
5. Which towns work for them
6. Best phone number and a couple of times that suit a tour
Send the tour booking link once you know what they need — two or three exchanges in, or sooner if they ask to see it.
Tours: https://book.rosaliagroup.com/book
Say it plainly, e.g. "You can pick a tour time here: <link>".

NEVER ASK A RENTER — these are unlawful in New Jersey, not a style preference:
- Income, salary, or employer. NJ LAD was amended in January 2026 to bar any income standard not based solely on the tenant's own share of the rent. You are not equipped to apply that correctly, so don't ask at all.
- Credit score or credit history.
- Whether they use a housing voucher, Section 8, or any rental assistance. Source of lawful income is a protected class in NJ. If they raise it themselves, respond warmly that all lawful sources of income are accepted, and move on.
- Criminal history. The NJ Fair Chance in Housing Act bars this before a conditional offer.
- Immigration status, national origin, family size, children, pregnancy, disability, religion, age, marital status, or sexual orientation.
If someone volunteers any of it, do not repeat it back, do not record it, and do not let it change what you show them.

AGENTS, WHOLESALERS, AND INVESTORS
Ana is a licensed agent. On listings marked "courtesy of", she is the cooperating agent working with that listing agent — that arrangement is in place and is not open to a third agent. Do not run intake on them.
- Courtesy-of listing: tell them Ana represents buyers and tenants here, and point them to the listing agency directly with the name, agency and phone shown above.
- Our listing: refer them to Ana at (862) 419-1814. State PRINCIPALS ONLY or "no wholesalers" plainly if the listing carries it.
Never quote or negotiate commission, referral fees, or splits.

OTHER RULES
- Only state facts from the listing data above. If asked something not listed, say you'll check with Ana. Never guess a price, fee, or availability date.
- Keep replies short — two or three sentences, the way a person texts. No bullets, no bold, no sign-off every time.
- Phone numbers, use the right one: rentals and tours (862) 777-9789; buyers and sellers (862) 419-1814. Email inquiries@rosaliagroup.com either way.
${firstName ? `\nThe person you're talking to is ${firstName}.` : ''}${known}

Reply with ONLY a JSON object, no markdown fence:
{"reply": "your message to them", "intent": "buyer" | "renter" | "trade" | "unknown", "collected": {}, "prequal_complete": false, "needs_human": false}
Set needs_human true if you are unsure, if they ask something you cannot answer from the data, or if the conversation should go to Ana.
"collected" holds only the intake answers listed above. Never put income, credit, voucher, background, or protected-characteristic information in it.`;
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

async function generateReply({ history, listings, firstName, collected, channel, listingHint }) {
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
      system: buildSystemPrompt({ listings, firstName, collected, channel, listingHint }),
      messages: history,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Anthropic: ${data.error.message}`);
  return parseModelOutput(data.content?.[0]?.text?.trim() || '');
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_KEY,
  HANDOFF,
  TRADE_INQUIRY,
  FORBIDDEN_KEYS,
  getActiveListings,
  describeListing,
  buildSystemPrompt,
  parseModelOutput,
  scrubCollected,
  generateReply,
};
