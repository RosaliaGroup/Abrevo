// functions/lib/leadContact.js
//
// Fill in a lead's contact details whenever they give us something new — from a
// booking, a text, a form, or a reply.
//
// THE PROBLEM THIS SOLVES
// A lead created from a Zillow inquiry arrives with an anonymised relay address
// (3ykmq9k6...@convo.zillow.com) and no phone. If that person later books a tour
// by phone and gives their real email, none of it was written back: book.js
// updated only the status. So the CRM kept showing a contactless record while we
// held their real details in `bookings` all along.
//
// RULES
//   - Never overwrite a value with an empty one.
//   - Never replace a REAL email with a RELAY one (relays are one-way and
//     eventually expire).
//   - A real email arriving over a relay is PROMOTED to the primary address, and
//     the relay is kept in alt_emails — replying to it still works, and it's how
//     their next Zillow message gets matched to this lead.
//   - Two real addresses: keep the existing primary, append the new one. Which
//     one they prefer isn't ours to decide.

const RELAY_PATTERN = /convo\.zillow\.com|@reply\.|\.craigslist\.org|@mail\.zillow/i;

// Our own addresses. They appear in email signatures and reply-to headers, and
// without this guard they get scraped out of a body and saved as the lead's own
// address — which then makes us the recipient of our own follow-ups.
const OURS_PATTERN = /@rosaliagroup\.com|@abrevo\.co|@mechanicalenterprise\.com|liveiron65@|@iron65\.com/i;

function isOurs(email) {
  return OURS_PATTERN.test(String(email || ''));
}

function isRelay(email) {
  return RELAY_PATTERN.test(String(email || ''));
}

function cleanEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s)) return null;
  // Never store one of our own addresses as a lead's.
  return isOurs(s) ? null : s;
}

/** E.164 for US numbers; null when the digits can't make a real one. */
function cleanPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return null;
}

/**
 * Work out what should change on a lead, given newly supplied details.
 * Pure function — no I/O — so the decisions are testable.
 *
 * @param {object} lead  the existing row (phone, email, alt_emails, name)
 * @param {object} incoming { phone, email, name }
 * @returns {object} a patch; empty when there is nothing new
 */
function buildContactPatch(lead, incoming) {
  const patch = {};
  const existingPhone = cleanPhone(lead && lead.phone);
  const newPhone = cleanPhone(incoming && incoming.phone);

  // Only fill a missing phone. A lead who calls from a second number shouldn't
  // silently replace the number we've been texting.
  if (newPhone && !existingPhone) patch.phone = newPhone;

  const existingEmail = cleanEmail(lead && lead.email);
  const newEmail = cleanEmail(incoming && incoming.email);

  if (newEmail) {
    if (!existingEmail) {
      patch.email = newEmail;
    } else if (newEmail !== existingEmail) {
      const alt = Array.isArray(lead.alt_emails) ? lead.alt_emails.slice() : [];
      if (isRelay(existingEmail) && !isRelay(newEmail)) {
        // Real address beats a relay: promote it, keep the relay so replies to
        // the original thread still reach them.
        patch.email = newEmail;
        if (!alt.includes(existingEmail)) alt.push(existingEmail);
        patch.alt_emails = alt;
      } else if (!isRelay(newEmail) || isRelay(existingEmail)) {
        // Either two real addresses, or a second relay. Keep the primary and
        // record the other — deciding which they prefer isn't ours to make.
        if (!alt.includes(newEmail)) {
          alt.push(newEmail);
          patch.alt_emails = alt;
        }
      }
      // A relay arriving when we already hold a real address is ignored.
    }
  }

  // A real name replaces a placeholder, but never the reverse.
  const newName = String((incoming && incoming.name) || '').trim();
  const oldName = String((lead && lead.name) || '').trim();
  if (newName && (!oldName || /^(guest|unknown|there|caller)$/i.test(oldName)) && newName.length > 1) {
    patch.name = newName;
  }

  return patch;
}

/**
 * Apply the patch. Best-effort: enrichment must never break the flow that
 * produced the details — a booking still succeeds if this fails.
 */
async function enrichLead(supabaseUrl, supabaseKey, leadId, lead, incoming) {
  try {
    const patch = buildContactPatch(lead, incoming);
    if (Object.keys(patch).length === 0) return { updated: false, reason: 'nothing_new' };

    const res = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      console.warn('[leadContact] patch failed:', res.status);
      return { updated: false, reason: `http_${res.status}` };
    }
    console.log('[leadContact] enriched', leadId, Object.keys(patch).join(','));
    return { updated: true, fields: Object.keys(patch) };
  } catch (err) {
    console.warn('[leadContact] error:', err.message);
    return { updated: false, reason: 'error' };
  }
}

module.exports = { buildContactPatch, enrichLead, isRelay, isOurs, cleanEmail, cleanPhone };
