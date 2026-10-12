/**
 * Vercel Serverless Function — 上游 API 代理
 * 用途：當瀏覽器直連上游被 CORS／網絡政策阻擋時作為回退通道；亦可集中做快取。
 * 安全：只允許白名單主機的 https GET 請求。
 */
const ALLOWED_HOSTS = new Set([
  'data.etabus.gov.hk',            // 九巴 / 龍運
  'rt.data.gov.hk',                // 城巴實時到站
  'routing.openstreetmap.de',      // OSRM 步行路線
  'nominatim.openstreetmap.org',   // 地理編碼
]);

const CACHE_TTL = {
  'data.etabus.gov.hk': 15,
  'rt.data.gov.hk': 15,
  'routing.openstreetmap.de': 3600,
  'nominatim.openstreetmap.org': 86400,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  const raw = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!raw) { res.status(400).json({ error: 'missing_url' }); return; }

  let target;
  try { target = new URL(raw); }
  catch { res.status(400).json({ error: 'invalid_url' }); return; }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    res.status(403).json({ error: 'host_not_allowed', host: target.hostname });
    return;
  }

  const ttl = CACHE_TTL[target.hostname] ?? 60;
  try {
    const upstream = await fetch(target.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'ChillBus/1.0 (+https://github.com/)' },
      signal: AbortSignal.timeout(14000),
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`);
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'upstream_failed', message: String((err && err.message) || err) });
  }
}
