/* Vercel serverless function: unique-device visitor counter.
   GET  /api/visit  -> { count, live }            (read the number)
   POST /api/visit  -> counts this device once    (the page sends POST only the first time a device opens it)
   Storage: Upstash Redis (free) added from Vercel → Storage / Marketplace. Env vars are injected automatically:
   KV_REST_API_URL + KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
   Optional env var COUNT_BASE = number to start from (default 3124). */
const crypto = require('crypto');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BASE = Number.isFinite(parseInt(process.env.COUNT_BASE, 10)) ? parseInt(process.env.COUNT_BASE, 10) : 3124;
const KEY = 'kd:users';
const MAX_PER_IP_PER_HOUR = 30;   // stops one source from inflating the number

async function redis(cmds) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!URL_ || !TOKEN) return res.status(200).json({ count: BASE, live: false });   // storage not connected yet
  try {
    let n;
    const ua = String(req.headers['user-agent'] || '');
    const seen = /(?:^|;\s*)kd_vid=/.test(String(req.headers.cookie || ''));
    const bot = !ua || /bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python|node-fetch/i.test(ua);
    if (req.method === 'POST' && !bot) {
      if (!seen) {
        const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
        const h = crypto.createHash('sha256').update(ip + '|kd').digest('hex').slice(0, 24);
        const k = 'kd:rl:' + h + ':' + Math.floor(Date.now() / 3.6e6);
        const [c] = await redis([['INCR', k], ['EXPIRE', k, '3600']]);
        if (c <= MAX_PER_IP_PER_HOUR) [n] = await redis([['INCR', KEY]]);
      }
      // remember this device for a year so a cleared localStorage does not count it twice
      res.setHeader('Set-Cookie', 'kd_vid=' + crypto.randomBytes(8).toString('hex') + '; Max-Age=31536000; Path=/; SameSite=Lax; HttpOnly; Secure');
    }
    if (n === undefined) [n] = await redis([['GET', KEY]]);
    return res.status(200).json({ count: BASE + (parseInt(n, 10) || 0), live: true });
  } catch (e) {
    return res.status(200).json({ count: BASE, live: false });
  }
};
