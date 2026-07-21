const { google } = require('googleapis');
const { requireGateA, adminCorsHeaders } = require('./_gate-a-auth');

const SPREADSHEET_IDS = [
  '17JZID4T1Vz7JOuCkztNNm73gLCnAwlLGWx3gRMUyCJI'
];

function getAuth() {
  // Gate A: service-account credentials come from server env, NEVER hardcoded.
  // GOOGLE_SHEETS_CREDENTIALS holds the full service-account JSON. Read-only scope.
  // NOTE: the previously hardcoded key is compromised and must be rotated (handled
  // by the credential-remediation workstream — out of scope for this branch).
  const raw = process.env.GOOGLE_SHEETS_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_SHEETS_CREDENTIALS is not configured');
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    throw new Error('GOOGLE_SHEETS_CREDENTIALS is not valid JSON');
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
}

async function readSheet(sheets, spreadsheetId, index) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const firstTab = meta.data.sheets[0].properties.title;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${firstTab}'!A1:Z200`
    });
    const rows = res.data.values || [];
    const headers = rows[0] || [];
    const data = rows.slice(1);
    return { index, spreadsheetId, tab: firstTab, headers, rows: data, error: null };
  } catch (e) {
    return { index, spreadsheetId, tab: null, headers: [], rows: [], error: e.message };
  }
}

exports.handler = async (event) => {
  // GATE A: authenticate first (handles OPTIONS preflight + 401/403). No wildcard CORS.
  const gate = requireGateA(event);
  if (!gate.ok) return gate.response;
  const headers = adminCorsHeaders(event);

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const results = await Promise.all(
      SPREADSHEET_IDS.map((id, i) => readSheet(sheets, id, i))
    );
    return { statusCode: 200, headers, body: JSON.stringify({ sheets: results }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
