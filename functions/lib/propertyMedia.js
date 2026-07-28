// functions/lib/propertyMedia.js
// Property photo/video links + Iron 65 unit-model resolver.
// Single source of truth shared by readmail.js (inquiry replies) and
// book.js (post-booking media text). Moved verbatim from readmail.js.

const PROPERTY_MEDIA = {
  'iron 65': 'https://properties.rosaliagroup.com/properties/iron65.html',
  'mcwhorter': 'https://properties.rosaliagroup.com/properties/iron65.html',
  '39 madison': 'https://properties.rosaliagroup.com/properties/39-madison.html',
  'iron pointe': 'https://properties.rosaliagroup.com/properties/39-madison.html',
  '502 market': 'https://properties.rosaliagroup.com/properties/502-market.html',
  '486 market': 'https://properties.rosaliagroup.com/properties/486-market.html',
  '556 market': 'https://properties.rosaliagroup.com/properties/556-market.html',
  '76 webster': 'https://properties.rosaliagroup.com/properties/74-webster.html',
  '74 webster': 'https://properties.rosaliagroup.com/properties/74-webster.html',
  '11 thomas': 'https://properties.rosaliagroup.com/properties/11-thomas.html',
  '162 university': 'https://properties.rosaliagroup.com/properties/164-university.html',
  '164 university': 'https://properties.rosaliagroup.com/properties/164-university.html',
  '289 halsey': 'https://drive.google.com/drive/folders/1kev7bJ_fghfiTZMKxfPCVd0OHU6GXRqQ',
  '136 s 7th': 'https://properties.rosaliagroup.com/properties/other-listings.html',
  '276 duncan': 'https://drive.google.com/drive/folders/1Of1V_qyNadngRyy2croUqDEXoQIaT7QT',
  '440 elizabeth': 'https://drive.google.com/drive/folders/1Hs2PO3lHQ0S1Pp_9VWO2sWXdFsyQCbv8',
  'the elks': 'https://drive.google.com/drive/folders/1EZHwoZwuZtBMXPe_SuytMVmTC0ujcJB9',
  '180 ferry': 'https://drive.google.com/drive/folders/1C4u8bniEiZlecCxl1dCJLE4fhgYXz0SE',
  '80 freeman': 'https://drive.google.com/drive/folders/1R5lzPHPkbtncNt6XPjTZ7D57J6FYQhXe',
  // Address aliases
  '28 jefferson': 'https://properties.rosaliagroup.com/properties/39-madison.html',
  '6 madison': 'https://properties.rosaliagroup.com/properties/486-market.html',
  '500 market': 'https://properties.rosaliagroup.com/properties/502-market.html',
  '554 market': 'https://properties.rosaliagroup.com/properties/556-market.html',
  '65a mcwhorter': 'https://properties.rosaliagroup.com/properties/iron65.html',
  '65 mcwhorter': 'https://properties.rosaliagroup.com/properties/iron65.html',
  '176 garfield': 'https://properties.rosaliagroup.com/properties/other-listings.html',
  '86 wilson': 'https://properties.rosaliagroup.com/properties/other-listings.html',
  '883 springfield': 'https://properties.rosaliagroup.com/properties/other-listings.html',
  '53 bleeker': 'https://properties.rosaliagroup.com/properties/other-listings.html',
};

