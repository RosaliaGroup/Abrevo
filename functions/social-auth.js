const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const REDIRECT_URI = 'https://app.abrevo.co/.netlify/functions/social-auth';
const H = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: H, body: '' };

  // INITIATE LOGIN
  if (p.action === 'login') {
    const state = Buffer.from(JSON.stringify({ agent_id: p.agent_id||'', ts: Date.now() })).toString('base64');
    const scope = 'email,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish';
    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}&response_type=code`;
    return { statusCode: 302, headers: { ...H, Location: url }, body: '' };
  }

  // OAUTH CALLBACK
  if (p.code) {
    try {
      let state = {};
      try { state = JSON.parse(Buffer.from(decodeURIComponent(p.state||''), 'base64').toString()); } catch(e){}

      // Exchange code for token
      const tr = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${p.code}`);
      const td = await tr.json();
      if (td.error) return { statusCode: 302, headers: { Location: `/social.html?auth=error&msg=${encodeURIComponent(td.error.message)}` }, body: '' };

      // Long-lived token
      const lr = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}&fb_exchange_token=${td.access_token}`);
      const ld = await lr.json();
      const token = ld.access_token || td.access_token;

      // User info
      const ur = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=${token}`);
      const user = await ur.json();

      // Pages
      const pr = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`);
      const pd = await pr.json();
      const pages = pd.data || [];

      const platforms = [];
      for (const page of pages) {
        platforms.push({ type: 'facebook_page', id: page.id, name: page.name, access_token: page.access_token });
        const igr = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
        const igd = await igr.json();
        if (igd.instagram_business_account) {
          const igid = igd.instagram_business_account.id;
          const igu = await fetch(`https://graph.facebook.com/v19.0/${igid}?fields=id,name,username&access_token=${page.access_token}`);
          const igi = await igu.json();
          platforms.push({ type: 'instagram', id: igid, name: igi.username||igi.name, page_id: page.id, page_token: page.access_token });
        }
      }

      // Save to Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/social_connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' },
        body: JSON.stringify({ agent_id: state.agent_id||null, user_fb_id: user.id, user_name: user.name, user_email: user.email||null, long_token: token, platforms: JSON.stringify(platforms), expires_at: new Date(Date.now()+60*24*60*60*1000).toISOString() })
      });

      return { statusCode: 302, headers: { Location: `/social.html?auth=success&pages=${pages.length}&platforms=${platforms.length}&name=${encodeURIComponent(user.name)}` }, body: '' };
    } catch(err) {
      return { statusCode: 302, headers: { Location: `/social.html?auth=error&msg=${encodeURIComponent(err.message)}` }, body: '' };
    }
  }

  // STATUS
  if (p.action === 'status') {
    const q = p.agent_id ? `agent_id=eq.${p.agent_id}&` : '';
    const r = await fetch(`${SUPABASE_URL}/rest/v1/social_connections?${q}order=connected_at.desc&limit=10`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const d = await r.json();
    return { statusCode: 200, headers: H, body: JSON.stringify({ connections: Array.isArray(d)?d:[] }) };
  }

  // POST
  if (p.action === 'post') {
    const { platform_id, platform_type, access_token, page_token, message, image_url } = JSON.parse(event.body||'{}');
    try {
      let result;
      if (platform_type === 'facebook_page') {
        const body = image_url
          ? { url: image_url, caption: message, access_token }
          : { message, access_token };
        const endpoint = image_url ? `${platform_id}/photos` : `${platform_id}/feed`;
        const r = await fetch(`https://graph.facebook.com/v19.0/${endpoint}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        result = await r.json();
      } else if (platform_type === 'instagram') {
        if (!image_url) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'Instagram requires image_url' }) };
        const cr = await fetch(`https://graph.facebook.com/v19.0/${platform_id}/media`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ image_url, caption: message, access_token: page_token }) });
        const cd = await cr.json();
        if (cd.error) return { statusCode: 400, headers: H, body: JSON.stringify(cd) };
        const pubr = await fetch(`https://graph.facebook.com/v19.0/${platform_id}/media_publish`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ creation_id: cd.id, access_token: page_token }) });
        result = await pubr.json();
      }
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true, result }) };
    } catch(err) {
      return { statusCode: 500, headers: H, body: JSON.stringify({ error: err.message }) };
    }
  }

  // DISCONNECT
  if (p.action === 'disconnect') {
    if (!p.connection_id) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'connection_id required' }) };
    await fetch(`${SUPABASE_URL}/rest/v1/social_connections?id=eq.${p.connection_id}`, { method:'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'Unknown action' }) };
};
