// ============================================================================
// admin-gate.ts  —  GATE A CONTAINMENT (TEMPORARY)
// ----------------------------------------------------------------------------
// Purpose: Reject unauthenticated requests to the admin dashboards BEFORE
//          any HTML (and its embedded credentials) is delivered.
//
// This is a TEMPORARY containment control. It is NOT the durable auth solution.
// The durable solution (Gate B) is Supabase Auth with a server-owned admin_users
// table and short-lived sessions. Do not treat HTTP Basic here as the end state.
//
// Security properties:
//   - Server-enforced at the edge (runs on production AND deploy previews).
//   - No password/secret is ever placed in dashboard JavaScript.
//   - Credentials are read only from server env (ADMIN_GATE_USER / ADMIN_GATE_PASS).
//   - Constant-time comparison to avoid timing oracles.
//   - 401 + WWW-Authenticate when no/absent credentials (browser prompts natively).
//   - 403 when credentials are present but wrong.
//   - Cache-Control: no-store so protected HTML is never cached by intermediaries.
//   - Does not reveal whether a given admin route "exists" (uniform challenge).
//   - Never logs the supplied credential.
// ============================================================================

import type { Context } from "https://edge.netlify.com";

// Uniform 401 challenge. Intentionally identical for every protected path so we
// don't leak which admin routes exist.
function challenge(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Rosalia Admin (Gate A)", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function forbidden(): Response {
  return new Response("Forbidden.", {
    status: 403,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Constant-time string comparison. Compares full length regardless of mismatch
// position; length differences still fail but do not short-circuit char loop.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  // Compare against max length so we don't leak length via early return timing.
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function parseBasic(header: string | null): { user: string; pass: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "basic" || !encoded) return null;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

export default async (request: Request, _context: Context): Promise<Response | void> => {
  const expectedUser = Deno.env.get("ADMIN_GATE_USER");
  const expectedPass = Deno.env.get("ADMIN_GATE_PASS");

  // DEFAULT DENY: if the gate is not configured, do not fail open. Challenge.
  if (!expectedUser || !expectedPass) {
    return challenge();
  }

  const creds = parseBasic(request.headers.get("Authorization"));
  if (!creds) {
    // No/malformed credentials -> prompt.
    return challenge();
  }

  // Evaluate BOTH comparisons before AND-ing, to avoid short-circuit timing.
  const userOk = timingSafeEqual(creds.user, expectedUser);
  const passOk = timingSafeEqual(creds.pass, expectedPass);
  if (userOk && passOk) {
    // Authorized: let the request continue to the static HTML / normal handling.
    // (Do not log the credential.)
    return; // pass-through
  }

  // Credentials present but invalid.
  return forbidden();
};

// The set of paths this function guards is declared in netlify.toml
// (see the [[edge_functions]] entries in the Gate A netlify.toml patch),
// covering: /rosalia, /rosalia.html, /crm, /crm.html, /social, /social.html,
// /mechanical, /mechanical.html. Keep the toml matchers and this file in sync.