function getPropertyMedia(property, message, unitNumber) {
  const raw = ((property || '') + ' ' + (message || '')).toLowerCase();

  // Normalize address aliases
  const text = raw
    .replace(/28\s*jefferson/g, 'iron pointe')
    .replace(/6\s*madison\b/g, '486 market')
    .replace(/500\s*market/g, '502 market')
    .replace(/554\s*market/g, '556 market')
    .replace(/65a?\s*mcwhorter/g, 'iron 65')
    .replace(/65\s*iron\b/g, 'iron 65')
    .replace(/#?var\d*/g, ''); // strip Zillow VAR unit codes

  // Iron 65 — unit-specific or bed-type specific folder
  if (text.includes('iron 65') || text.includes('mcwhorter') || text.includes('iron65')) {
    // Specific unit number takes priority
    if (unitNumber) return getIron65MediaLink(unitNumber);
    // Fall back to bed type
    if (/studio|0\s*bed/i.test(raw)) return 'https://drive.google.com/file/d/1Ufb0l-4L-uNxpzIBKIA2g2upR2YsWMI-/view';
    if (/loft/i.test(raw)) return IRON65_MODELS['loft'];
    if (/duplex/i.test(raw)) return IRON65_MODELS['duplex'];
    if (/2\s*b[re]d|2br|two\s*bed/i.test(raw)) return IRON65_MODELS['02'];
    if (/1\s*b[re]d|1br|one\s*bed/i.test(raw)) return 'https://drive.google.com/file/d/15QalYV80cwWyJ6W8r0DGmmHXV7121yoe/view';
    // No match — AI will ask unit type, don't send videos
    return null;
  }

  // Iron Pointe / 39 Madison — floor plans and 2BR video
  if (/iron.?pointe|39.?madison|28.?jefferson/i.test(text)) {
    if (/floor.?plan|blueprint|layout/i.test(raw)) return 'https://drive.google.com/file/d/1XKjfX9SNN8Gf7yvP_w3VKhGHM79_FlLU/view';
    if (/2\s*b(?:ed|r)|two\s*bed/i.test(raw)) return 'https://drive.google.com/file/d/1WmD2LsDCbjE26LBv-qAxodSpK40NcWqi/view';
    return 'https://properties.rosaliagroup.com/properties/39-madison.html';
  }

  // 502 Market — unit-specific folders
  if (/502\s*market|500\s*market/i.test(raw)) {
    const wants1BR = /1\s*b(?:ed|r)|one\s*bed|1bed/i.test(raw);
    const wants2BR = /2\s*b(?:ed|r)|two\s*bed|2bed/i.test(raw);
    if (wants1BR && !wants2BR) return 'https://drive.google.com/drive/folders/1g0v-wXqjGRPwyd_0ZMW4e9DV-4-bDFS0';
    if (wants2BR && !wants1BR) return 'https://drive.google.com/drive/folders/1Q_dfJG97uFZHCC_4fuGZt0o1M0qZmD_B';
    return 'https://drive.google.com/drive/folders/1g0v-wXqjGRPwyd_0ZMW4e9DV-4-bDFS0';
  }

  for (const [key, url] of Object.entries(PROPERTY_MEDIA)) {
    if (text.includes(key)) return url;
  }
  return null;
}

const IRON65_MODELS = {
  '00': 'https://drive.google.com/drive/folders/1oZe9iypPYM3KMOR3gwXmlyDdqdyT45ov',
  '01': 'https://drive.google.com/drive/folders/1_B_EDL60g6OpUhUYnHVIQxskINyR-cIl',
  '02': 'https://drive.google.com/drive/folders/1XXd-DXtk7HmIkpi4wmCF_RtQx-J3UY_G',
  '03': 'https://drive.google.com/drive/folders/1tmnRsaXEMNTv6Xvbo_7KVIdx_2GEqN6z',
  '04': 'https://drive.google.com/drive/folders/1nEVrGQtQVmv_U4oH6T4q6hAmKw0r9HG1',
  '05': 'https://drive.google.com/drive/folders/12HlkVz4mdBAyLH-vzXt6XhWQg3CHPIxC',
  '06': 'https://drive.google.com/drive/folders/1oSEHRyThSwa5JhKmu_AQqFdf25naUZCn',
  '07': 'https://drive.google.com/drive/folders/1tOzpWgE3wpkb--puXOgcdLuUO87A2DaT',
  '08': 'https://drive.google.com/drive/folders/1BTiTvDKkT_IinFq4pp7DVKE655_yaYFg',
  '09': 'https://drive.google.com/drive/folders/1GlmMtMTecohkKx9rRsAALOX02txl-t1c',
  '10': 'https://drive.google.com/drive/folders/1RQEKUZe7nyuz9cc5M8KiDBVAPUBuz5Oh',
  '11': 'https://drive.google.com/drive/folders/1zFV5-jiAzN34Toq9Y_Sv6jU3ASg8JawO',
  '12': 'https://drive.google.com/drive/folders/14ZKXgjgsy3C4pWAaAJfWDptZmU-xQKGG',
  'loft': 'https://drive.google.com/drive/folders/1VetphM-E2AghDux37UkGXu5vNkNcefh5',
  'duplex': 'https://drive.google.com/drive/folders/1T6y7Bv5HV3jOyjtRLkQm7SFZc9cfskfh',
  'amenities': 'https://drive.google.com/drive/folders/1hhM81AfHpCjph6aBqGzEgW1_O8oac9CY',
};

function getIron65MediaLink(unitNumber) {
  if (!unitNumber) return IRON65_MODELS['amenities'];
  const match = unitNumber.toString().match(/\d*?(\d{2})$/);
  if (match) {
    const model = match[1];
    if (IRON65_MODELS[model]) return IRON65_MODELS[model];
  }
  if (/loft/i.test(unitNumber)) return IRON65_MODELS['loft'];
  if (/duplex/i.test(unitNumber)) return IRON65_MODELS['duplex'];
  return 'https://properties.rosaliagroup.com/properties/iron65.html';
}

// --- Branded photo links ---------------------------------------------------
// Every media destination gets a stable slug, served from
// https://book.rosaliagroup.com/photos/<slug> (see functions/photos.js), so a
// lead never sees a raw Drive URL. Building/model URLs are REFERENCED from the
// maps above (one copy each); only the inline-literal destinations that live
// inside getPropertyMedia are named here (that function stays untouched).
const PHOTOS_BASE = 'https://book.rosaliagroup.com/photos/';

const SLUGS = {
  // Buildings / property pages
  'iron65':          PROPERTY_MEDIA['iron 65'],
  '39-madison':      PROPERTY_MEDIA['39 madison'],
  '502-market':      PROPERTY_MEDIA['502 market'],
  '486-market':      PROPERTY_MEDIA['486 market'],
  '556-market':      PROPERTY_MEDIA['556 market'],
  '74-webster':      PROPERTY_MEDIA['74 webster'],
  '11-thomas':       PROPERTY_MEDIA['11 thomas'],
  '164-university':  PROPERTY_MEDIA['164 university'],
  'other-listings':  PROPERTY_MEDIA['136 s 7th'],
  '289-halsey':      PROPERTY_MEDIA['289 halsey'],
  '276-duncan':      PROPERTY_MEDIA['276 duncan'],
  '440-elizabeth':   PROPERTY_MEDIA['440 elizabeth'],
  'the-elks':        PROPERTY_MEDIA['the elks'],
  '180-ferry':       PROPERTY_MEDIA['180 ferry'],
  '80-freeman':      PROPERTY_MEDIA['80 freeman'],
  // Iron 65 unit models (all 16 folders)
  'iron65-00': IRON65_MODELS['00'],
  'iron65-01': IRON65_MODELS['01'],
  'iron65-02': IRON65_MODELS['02'],
  'iron65-03': IRON65_MODELS['03'],
  'iron65-04': IRON65_MODELS['04'],
  'iron65-05': IRON65_MODELS['05'],
  'iron65-06': IRON65_MODELS['06'],
  'iron65-07': IRON65_MODELS['07'],
  'iron65-08': IRON65_MODELS['08'],
  'iron65-09': IRON65_MODELS['09'],
  'iron65-10': IRON65_MODELS['10'],
  'iron65-11': IRON65_MODELS['11'],
  'iron65-12': IRON65_MODELS['12'],
  'iron65-loft':      IRON65_MODELS['loft'],
  'iron65-duplex':    IRON65_MODELS['duplex'],
  'iron65-amenities': IRON65_MODELS['amenities'],
  // Bed-type / unit-variant destinations that are inline literals inside
  // getPropertyMedia (kept identical to the values in that function).
  'iron65-studio':        'https://drive.google.com/file/d/1Ufb0l-4L-uNxpzIBKIA2g2upR2YsWMI-/view',
  'iron65-1br':           'https://drive.google.com/file/d/15QalYV80cwWyJ6W8r0DGmmHXV7121yoe/view',
  '39-madison-floorplan': 'https://drive.google.com/file/d/1XKjfX9SNN8Gf7yvP_w3VKhGHM79_FlLU/view',
  '39-madison-2br':       'https://drive.google.com/file/d/1WmD2LsDCbjE26LBv-qAxodSpK40NcWqi/view',
  '502-market-1br':       'https://drive.google.com/drive/folders/1g0v-wXqjGRPwyd_0ZMW4e9DV-4-bDFS0',
  '502-market-2br':       'https://drive.google.com/drive/folders/1Q_dfJG97uFZHCC_4fuGZt0o1M0qZmD_B',
};

// Reverse index (URL -> slug), built at load so getBrandedMediaLink can wrap
// getPropertyMedia without a second hand-maintained copy of the URLs.
const URL_TO_SLUG = {};
for (const [slug, url] of Object.entries(SLUGS)) {
  if (url && !(url in URL_TO_SLUG)) URL_TO_SLUG[url] = slug;
}

// slug -> underlying Drive/properties URL, or null for an unknown slug.
function resolveSlug(slug) {
  if (!slug) return null;
  return Object.prototype.hasOwnProperty.call(SLUGS, slug) ? SLUGS[slug] : null;
}

// Same inputs as getPropertyMedia, but returns a branded /photos/<slug> URL,
// or null when getPropertyMedia finds no match.
function getBrandedMediaLink(property, message, unitNumber) {
  const url = getPropertyMedia(property, message, unitNumber);
  if (!url) return null;
  const slug = URL_TO_SLUG[url];
  return slug ? PHOTOS_BASE + slug : null;
}

// --- Booking-form deep links --------------------------------------------
// PROPERTY_SLUGS maps a URL-safe booking slug to the EXACT `value` string in
// booking-rosalia.html's PROPERTIES array. These must match byte-for-byte:
// booking-rosalia.html carries a copy of this map and uses it to pre-select
// the property <select>; any mismatch silently drops the prefill.
const PROPERTY_SLUGS = {
  '486-market':     '486 Market St - River Pointe, Newark NJ',
  '502-market':     '502 Market St, Newark NJ',
  'iron-pointe':    '39 Madison St - Iron Pointe, Newark NJ',
  '556-market':     '556 Market St, Newark NJ',
  '289-halsey':     '289 Halsey St, Newark NJ',
  'ballantine':     '77 Christie St — The Ballantine, Newark NJ',
  '1369-south':     '1369 South Ave, Plainfield NJ',
  'the-elks':       '475 Main St - The Elks, Orange NJ',
  '303-washington': '303 Washington St, Newark NJ',
  'wilson-place':   '82-90 Wilson Place, Orange NJ',
};

const BOOK_BASE = 'https://book.rosaliagroup.com';

// Free-form property text -> booking slug. Keys are guaranteed to exist in
// PROPERTY_SLUGS. Order is not significant (buildings are distinguished by
// their street number / name).
const BOOKING_SLUG_MATCHERS = [
  ['502-market',     /502\s*market/],
  ['486-market',     /486\s*market/],
  // 556-557 Market (range listing) -> 556-market
  ['556-market',     /556(?:[\s-]*557)?\s*market/],
  // 39-40 Madison (range listing) -> Iron Pointe
  ['iron-pointe',    /iron\s*pointe|39(?:[\s-]*40)?\s*madison/],
  ['289-halsey',     /289\s*halsey/],
  ['ballantine',     /ballantine|77\s*christie/],
  ['1369-south',     /1369\s*south/],
  ['the-elks',       /the\s*elks|475\s*main/],
  ['303-washington', /303\s*washington/],
  // 82-90 Wilson Place: any of the individual door numbers -> the one slug.
  ['wilson-place',   /wilson\s*place|\b(?:82|84|86|88|90)[\s-]*wilson/],
];

function matchBookingSlug(text) {
  for (const [slug, re] of BOOKING_SLUG_MATCHERS) {
    if (re.test(text)) return slug;
  }
  return null;
}

// Build a booking-form URL for a lead.
//   Iron 65 / McWhorter -> /iron65
//   known building       -> /book?property=<slug>
//   no match / no prop   -> /book
// Phone (when truthy) is appended as an encoded &phone=/?phone= param; a falsy
// phone is omitted entirely (never "phone=undefined").
function getBookingLink(property, phone) {
  const phoneQ = phone ? 'phone=' + encodeURIComponent(phone) : '';

  // Normalize using the same alias rules as getPropertyMedia.
  const text = (property || '').toLowerCase()
    .replace(/28\s*jefferson/g, 'iron pointe')
    .replace(/6\s*madison\b/g, '486 market')
    .replace(/500\s*market/g, '502 market')
    .replace(/554\s*market/g, '556 market')
    .replace(/65a?\s*mcwhorter/g, 'iron 65')
    .replace(/65\s*iron\b/g, 'iron 65');

  // Iron 65 / McWhorter -> dedicated form.
  if (text.includes('iron 65') || text.includes('mcwhorter') || text.includes('iron65')) {
    return BOOK_BASE + '/iron65' + (phoneQ ? '?' + phoneQ : '');
  }

  // Known building -> property-specific /book link.
  if (property) {
    const slug = matchBookingSlug(text);
    if (slug) {
      return BOOK_BASE + '/book?property=' + slug + (phoneQ ? '&' + phoneQ : '');
    }
  }

  // No property or no match -> generic /book link.
  return BOOK_BASE + '/book' + (phoneQ ? '?' + phoneQ : '');
}

module.exports = {
  getPropertyMedia,
  getIron65MediaLink,
  IRON65_MODELS,
  PROPERTY_MEDIA,
  SLUGS,
  resolveSlug,
  getBrandedMediaLink,
  PROPERTY_SLUGS,
  getBookingLink,
};
