const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Meta ships a new Graph version roughly quarterly and retires old ones
// after about two years. Pin it here so an upgrade is a one-line change.
const GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v23.0';
const PAGE_ID = process.env.FB_PAGE_ID;
const PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ── supabase ──────────────────────────────────────────────────
const sbHeaders = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

async function getListing(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}&limit=1`, {
    headers: sbHeaders,
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : null;
}

async function recordPost(listingId, status, extra = {}) {
  await fetch(`${SUPABASE_URL}/rest/v1/listing_posts`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      listing_id: listingId,
      platform: 'fb_page',
      status,
      posted_at: status === 'posted' ? new Date().toISOString() : null,
      ...extra,
    }),
  });
}

// ── graph helpers ─────────────────────────────────────────────
async function graph(path, params) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, access_token: PAGE_TOKEN }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Graph ${data.error.code}: ${data.error.message}`);
  }
  return data;
}

// Facebook fetches photos by URL itself, so nothing gets uploaded from
// here — the Supabase Storage URLs just need to be publicly readable.
// published:false stages a photo without putting it on the timeline;
// the feed post then attaches all of them as one album.
async function stagePhotos(urls) {
  const ids = [];
  for (const url of urls.slice(0, 10)) {
    try {
      const { id } = await graph(`${PAGE_ID}/photos`, { url, published: false });
      ids.push({ media_fbid: id });
    } catch (err) {
      console.error('Photo staging failed for', url, '—', err.message);
    }
  }
  return ids;
}

// ── copy ──────────────────────────────────────────────────────
function money(n) {
  return `$${Number(n).toLocaleString('en-US')}`;
}

// Rosalia Group can't hold out another brokerage's listing as its own.
// Throwing here rather than posting-without means a missing agency is a
// visible failure instead of a quiet misrepresentation.
function courtesyLine(l) {
  if (l.is_our_listing) return 'Listed by Rosalia Group';
  if (!l.listing_agent_name || !l.listing_agent_agency) {
    throw new Error(
      'Missing listing agent or agency. Add both to the listing, or set is_our_listing if it is ours.'
    );
  }
  return `Listing courtesy of ${l.listing_agent_name}, ${l.listing_agent_agency}${
    l.mls_number ? ` (MLS ${l.mls_number})` : ''
  }`;
}

// Buyer-side terms, for sale listings we hold. The DB constraints already
// block these on another agency's listing, but re-check rather than trust.
function termsLines(l) {
  if (l.listing_type !== 'sale' || !l.is_our_listing) return [];

  const lines = [];
  if (l.principals_only) {
    lines.push('Principals only — no represented buyers.');
  } else if (l.buyer_agent_comp === 'not_offered') {
    lines.push("Seller is not offering buyer's agent compensation.");
  } else if (l.buyer_agent_comp === 'negotiable') {
    lines.push("Buyer's agent compensation negotiable.");
  }
  if (l.no_assignment) {
    lines.push('Contract may not be assigned. No wholesalers.');
  }
  return lines;
}

// Describe the unit, never the kind of person who should live in it.
// Organic Page posts aren't subject to Meta's housing ad restrictions,
// but fair housing law applies to the words either way. Under NJ LAD,
// source of lawful income is protected — no "no vouchers" language,
// ever, in any form.
function buildMessage(l) {
  const size = [
    l.bedrooms != null ? `${l.bedrooms} bed` : null,
    l.bathrooms != null ? `${l.bathrooms} bath` : null,
    l.sqft ? `${Number(l.sqft).toLocaleString('en-US')} sq ft` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const isRental = l.listing_type === 'rent';

  return [
    `${l.title} — ${money(l.price)}${isRental ? '/mo' : ''}`,
    size || null,
    '',
    l.description?.trim() || null,
    '',
    l.laundry ? `Laundry: ${l.laundry}` : null,
    l.parking ? `Parking: ${l.parking}` : null,
    l.utilities ? `Utilities: ${l.utilities}` : null,
    l.pets_allowed === true ? 'Pets welcome' : null,
    l.available_date ? `Available ${l.available_date}` : null,
    '',
    isRental
      ? 'All lawful sources of income welcome, including housing vouchers.'
      : null,
    isRental
      ? `Book a tour: https://abrevo.co/booking-form?listing=${l.id}&type=tour`
      : `Book a buyer consultation: https://abrevo.co/buyer-consultation?listing=${l.id}`,
    '',
    ...termsLines(l),
    termsLines(l).length ? '' : null,
    courtesyLine(l),
  ]
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── handler ───────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!PAGE_ID || !PAGE_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'FB_PAGE_ID and FB_PAGE_TOKEN are not set in Netlify env vars' }),
    };
  }

  let listingId;
  try {
    ({ listing_id: listingId } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!listingId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'listing_id required' }) };
  }

  try {
    const listing = await getListing(listingId);
    if (!listing) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Listing not found' }) };
    }
    if (listing.status !== 'active') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Listing is "${listing.status}" — set it to active before posting` }),
      };
    }

    const message = buildMessage(listing);
    const photos = Array.isArray(listing.photos) ? listing.photos : [];

    console.log(`Posting listing ${listing.id} to Page ${PAGE_ID} with ${photos.length} photo(s)`);

    let post;
    if (photos.length > 1) {
      const attached = await stagePhotos(photos);
      post = attached.length
        ? await graph(`${PAGE_ID}/feed`, { message, attached_media: attached })
        : await graph(`${PAGE_ID}/feed`, { message });
    } else if (photos.length === 1) {
      // Single photo posts read better as a photo post than a 1-item album
      post = await graph(`${PAGE_ID}/photos`, { url: photos[0], caption: message });
    } else {
      post = await graph(`${PAGE_ID}/feed`, { message });
    }

    const postId = post.post_id || post.id;
    const url = `https://www.facebook.com/${postId}`;

    await recordPost(listing.id, 'posted', { external_url: url });

    // Posting to Facebook is what publishes it to rosaliagroup.com. The
    // site reads the public_listings view, which carries the courtesy
    // line as a column so the attribution can't be dropped in the template.
    await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${listing.id}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ web_published_at: new Date().toISOString() }),
    });

    console.log('Posted:', url, '| published to web');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, post_id: postId, url, web_published: true }),
    };
  } catch (err) {
    console.error('FB Page post error:', err.message);
    await recordPost(listingId, 'failed', { error: err.message.slice(0, 400) });
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
