const { google } = require('googleapis');

const SPREADSHEET_IDS = [
  '17JZID4T1Vz7JOuCkztNNm73gLCnAwlLGWx3gRMUyCJI'
];

function getAuth() {
  const creds = {
    type: 'service_account',
    project_id: 'abrevo-booking',
    private_key_id: '68af71ac430f809e96b27152a06c8cd17b328a4a',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC+Mx4z8Lp6r1Bm\nqdEdIpRpZI82UqxhhJmm5q2siTAK3aJfKH/GEOJbTDTui1hJO5wXmco5MMGVwAcY\nY7RtlUFlCsJFJVycr+n0tm45Pw9BBkxoGogHMDx1wt8vX4Zsdyug+7GBJBJJVO3U\n9QOUxVvFNEEnN2r10Ded8i4HmFhQbvD+1fCySxRRPyLP6Mf80PKaGn5Brv4zuJlW\n0doQpgNFYIFTtkgS5w/JhKblfe4DujFBn5k5rz580L4/Z/u+KmkgARI90meix5t8\njnlqiyoPtR8ZNBJJdkRsdztp54+fWNtcVT9gGvrD8AOebG9I0XPie+pGG5LvxrWw\nx0lrprDVAgMBAAECggEAVYLU8uQpaswUGTwC9Jbd465exr0PnD5J+GQgs//vtgrk\nG+Uw4QMpSYOvDopedHpU2LV/WgwGFMYDSp9U+KmQf5WBNyYvh5B9XlSApMMpoAHt\nayZ2fsjcfdNRlVJctLo1RsiyCs4FXKvOy54mcIX0lupB2phLQd3Ni3jc4fRHzEz2\nFXaZPkRCvf7gFrr/jtCYwM2tQ7I2RO53+G+FYkXnyMrHtezpA8ulR2/E/iGLnanU\nHlP/7kJ71KoU9kbbr4F0XclArTTjJMar46wXGSKUY/ACb9ia80qAjdMb5MQrjOJa\nNaVqvO4OzrqaJlpPSF9UH6djdw8+4W1Nas9Qj9/+FwKBgQDi7gWn42HIRuXK8bfC\nx6TEcIGw6URQKUcPBKQNbcd+MFTwxPTFWztfr6O+GmxaluYM+SXm5bj8MQTSiyVN\nN6ycR6vOfF0vqb2qeELt1Q5uR0HuPVbtUYRC7fcq3uLkkzK6GmdNx6uby5cyQEZ1\nE56ZfyGH14AdxhGojiPO9mnr2wKBgQDWkI/ui5+xZ/CNK6THLIsrlTiRjp6g0w+7\nM/F6KuEtkhn2HEfSM6K6v38v21DP+i0/a4cdFa8gRniokedXN3KAgsXWJs/mqA0j\nKu7El09tcrNRHIx8uhI3FNxUVMjYeo7TF5gSnfv/7MrI8L1gVHaEvxktRtjipOul\nd+rzTtNNDwKBgQCJd06NyTwuqmQBcDO1FmNFbDHkDSqItLiK7HDEgb/bPUP3Jhhw\nhTeOW0OBoVgJ+GcbbMH9ASPyAW++avQJtrQlZ3U3/DYm7Vgrr/Y7RFkdjKTvwNCr\nqjnIoYacvbAMbu7Htb7maxIVqlrI4g7MVTo6Gb0iIPVHE/kWdiRS9wprCQKBgQDN\n9fSDmjlPdSN+j39bxVFOI64qYsm4PQGjxEeu6ow+Tzlmel0i1HgHZRy0loSrL03R\ny+jlrVPu2lamEXAM02exHlbDq3vzwCrkMCkEQu52dBzW5l2guIgVoYuh08T7sCF7\nVfGfJVGpp+Y8HoLafhlKcZm8UX6NiJu+uS6qIWdJVwKBgD4kNQ8GJUNJjS4TvW6j\nTqWlZwrKT6+zMIcTC4Ty6K5JL98eAwauJzC2qJwIODDwQ1Cifr0GA0aQrWtUC6iT\n+lHSpRyIpo1azJBzIjHjStC1jKWu3Nu9jwrw7MJAjnwxHXFIltQMXyNv3Xy0ZAEb\nKs8gEP/udnDYa1WpqmfG1yvX\n-----END PRIVATE KEY-----\n',
    client_email: 'abrevo-sheets@abrevo-booking.iam.gserviceaccount.com',
    client_id: '104475015524837471543',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/abrevo-sheets%40abrevo-booking.iam.gserviceaccount.com',
    universe_domain: 'googleapis.com'
  };
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
