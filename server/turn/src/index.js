// WOS · TURN credentials Worker (Cloudflare Workers, free plan).
// Hands the game short-lived Cloudflare TURN credentials, so the long-term TURN key never appears in
// the public game code. Secrets (set with `npx wrangler secret put`): TURN_KEY_ID, TURN_KEY_API_TOKEN.
//
// GET /  -> { iceServers: [...], ttl }   (only for the allowed origins below)

const ALLOWED_ORIGINS = [
  'https://jay15963.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const TTL = 6 * 3600; // seconds; longer than a play session

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), {
  status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const headers = cors(allowed ? origin : ALLOWED_ORIGINS[0]);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!allowed) return json({ error: 'origem não permitida' }, 403, headers);
    if (request.method !== 'GET') return json({ error: 'método não permitido' }, 405, headers);
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      return json({ error: 'Worker sem as chaves: rode `npx wrangler secret put TURN_KEY_ID` e `TURN_KEY_API_TOKEN`' }, 500, headers);
    }
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }),
    });
    if (!res.ok) return json({ error: 'a Cloudflare recusou gerar credenciais', status: res.status }, 502, headers);
    const data = await res.json();
    // drop port-53 URLs (they often time out in browsers)
    const iceServers = (data.iceServers || [])
      .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    return json({ iceServers, ttl: TTL }, 200, headers);
  },
};
