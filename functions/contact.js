/**
 * Netlify Function: /.netlify/functions/contact
 *
 * Abrevo "Contact Us" form -> Rosalia Group lead pipeline (Supabase `leads`).
 *
 * SERVER-SIDE ONLY. All credentials are read from Netlify environment variables:
 *   SUPABASE_URL, SUPABASE_KEY (service-role), TEXTBELT_KEY, NOTIFY_PHONE.
 * The service-role key must NEVER reach browser code and must not be hardcoded here.
 *
 * Behaviour (mirrors respondrosalia.js findExistingLead/saveOrUpdateLead, via the
 * existing fetch-based Supabase REST pattern — no SDK):
 *   - de-dupe: exact normalized email, then phone by LAST 10 DIGITS.
 *   - existing lead -> PATCH: append a dated website-contact note, fill only
 *     missing useful fields, and DO NOT change status/source/replied_at/email_reply.
 *   - no lead -> INSERT one (source=website-contact, status=new, follow_up_count=0).
 *   - replied_at & email_reply are left NULL/untouched (a website inquiry is not a reply).
 *   - Ana is notified by SMS (Textbelt); an SMS failure never fails a saved lead.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const MAX = { name: 200, email: 320, phone: 40, message: 5000, property: 500 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (statusCode, obj) => ({ statusCode, headers: CORS, body: JSON.stringify(obj) });

const normEmail = (v) => {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e || null;
};

// US-oriented normalization: digits only, +1 for 10 digits, + for 11+.
const normPhone = (v) => {
  if (v == null) return null;
  const d = String(v).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return "+1" + d;
  if (d.length >= 11) return "+" + d;
  return null; // fewer than 10 digits -> not a usable phone
};

const last10 = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(-10);

const clean = (v, max) => {
  if (v == null) return null;
  const s = String(v).replace(/\r\n/g, "\n").trim();
  return s ? s.slice(0, max) : null;
};

function sbHeaders(extra) {
  return {
    apikey: process.env.SUPABASE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
    ...extra,
  };
}

async function findExistingLead(email, phone) {
  const base = process.env.SUPABASE_URL;
  // 1) exact normalized email
  if (email) {
    const res = await fetch(
      `${base}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: sbHeaders() },
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data[0];
    } else {
      throw new Error(`supabase_lookup_${res.status}`);
    }
  }
  // 2) phone by last 10 digits
  const l10 = last10(phone);
  if (l10.length === 10) {
    const res = await fetch(
      `${base}/rest/v1/leads?phone=ilike.*${l10}*&limit=1`,
      { headers: sbHeaders() },
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data[0];
    } else {
      throw new Error(`supabase_lookup_${res.status}`);
    }
  }
  return null;
}

async function insertLead(lead) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads`, {
    method: "POST",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      source: "website-contact",
      message: lead.message,
      property: lead.property,
      client: "rosalia",
      status: "new",
      follow_up_count: 0,
      notes: lead.note,
      // replied_at and email_reply are intentionally left unset (NULL).
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase_insert_${res.status}`);
  try {
    const p = JSON.parse(text);
    return Array.isArray(p) ? p[0] : p;
  } catch {
    return null;
  }
}

async function mergeLead(existing, lead) {
  // Append a dated website-contact note (carries the new source + message); preserve
  // prior notes. Fill ONLY missing useful fields. Never touch status / source /
  // replied_at / email_reply. The `leads` table has a single `source` column (no
  // source-history), so the new source lives in the appended note, not by overwrite.
  const patch = { notes: existing.notes ? existing.notes + "\n" + lead.note : lead.note };
  if (!existing.name && lead.name) patch.name = lead.name;
  if (!existing.email && lead.email) patch.email = lead.email;
  if (!existing.phone && lead.phone) patch.phone = lead.phone;
  if (!existing.property && lead.property) patch.property = lead.property;

  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads?id=eq.${existing.id}`, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase_update_${res.status}`);
  try {
    const p = JSON.parse(text);
    return (Array.isArray(p) ? p[0] : p) || existing;
  } catch {
    return existing;
  }
}

// Notify Ana. Returns true on delivery, false otherwise. NEVER throws to the caller.
async function notifyAna({ name, email, phone, message, merged }) {
  const key = process.env.TEXTBELT_KEY;
  const dest = process.env.NOTIFY_PHONE;
  if (!key || !dest) {
    // SMS is optional. Missing config must NEVER fail an already-saved lead.
    console.log("contact: SMS skipped — TEXTBELT_KEY or NOTIFY_PHONE not configured");
    return false;
  }
  try {
    let p = String(dest).replace(/\D/g, "");
    if (p.length === 10) p = "+1" + p;
    else if (p.length >= 11) p = "+" + p;
    const summary = (message || "").replace(/\s+/g, " ").slice(0, 140);
    const text =
      `New website contact (${merged ? "MERGED" : "CREATED"})\n` +
      `Name: ${name || "N/A"}\nEmail: ${email || "N/A"}\nPhone: ${phone || "N/A"}\n` +
      `Msg: ${summary || "N/A"}`;
    const res = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: p, message: text, key }),
    });
    const data = await res.json().catch(() => ({}));
    return !!(data && data.success);
  } catch (e) {
    console.error("contact: sms notify failed:", e && e.name);
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "method_not_allowed" });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error("contact: SUPABASE_URL/SUPABASE_KEY not configured");
    return json(500, { success: false, error: "server_not_configured" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { success: false, error: "invalid_json" });
  }
  if (!body || typeof body !== "object") return json(400, { success: false, error: "invalid_body" });

  // Reject excessively large raw fields (don't silently truncate).
  for (const k of Object.keys(MAX)) {
    if (typeof body[k] === "string" && body[k].length > MAX[k]) {
      return json(400, { success: false, error: "field_too_large", field: k });
    }
  }

  const name = clean(body.name, MAX.name);
  const email = normEmail(body.email);
  const phone = normPhone(body.phone);
  const message = clean(body.message, MAX.message);
  const property = clean(body.property, MAX.property);

  if (email && (!EMAIL_RE.test(email) || email.length > MAX.email)) {
    return json(400, { success: false, error: "invalid_email" });
  }

  const hasEmail = !!email && EMAIL_RE.test(email);
  const hasPhone = last10(phone).length === 10;
  if (!hasEmail && !hasPhone) {
    return json(400, { success: false, error: "missing_contact_method" });
  }

  const note = `[${new Date().toLocaleDateString()}] website-contact: ${message || "no message"}`;
  const leadInput = { name, email: hasEmail ? email : null, phone: hasPhone ? phone : null, message, property, note };

  let saved;
  let merged = false;
  try {
    const existing = await findExistingLead(leadInput.email, leadInput.phone);
    if (existing) {
      merged = true;
      saved = await mergeLead(existing, leadInput);
    } else {
      saved = await insertLead(leadInput);
    }
  } catch (e) {
    console.error("contact: supabase save failed:", e && e.message);
    return json(502, { success: false, error: "save_failed" });
  }

  // SMS is best-effort: a delivery failure must not fail a saved lead.
  const smsNotified = await notifyAna({
    name: leadInput.name,
    email: leadInput.email,
    phone: leadInput.phone,
    message,
    merged,
  });

  return json(200, {
    success: true,
    lead_id: saved && saved.id != null ? saved.id : null,
    merged,
    sms_notified: smsNotified,
  });
};
