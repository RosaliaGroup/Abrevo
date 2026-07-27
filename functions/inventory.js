const { google } = require('googleapis');
const { getGoogleCredentials } = require('./lib/googleCreds');

const SPREADSHEET_IDS = [
  '17JZID4T1Vz7JOuCkztNNm73gLCnAwlLGWx3gRMUyCJI'
];

async function getAuth() {
  const creds = await getGoogleCredentials();
  return new google.auth.GoogleAuth({
    credentials: creds,
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
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const auth = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const results = await Promise.all(
      SPREADSHEET_IDS.map((id, i) => readSheet(sheets, id, i))
    );
    return { statusCode: 200, headers, body: JSON.stringify({ sheets: results }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
