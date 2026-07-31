// functions/lib/leadProperty.js
//
// Work out which BUILDING a lead is inquiring about, from the raw email.
//
// WHY THIS IS NOT JUST AN ADDRESS REGEX
// Webflow forms include the lead's OWN home address ("Current Address: 906 East
// New York Avenue"). A naive "find a street address in the body" rule attaches
// that to the lead, and it then gets read back to them in a follow-up text —
// "tried reaching you about 906 East New York Avenue", i.e. their own house.
// So a bare address is only accepted if it matches a building we actually
// manage. Explicit fields (Zillow's subject line, a "Building:" field, or
// "more information about X") are trusted directly.
//
// KNOWN_BUILDINGS was derived from the leads whose property was already correct,
// keeping values seen two or more times. Add new buildings here as they come on.

const KNOWN_BUILDINGS = [
  'Iron 65 - 65 McWhorter St Newark',
  '65 McWhorter St',
  'Iron 65',
  'Iron65',
  'Iron Pointe',
  'University Pointe',
  'River Pointe',
  'The Elks',
  '500 Market St',
  '502 Market St',
  '556 Market St',
  '556A Market St',
  '28 Jefferson St',
  '162 University Ave',
  '223 Cator Ave',
  '457 Hawthorne Ave',
  '440 Elizabeth Ave',
  'Elizabeth Ave',
  '473 Main St',
  '487 18th Ave',
  '276 Duncan Ave',
  '289 Halsey St',
  '281 Halsey St',
  '6 Madison St',
  '76 Webster St',
  '77 Christie St',
  '11 Thomas St Newark',
  '11 Thomas St',
];

// Longest first, so "Iron 65 - 65 McWhorter St Newark" wins over "Iron 65".
const RANKED = KNOWN_BUILDINGS.slice().sort((a, b) => b.length - a.length);

const ZILLOW_SUBJECT = /Zillow Group Rentals Contact:\s*([^\n\r]{2,44})/i;
const BUILDING_FIELD = /Building\s*[:\-]\s*([^\n\r]{2,44})/i;
const INTERESTED_IN = /(?:more information about|interested in|inquiry about|tour (?:of|at))\s+([A-Za-z0-9][^.&"\n]{1,42}?)\s*(?:\.|&quot;|"|$)/i;

// Text that looks like a field label or form fragment rather than a building.
const NOT_A_BUILDING = /[:;]|pet\s*(description|type)|\b(name|test|tour request|current address|unknown|n\/a)\b/i;

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tidy(v) {
  if (!v) return null;
  let s = String(v)
    .replace(/&[a-z]+;|&#\w+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,\-\s]+$/, '');
  if (!s || s.length > 44) return null;
  if (NOT_A_BUILDING.test(s)) return null;
  if (!/[A-Za-z]/.test(s)) return null;
  return s;
}

/**
 * @param {string} body    email body (plain text or lightly de-HTMLed)
 * @param {string} subject email subject
 * @returns {string|null}  building name, or null when the email doesn't name one
 */
function extractProperty(body, subject) {
  const b = String(body || '');
  const s = String(subject || '');

  // Tier 1 — explicit fields. These name the inquired property directly, so
  // they're trusted without checking against the known list.
  for (const [re_, hay] of [
    [ZILLOW_SUBJECT, s],
    [ZILLOW_SUBJECT, b],
    [BUILDING_FIELD, b],
    [BUILDING_FIELD, s],
    [INTERESTED_IN, b],
  ]) {
    const m = hay.match(re_);
    const v = m ? tidy(m[1]) : null;
    if (v) return v;
  }

  // Tier 2 — a building we manage, mentioned anywhere. Restricted to the known
  // list precisely so the lead's own address can't be picked up here.
  const hay = norm(b + ' ' + s);
  for (const building of RANKED) {
    const n = norm(building);
    if (n.length >= 6 && hay.includes(n)) return building;
  }

  return null;
}

module.exports = { extractProperty, KNOWN_BUILDINGS };
