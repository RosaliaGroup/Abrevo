'use strict';
/**
 * Phase 2A-2 — pure, non-throwing lead-link decision for automated outbound SMS.
 *
 * Returns a single conversation-link descriptor { type:'lead', id } ONLY for a
 * Rosalia lead with a known id. For Mechanical, unknown/null client, or a
 * missing lead id it returns null (no link).
 *
 * It performs NO database access and NO phone-based lead guessing: the caller
 * passes a lead id already resolved by its own workflow record. Persistence,
 * provider id/status capture, dedupe, and idempotent conversation_links
 * insertion all happen in the EXISTING sendSMS -> threadLog path; this helper
 * only decides whether the known lead id may be attached. Never throws.
 *
 * @param {string|number|null|undefined} leadId
 * @param {string|null|undefined} client   tenant discriminator from the lead row
 * @returns {{type:'lead', id:string} | null}
 */
function leadLink(leadId, client) {
  try {
    if (client !== 'rosalia') return null; // Mechanical / unknown / null -> no link
    if (leadId === null || leadId === undefined) return null;
    const id = String(leadId);
    if (id.length === 0) return null;
    return { type: 'lead', id };
  } catch (_) {
    return null; // never throw into a send path
  }
}

module.exports = { leadLink };
