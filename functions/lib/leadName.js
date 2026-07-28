// functions/lib/leadName.js
// Clean a lead "name" that may have swallowed the whole form body. Webflow form
// dumps arrive as a single inline line ("Eddy Encinales Email Address: ...
// Cell Phone: ...") and greedy extractors store the lot in `name`, which then
// breaks Vapi (customer.name must be <= 40 chars).
//
// Strips at the first field-label marker ('Email Address' / 'Cell Phone') or a
// newline, collapses whitespace, and (when maxLen is given) truncates.

function cleanName(raw, maxLen) {
  if (raw == null) return '';
  let s = String(raw).split(/\r\n|\r|\n|Email\s*Address|Cell\s*Phone/i)[0];
  s = s.replace(/\s+/g, ' ').trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

module.exports = { cleanName };
