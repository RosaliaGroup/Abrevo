'use strict';
/**
 * Pure, framework-free thread-state helpers shared by the Communications UI and
 * its tests. Keeping this logic here (not only inline in the HTML) lets the
 * "no duplicate messages" and "immediate update" guarantees be unit-tested in
 * Node. The browser page uses the same algorithms.
 */

/** Stable identity for a message: real id, else provider id, else client temp id. */
function messageKey(m) {
  return (m && (m.id || m.provider_message_id || m.tempId)) || null;
}

/** Order by created_at asc, then id, for a stable chronological thread. */
function orderThread(messages) {
  return [...messages].sort((a, b) => {
    const ta = String(a.created_at || '');
    const tb = String(b.created_at || '');
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return String(messageKey(a)).localeCompare(String(messageKey(b)));
  });
}

/**
 * Merge incoming messages into an existing list without duplicates. Identity is
 * by messageKey; additionally, an optimistic message (tempId) is reconciled
 * with its confirmed server row when they share the same idempotency_key, so an
 * optimistic bubble is REPLACED (not duplicated) once the server confirms.
 */
function mergeMessages(existing, incoming) {
  const byKey = new Map();
  const byIdem = new Map();
  const put = (m) => {
    const k = messageKey(m);
    // Reconcile optimistic (tempId) with a confirmed row via idempotency_key.
    if (m.idempotency_key && byIdem.has(m.idempotency_key)) {
      const prevKey = byIdem.get(m.idempotency_key);
      const prev = byKey.get(prevKey);
      const confirmed = m.id ? m : (prev && prev.id ? prev : m); // prefer the row with a real id
      byKey.delete(prevKey);
      byKey.set(messageKey(confirmed), confirmed);
      byIdem.set(m.idempotency_key, messageKey(confirmed));
      return;
    }
    if (k != null && byKey.has(k)) { byKey.set(k, { ...byKey.get(k), ...m }); }
    else if (k != null) { byKey.set(k, m); }
    if (m.idempotency_key) byIdem.set(m.idempotency_key, messageKey(byKey.get(k) || m));
  };
  for (const m of existing) put(m);
  for (const m of incoming) put(m);
  return orderThread([...byKey.values()]);
}

/** Is sending disabled for this conversation? (opted out) */
function isSendDisabled(conversation) {
  return Boolean(conversation && conversation.opted_out_at);
}

function lastMessagePreview(conversation) {
  return (conversation && conversation.last_message_preview) || '';
}

module.exports = { messageKey, orderThread, mergeMessages, isSendDisabled, lastMessagePreview };
