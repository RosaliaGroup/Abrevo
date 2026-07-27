// functions/photos.js
// Branded media redirector: GET /photos/<slug> -> 302 to the underlying
// Drive/properties URL. Unknown slugs never dead-end — they 302 to the main
// properties site so a lead who taps a link always lands somewhere useful.

const { resolveSlug } = require('./lib/propertyMedia');

const FALLBACK = 'https://properties.rosaliagroup.com';

exports.handler = async (event) => {
  // Works whether Netlify hands us the original path (/photos/<slug>) or the
  // rewritten function path (/.netlify/functions/photos/<slug>): the slug is
  // always the last path segment.
  const parts = (event.path || '').split('?')[0].split('/').filter(Boolean);
  let slug = decodeURIComponent(parts[parts.length - 1] || '');
  if (slug === 'photos') slug = ''; // bare /photos with no slug

  const target = resolveSlug(slug);
  console.log('Photos hit:', slug, '→', target || 'UNKNOWN');

  return {
    statusCode: 302,
    headers: { Location: target || FALLBACK, 'Cache-Control': 'no-cache' },
    body: '',
  };
};
