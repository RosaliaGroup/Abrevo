// ============================================================================
// admin-gate.ts  —  GATE A CONTAINMENT (TEMPORARY)  [REVISED v2]
// ----------------------------------------------------------------------------
// Rejects unauthenticated requests to the four admin dashboards BEFORE any HTML
// (and its embedded credentials) is delivered.
//
// TEMPORARY containment — NOT the durable auth solution. Gate B replaces this
// with Supabase Auth (server-owned admin_users + short-lived sessions).
//
// v2 corrections (verified against current Netlify docs, July 2026):
//   - Env access uses Netlify.env.get() (canonical Edge API), not Deno.env.get().
//     Ref: docs.netlify.com/build/edge-functions/environment-variables/
//   - Type import from "@netlify/edge-functions".
//   - NOTE: env vars must be set for the FUNCTIONS scope in the Netlify UI
//     (netlify.toml env vars are NOT available to edge functions), and a new
//     build/deploy is required after changing them.
//   - Authorized pass-through returns `undefined` (Netlify documents this as
//     "continue the request chain").
//
// NOT INSTALLED / NOT VALIDATED against the real Netlify deployment.
// ============================================================================

import type { Context } from "@netlify/edge-functions";

// Netlify provides a global `Netlify` object in the Edge runtime.
declare const Netlify: { env: { get(key: string): string | undefined } };

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

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function parseBasic(header: string | null): { user: string; pass: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "basic" || !encoded) return null;
  let decoded: string;
  try { decoded = atob(encoded); } catch { return null; }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

export default async (request: Request, _context: Context): Promise<Response | void> => {
  const expectedUser = Netlify.env.get("ADMIN_GATE_USER");
  const expectedPass = Netlify.env.get("ADMIN_GATE_PASS");

  // DEFAULT DENY: unconfigured gate must not fail open.
  if (!expectedUser || !expectedPass) return challenge();

  const creds = parseBasic(request.headers.get("Authorization"));
  if (!creds) return challenge();

  const userOk = timingSafeEqual(creds.user, expectedUser);
  const passOk = timingSafeEqual(creds.pass, expectedPass);
  if (userOk && passOk) return; // undefined -> continue request chain (authorized)

  return forbidden(); // credentials present but invalid
};

// Protected paths are declared in netlify.toml [[edge_functions]] (Artifact 5):
// /rosalia(.html), /crm(.html), /social(.html), /mechanical(.html).
