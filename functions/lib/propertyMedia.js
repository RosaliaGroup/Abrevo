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

module.exports = { getPropertyMedia, getIron65MediaLink, IRON65_MODELS, PROPERTY_MEDIA };
