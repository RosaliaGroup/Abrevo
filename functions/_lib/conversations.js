'use strict';
/**
 * Server-owned conversation lookup/create service.
 *
 * Contract:
 *   - Normalizes the phone with the canonical helper.
 *   - Missing/invalid phone -> returns a clean result, creates NOTHING.
 *   - Reuses an existing conversation for a known phone; creates exactly one
 *     for an unknown phone.
 *   - Concurrency-safe: relies on the DB UNIQUE(normalized_phone). If two
 *     callers race, the insert loser catches the unique violation and re-reads
 *     the winner's row — never two conversations for one phone.
 *   - Adds requested CRM linkage by STABLE ID, idempotently. Never creates or
 *     duplicates a CRM entity; only records links to ids the caller already
 *     holds.
 *
 * `repo` is injected (see supabaseRepo.js in production, in-memory fake in
 * tests). This module performs no network I/O itself.
 */

const { normalizePhone } = require('./phone');

// Entity types that actually exist in this Abrevo Supabase project with a
// stable id. Anything else is rejected (documented, not invented).
const SUPPORTED_ENTITY_TYPES = new Set(['lead', 'booking']);

function createConversationService({ repo }) {
  if (!repo) throw new Error('createConversationService: repo is required');

  /**
   * @param {object} args
   * @param {unknown} args.phone
   * @param {Array<{type:string,id:string|number}>} [args.links]
   * @param {string} [args.createdBy]
   * @returns {Promise<
   *   { ok: true, created: boolean, conversation: object, links: object[],
   *     skippedLinks: Array<{type:string,id:any,reason:string}> }
   *   | { ok: false, reason: 'missing_phone' | 'invalid_phone', phone: string }
   * >}
   */
  async function getOrCreateConversation({ phone, links = [], createdBy } = {}) {
    const norm = normalizePhone(phone);
    if (!norm.ok) {
      return {
        ok: false,
        reason: norm.reason === 'missing' ? 'missing_phone' : 'invalid_phone',
        phone: norm.input,
      };
    }
    const e164 = norm.e164;

    // 1. Reuse existing.
    let conversation = await repo.getConversationByPhone(e164);
    let created = false;

    // 2. Create exactly one if none exists (race-safe).
    if (!conversation) {
      try {
        conversation = await repo.insertConversation({ normalized_phone: e164, created_by: createdBy });
        created = true;
      } catch (err) {
        const isUnique =
          (err && (err.name === 'UniqueViolationError' || err.code === 'unique_violation'));
        if (!isUnique) throw err;
        // Lost the race: the other writer created it — read theirs.
        conversation = await repo.getConversationByPhone(e164);
        if (!conversation) throw err; // truly unexpected
        created = false;
      }
    }

    // 3. Add requested linkage by stable id, idempotently.
    const skippedLinks = [];
    for (const link of links) {
      if (!link || !SUPPORTED_ENTITY_TYPES.has(link.type)) {
        skippedLinks.push({ type: link && link.type, id: link && link.id, reason: 'unsupported_entity_type' });
        continue;
      }
      if (link.id === null || link.id === undefined || String(link.id).length === 0) {
        skippedLinks.push({ type: link.type, id: link.id, reason: 'missing_entity_id' });
        continue;
      }
      // insertLinkIfAbsent is idempotent (unique index); repeated calls are no-ops.
      await repo.insertLinkIfAbsent({
        conversation_id: conversation.id,
        entity_type: link.type,
        entity_id: String(link.id),
      });
    }

    const currentLinks = await repo.listLinks(conversation.id);
    return { ok: true, created, conversation, links: currentLinks, skippedLinks };
  }

  return { getOrCreateConversation, SUPPORTED_ENTITY_TYPES };
}

module.exports = { createConversationService, SUPPORTED_ENTITY_TYPES };
