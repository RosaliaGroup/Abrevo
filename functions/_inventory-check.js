/**
 * Private, read-only inventory reachability check (Gate A).
 *
 * This is a SHARED HELPER, not a Netlify endpoint. The leading underscore keeps
 * Netlify from routing it as a function. It exists so the healthcheck can verify
 * that the Google Sheets inventory source is reachable WITHOUT exposing inventory
 * rows, credentials, spreadsheet IDs, or raw Google API errors.
 *
 * SECURITY / SAFETY:
 *  - Credentials come ONLY from the GOOGLE_SHEETS_CREDENTIALS env var (JSON string).
 *    No service-account private key is hardcoded here (the legacy inventory.js
 *    embedded one — that is exactly what this replaces).
 *  - Read-only scope; metadata + a single-cell probe. Values read are DISCARDED.
 *  - Returns bounded result only:  { ok:true, sheet_count } OR { ok:false, error_code }.
 *    Never returns rows, headers, spreadsheet IDs, credential material, error.message,
 *    stack traces, or Google API response bodies.
 */

// Spreadsheet identifiers are configuration, not secrets. They stay internal and
// are NEVER echoed back in any response.
const SPREADSHEET_IDS = ['17JZID4T1Vz7JOuCkztNNm73gLCnAwlLGWx3gRMUyCJI'];

const READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/**
 * Parse credentials from the env string. Returns { creds } or { error_code }.
 * Bounded error codes only — never surfaces the parse error text.
 */
function loadCredentials(raw) {
  if (!raw || typeof raw !== 'string') {
    return { error_code: 'inventory_credentials_missing' };
  }
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (_) {
    return { error_code: 'inventory_credentials_invalid' };
  }
  if (!creds || typeof creds !== 'object' || !creds.private_key || !creds.client_email) {
    return { error_code: 'inventory_credentials_invalid' };
  }
  return { creds };
}

// Default client factory — isolated so tests can inject a fake sheets client and
// never touch the network or require real credentials.
async function defaultGetSheetsClient(creds) {
  // Required lazily so unit tests that inject a client don't need googleapis.
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: [READONLY_SCOPE] });
  return google.sheets({ version: 'v4', auth });
}

/**
 * Run the read-only inventory reachability check.
 * opts.env             - env source (defaults to process.env)
 * opts.getSheetsClient - async (creds) => sheets client (defaults to real googleapis)
 *
 * Returns { ok:true, sheet_count } or { ok:false, error_code }.
 */
async function runInventoryCheck(opts = {}) {
  const env = opts.env || process.env;
  const getSheetsClient = opts.getSheetsClient || defaultGetSheetsClient;

  const loaded = loadCredentials(env.GOOGLE_SHEETS_CREDENTIALS);
  if (loaded.error_code) return { ok: false, error_code: loaded.error_code };

  let sheets;
  try {
    sheets = await getSheetsClient(loaded.creds);
  } catch (_) {
    // Auth/client construction failed — treat as invalid credentials, no detail leaked.
    return { ok: false, error_code: 'inventory_credentials_invalid' };
  }

  let sheetCount = 0;
  for (const spreadsheetId of SPREADSHEET_IDS) {
    let meta;
    try {
      meta = await sheets.spreadsheets.get({ spreadsheetId });
    } catch (_) {
      return { ok: false, error_code: 'inventory_sheet_metadata_failed' };
    }
    const tabs = meta && meta.data && Array.isArray(meta.data.sheets) ? meta.data.sheets : [];
    const firstTab = tabs[0] && tabs[0].properties && tabs[0].properties.title;
    if (!firstTab) {
      return { ok: false, error_code: 'inventory_sheet_metadata_failed' };
    }
    try {
      // Bounded single-cell read to prove read access. The returned value is
      // intentionally DISCARDED — inventory contents are never held or returned.
      await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${firstTab}'!A1:A1` });
    } catch (_) {
      return { ok: false, error_code: 'inventory_sheet_read_failed' };
    }
    sheetCount += tabs.length;
  }

  return { ok: true, sheet_count: sheetCount };
}

module.exports = { runInventoryCheck, loadCredentials, SPREADSHEET_IDS };
