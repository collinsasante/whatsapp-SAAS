// Runs inside a node container that is also the upstream: it answers on 3000/3001/3002 (frontend, backend, realtime) by echoing what it received.
const http = require('http');
const os = require('os');
const MODE = process.env.MODE || 'headers';
const ownIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal).address;
const results = [];
const note = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} - ${name}${ok ? '' : '  -- ' + detail}`); };

for (const port of [3000, 3001, 3002]) {
  http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ port, url: req.url, headers: req.headers, peer: req.socket.remoteAddress }));
  }).listen(port, '0.0.0.0');
}

const get = (host, path, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host, port: 80, path, method: 'GET', headers, agent: false }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j, raw: b, headers: res.headers }); });
  });
  r.on('error', reject); r.end();
});
const statuses = async (host, path, n, headersFor) => { const out = []; for (let i = 0; i < n; i++) out.push((await get(host, path, headersFor ? headersFor(i) : {})).status); return out; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const STRICT = process.env.STRICT, TRUST = process.env.TRUST;
  await sleep(300);

  if (MODE === 'headers') {
  // ---- 1. an untrusted peer (any direct connection) cannot choose its address
  const spoof = { 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '5.6.7.8, 9.9.9.9', 'X-Real-IP': '6.6.6.6', 'True-Client-IP': '7.7.7.7', Forwarded: 'for=8.8.8.8' };
  const r1 = await get(STRICT, '/api/v1/ping', spoof);
  const peer = ownIp; // nginx's view of this client; the upstream's own "peer" would be nginx itself
  const h = (r1.body && r1.body.headers) || {};
  note('untrusted peer: upstream sees the TCP peer, not a spoofed X-Real-IP', h['x-real-ip'] !== '6.6.6.6' && h['x-real-ip'] !== '1.2.3.4' && h['x-real-ip'] !== undefined, JSON.stringify(h['x-real-ip']));
  note('untrusted peer: X-Forwarded-For is exactly one address (the peer); the spoofed prefix is gone', h['x-forwarded-for'] === h['x-real-ip'] && !/[,]/.test(h['x-forwarded-for'] || ','), h['x-forwarded-for']);
  note('untrusted peer: CF-Connecting-IP and True-Client-IP never reach the backend', h['cf-connecting-ip'] === undefined && h['true-client-ip'] === undefined, JSON.stringify([h['cf-connecting-ip'], h['true-client-ip']]));
  note('untrusted peer: the address the backend sees is the real peer address', h['x-real-ip'] === peer, `${h['x-real-ip']} vs ${peer}`);
  note('proxy protocol hint is set per listener (http on 80)', h['x-forwarded-proto'] === 'http', h['x-forwarded-proto']);

  // ---- 2. the same holds on every proxied location
  for (const path of ['/', '/api/v1/auth/login', '/api/v1/webhook/telegram/x', '/socket.io/?EIO=4', '/storage/a.png', '/_next/static/chunks/a.js']) {
    const r = await get(STRICT, path, spoof); const hh = (r.body && r.body.headers) || {};
    note(`untrusted peer, ${path}: forwarded address is the peer`, r.status === 200 && (!hh['x-forwarded-for'] || hh['x-forwarded-for'] === peer || hh['x-forwarded-for'] === hh['x-real-ip']) && hh['x-real-ip'] !== '6.6.6.6', `status ${r.status} xff=${hh['x-forwarded-for']} real=${hh['x-real-ip']}`);
  }

  // ---- 4. behind a trusted proxy (harness-only trusted range), the header IS the client address and buckets are per client
  const t1 = await get(TRUST, '/api/v1/ping', { 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '10.1.1.1, 10.2.2.2' });
  const th = (t1.body && t1.body.headers) || {};
  note('trusted proxy: the backend sees the CF-Connecting-IP address, once', th['x-real-ip'] === '203.0.113.7' && th['x-forwarded-for'] === '203.0.113.7', JSON.stringify([th['x-real-ip'], th['x-forwarded-for']]));
  note('trusted proxy: a spoofed X-Forwarded-For prefix is discarded', !/10\.1\.1\.1|10\.2\.2\.2/.test(th['x-forwarded-for'] || ''), th['x-forwarded-for']);
  }
  if (MODE === 'limits') {
  // ---- 3. rate limits cannot be dodged by rotating spoofed headers (strict config: nothing is trusted)
  const rot = (i) => ({ 'CF-Connecting-IP': `198.51.100.${i % 250}`, 'X-Forwarded-For': `203.0.113.${i % 250}` });
  // With fresh state a client gets the burst plus one request immediately (a tick of refill at 10r/m is one per 6 s, so allow one extra).
  const boundary = (st, burst) => { const firstBlocked = st.indexOf(429); return firstBlocked === burst + 1 || firstBlocked === burst + 2; };
  let s = await statuses(STRICT, '/api/v1/auth/login', 16, rot);
  note('auth limit (10r/m, burst 10): requests beyond the burst are 429 even while rotating spoofed addresses', boundary(s, 10) && s.slice(s.indexOf(429)).every((x) => x === 429), JSON.stringify(s));
  const r429 = await get(STRICT, '/api/v1/auth/login', rot(99));
  note('limited requests answer 429, not 503', r429.status === 429, String(r429.status));
  s = await statuses(STRICT, '/api/v1/webhook/telegram/y', 58, rot);
  note('webhook limit (100r/m, burst 50): requests beyond the burst are 429', boundary(s, 50) && s.slice(s.indexOf(429)).every((x) => x === 429), JSON.stringify(s.slice(48, 56)));
  s = await statuses(STRICT, '/api/v1/conversations', 70, rot);
  note('api limit (120r/m, burst 60): requests beyond the burst are 429', boundary(s, 60) && s.slice(s.indexOf(429)).every((x) => x === 429), JSON.stringify(s.slice(58, 66)));
  const other = await get(STRICT, '/health');
  note('/health is not rate limited and answers locally', other.status === 200 && /staging-ok/.test(other.raw), other.raw);

  s = await statuses(TRUST, '/api/v1/auth/login', 16, () => ({ 'CF-Connecting-IP': '203.0.113.50' }));
  note('trusted proxy: one visitor is limited at the same threshold', boundary(s, 10), JSON.stringify(s));
  s = await statuses(TRUST, '/api/v1/auth/login', 30, (i) => ({ 'CF-Connecting-IP': `203.0.113.${100 + i}` }));
  note('trusted proxy: different visitors do not share a bucket (one visitor cannot lock out another)', s.every((x) => x === 200), JSON.stringify(s));
  const bad = await get(TRUST, '/api/v1/ping', { 'CF-Connecting-IP': 'not-an-ip' });
  note('trusted proxy: a malformed CF-Connecting-IP falls back to the peer and does not break the request', bad.status === 200, String(bad.status));

  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.log('FAIL - driver error', e.message); process.exit(1); });
