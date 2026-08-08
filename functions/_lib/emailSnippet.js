'use strict';
// Strip a quoted reply chain from an inbound email body so only the sender's
// newest text remains. Must run BEFORE whitespace collapse (it needs line breaks).
// Cuts at the first of:
//   - a quoted line ("> ...")
//   - a Gmail attribution ("On <date>, <name> wrote:", may wrap before "wrote:")
//   - an Outlook divider ("-----Original Message-----", any dash count)
//   - an Outlook header block: a "From:" line immediately leading into
//     Sent:/Date:/To:/Cc:/Subject: (the reply header that has no dashes)
function stripQuotedReply(raw) {
  const lines = String(raw == null ? '' : raw).split(/\r?\n/);
  const hdr = /^\s*(Sent|Date|To|Cc|Subject):/i;
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*>/.test(line)) break;                                                          // quoted chain
    if (/^\s*On\b/.test(line) && /\bwrote:/.test(line + ' ' + (lines[i + 1] || ''))) break; // Gmail attribution (poss. wrapped)
    if (/^\s*-+\s*Original Message\s*-+/i.test(line)) break;                                 // Outlook divider
    if (/^\s*From:\s/.test(line) &&                                                          // Outlook header block
        (hdr.test(lines[i + 1] || '') || hdr.test(lines[i + 2] || '') || hdr.test(lines[i + 3] || ''))) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

// Full snippet: strip the quoted chain, collapse whitespace, truncate with an
// ellipsis. Cap defaults to ~200 chars.
function emailSnippet(raw, max = 200) {
  const s = stripQuotedReply(raw).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

module.exports = { stripQuotedReply, emailSnippet };
