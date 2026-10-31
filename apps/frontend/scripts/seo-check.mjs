#!/usr/bin/env node
/**
 * Crawls a RUNNING build of the frontend and checks the SEO requirements. No dependencies; Node 18+.
 *
 *   pnpm build && pnpm start &            # a production-mode build
 *   node scripts/seo-check.mjs --base http://localhost:3000 --mode production
 *
 *   NEXT_PUBLIC_SHOW_DEV_TOOLS=true pnpm build && pnpm start &   # a staging-mode build (what docker-compose.staging.yml builds)
 *   node scripts/seo-check.mjs --base http://localhost:3000 --mode staging
 *
 *   node scripts/seo-check.mjs --base http://localhost:3000 --mode wrong-host   # the PRODUCTION build, reached under a non-production Host
 *
 * Exit code 0 only if every check passed. `production` and `staging` need two separate builds: the staging switch is read at build time.
 * `wrong-host` runs against the production build and proves the host guard in src/middleware.ts holds when that switch is missing.
 * Requests in `production` mode send `Host: verzchat.com`, because the middleware treats every other Host as non-production.
 */
import { readdirSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BASE = (args.base ?? 'http://localhost:3000').replace(/\/$/, '');
const MODE = args.mode ?? 'production';
/** The Host sent with every request. Production mode pretends to be the real site; the other modes use whatever the base URL gives (localhost). */
let HOST = args.host ?? (MODE === 'production' ? 'verzchat.com' : MODE === 'wrong-host' ? 'staging.verzchat.com' : undefined);
const SITE = 'https://verzchat.com';
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app');

/** Must match src/lib/seo/public-pages.ts. A page added there must be added here on purpose: this list is the independent expectation. */
const EXPECTED_PUBLIC = ['/', '/book-demo', '/changelog', '/api-docs', '/data-deletion', '/terms', '/privacy', '/gdpr'];
/** Public pages that are indexable but deliberately not in the sitemap (a live dashboard, not content). */
const INDEXABLE_NOT_IN_SITEMAP = ['/status'];

/** Every page.tsx under src/app as a URL, with [param] filled in and route groups (parens) dropped. */
function discoverRoutes(dir = APP_DIR) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...discoverRoutes(full));
    else if (entry.name === 'page.tsx') {
      const segs = relative(APP_DIR, dir).split('/').filter((x) => x && !/^\(.*\)$/.test(x)).map((x) => x.replace(/^\[.+\]$/, 'test-value'));
      out.push('/' + segs.join('/'));
    }
  }
  return out;
}
/**
 * Every route in the app that is not a known public page must carry noindex. Discovering them from the filesystem means a NEW route cannot
 * silently ship indexable: it fails here until it is either made private or added to the public lists on purpose.
 */
const PUBLIC_ALL = new Set([...EXPECTED_PUBLIC, ...INDEXABLE_NOT_IN_SITEMAP]);
const PRIVATE = [...new Set(discoverRoutes())].filter((r) => !PUBLIC_ALL.has(r)).sort();
const TRAINING_CRAWLERS = ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'Amazonbot', 'meta-externalagent', 'cohere-ai', 'Diffbot', 'omgilibot'];
const SEARCH_CRAWLERS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'DuckAssistBot', 'Applebot'];

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok    ${name}`); } else { failures.push(`${name}${detail ? ` (${detail})` : ''}`); console.log(`  FAIL  ${name}${detail ? `  <- ${detail}` : ''}`); }
}
/**
 * GET over node:http, not fetch: fetch silently drops a custom Host header, and the host guard in middleware.ts depends on it.
 * Redirects are followed only within BASE, so the check never calls the real site.
 */
async function get(path, follow = true, hops = 0) {
  const u = new URL(BASE + path);
  const res = await new Promise((resolve, reject) => {
    const req = httpGet({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'user-agent': 'seo-check', ...(HOST ? { host: HOST } : {}) } }, (r) => {
      let body = ''; r.setEncoding('utf8'); r.on('data', (c) => (body += c)); r.on('end', () => resolve({ status: r.statusCode, headers: new Map(Object.entries(r.headers)), body }));
    });
    req.on('error', reject);
  });
  const loc = res.headers.get('location');
  if (follow && loc && [301, 302, 303, 307, 308].includes(res.status) && hops < 5) {
    const next = new URL(loc, BASE + path);
    if (next.origin === u.origin || next.hostname === (HOST ?? u.hostname)) return get(next.pathname + next.search, true, hops + 1);
  }
  return { ...res, headers: { get: (k) => res.headers.get(k.toLowerCase()) ?? null }, url: BASE + path };
}
const meta = (html, name) => (html.match(new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`, 'i')) ?? [])[1];
const canonicals = (html) => [...html.matchAll(/<link rel="canonical" href="([^"]*)"/gi)].map((m) => m[1]);
const robotsMeta = (html) => meta(html, 'robots');
/** Groups of a robots.txt as { agents: [...], rules: [[directive, value]] }. */
function parseRobots(text) {
  const groups = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) { cur = null; continue; }
    const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase(); const val = line.slice(i + 1).trim();
    if (key === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val); }
    else if (cur) cur.rules.push([key, val]);
  }
  return groups;
}
const groupFor = (groups, agent) => groups.find((g) => g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));

async function production() {
  console.log('\nrobots.txt');
  const robots = await get('/robots.txt');
  const groups = parseRobots(robots.body);
  const disallowed = groups.flatMap((g) => g.rules.filter(([k]) => k === 'disallow').map(([, v]) => v)).filter(Boolean);
  check('lists the production sitemap', robots.body.includes(`Sitemap: ${SITE}/sitemap.xml`));
  const generalDisallow = [...new Set(groupFor(groups, '*')?.rules.filter(([k]) => k === 'disallow').map(([, v]) => v))];
  check('general crawlers are blocked from /api/ only, so private routes stay crawlable and their noindex is readable', JSON.stringify(generalDisallow) === JSON.stringify(['/api/']), JSON.stringify(generalDisallow));
  const privateBlocked = groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules).filter(([k, v]) => k === 'disallow' && v && PRIVATE.some((p) => p.startsWith(v.replace(/\/$/, '')) && v !== '/api/'));
  check('no private page is disallowed for general crawlers', privateBlocked.length === 0, JSON.stringify(privateBlocked));
  for (const bot of TRAINING_CRAWLERS) check(`training crawler ${bot} is blocked`, groupFor(groups, bot)?.rules.some(([k, v]) => k === 'disallow' && v === '/'));
  for (const bot of SEARCH_CRAWLERS) check(`search crawler ${bot} is allowed`, groupFor(groups, bot)?.rules.some(([k, v]) => k === 'allow' && v === '/') && !groupFor(groups, bot)?.rules.some(([k, v]) => k === 'disallow' && v === '/'));
  check('Googlebot is not given its own restrictive group', !groupFor(groups, 'Googlebot'));

  console.log('\nsitemap.xml');
  const sm = await get('/sitemap.xml');
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expectedLocs = EXPECTED_PUBLIC.map((p) => (p === '/' ? SITE : SITE + p));
  check('lists exactly the intended public pages', JSON.stringify([...locs].sort()) === JSON.stringify([...expectedLocs].sort()), locs.join(' '));
  check('lists no private or transactional route', !locs.some((l) => PRIVATE.includes(new URL(l).pathname)));
  for (const l of locs) {
    const r = await get(new URL(l).pathname);
    check(`sitemap URL ${l}: 200, self-canonical, indexable`, r.status === 200 && JSON.stringify(canonicals(r.body)) === JSON.stringify([l]) && !/noindex/i.test(robotsMeta(r.body) ?? '') && !r.headers.get('x-robots-tag'), `${r.status} ${canonicals(r.body)} ${robotsMeta(r.body)} ${r.headers.get('x-robots-tag')}`);
  }
  const mods = [...sm.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  check('every URL has a lastmod', mods.length === locs.length);
  check('every lastmod is a real past date (not the build time)', mods.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d) <= new Date() && new Date(d) > new Date('2025-01-01')), mods.join(' '));
  check('lastmod dates are not all identical (they are not stamped with the build time)', new Set(mods).size > 1);
  check('no changefreq or priority (Google ignores them)', !/<changefreq>|<priority>/.test(sm.body));

  console.log('\npublic pages');
  for (const path of [...EXPECTED_PUBLIC, ...INDEXABLE_NOT_IN_SITEMAP]) {
    const r = await get(path);
    const want = path === '/' ? SITE : SITE + path;
    const h1 = (r.body.match(/<h1[ >]/g) ?? []).length;
    check(`${path}: 200, one canonical equal to ${want}`, r.status === 200 && JSON.stringify(canonicals(r.body)) === JSON.stringify([want]), `${r.status} ${canonicals(r.body).join(',')}`);
    check(`${path}: indexable (no noindex meta, no X-Robots-Tag)`, !/noindex/i.test(robotsMeta(r.body) ?? '') && !r.headers.get('x-robots-tag'));
    check(`${path}: title, description, og:image and twitter:image`, !!(r.body.match(/<title[^>]*>([^<]+)</) ?? [])[1] && !!meta(r.body, 'description') && !!meta(r.body, 'og:image') && !!meta(r.body, 'twitter:image'));
    check(`${path}: exactly one h1`, h1 === 1, `${h1} h1`);
  }
  const home = await get('/');
  check('homepage og:image is absolute and resolves to an image', (meta(home.body, 'og:image') ?? '').startsWith(SITE + '/opengraph-image') && (await get('/opengraph-image')).headers.get('content-type') === 'image/png');
  const viewport = meta(home.body, 'viewport') ?? '';
  check('homepage viewport allows zoom', !/user-scalable=no|maximum-scale=1(?!\d)/i.test(viewport), viewport);
  check('no x-powered-by header', !home.headers.get('x-powered-by'));

  console.log('\nprivate and transactional routes');
  for (const path of PRIVATE) {
    const r = await get(path);
    // A page that calls redirect() (e.g. /auth/login -> /login) answers 307 with a body that still carries the page's metadata, so noindex is read from it.
    const cs = canonicals(r.body);
    check(`${path}: ${r.status}, noindex, and no canonical to the homepage`, [200, 307].includes(r.status) && /noindex/i.test(robotsMeta(r.body) ?? '') && !cs.includes(SITE) && !cs.includes(SITE + '/') && cs.length === 0, `final ${r.url.replace(BASE, '')} ${r.status} robots=${robotsMeta(r.body)} canonical=${cs.join(',')}`);
  }
  await hostGuard();
  const nf = await get('/this-page-does-not-exist');
  check('unknown URL: real 404 with noindex', nf.status === 404 && /noindex/i.test(robotsMeta(nf.body) ?? ''));
}

/** Spellings of the production host that must stay indexable, and hosts that must be noindex. Each probe sends that exact Host. */
async function hostGuard() {
  console.log('\nhost guard');
  const probe = async (host) => { const save = HOST; HOST = host; try { return (await get('/privacy')).headers.get('x-robots-tag') ?? ''; } finally { HOST = save; } };
  for (const h of ['verzchat.com', 'VERZCHAT.COM', 'verzchat.com:443', 'verzchat.com.', 'www.verzchat.com']) check(`Host ${h}: no X-Robots-Tag`, (await probe(h)) === '');
  for (const h of ['staging.verzchat.com', 'app.verzchat.com', 'api.verzchat.com', 'preview.example.vercel.app', '203.0.113.7', 'localhost', 'verzchat.com.evil.example', 'notverzchat.com']) check(`Host ${h}: X-Robots-Tag noindex`, /noindex/i.test(await probe(h)));
}

async function wrongHost() {
  console.log(`\nproduction build reached as Host: ${HOST}`);
  for (const p of ['/', '/privacy', '/dashboard', '/robots.txt', '/sitemap.xml', '/this-page-does-not-exist']) {
    const h = (await get(p)).headers.get('x-robots-tag') ?? '';
    check(`${p}: X-Robots-Tag: noindex, nofollow from the host guard alone`, /noindex/i.test(h) && /nofollow/i.test(h), h || 'header missing');
  }
  const prod = await get('/', true);
  check('the build itself still looks like production (the guard, not the build switch, did this)', !/noindex/i.test(robotsMeta(prod.body) ?? ''));
}

async function staging() {
  console.log('\nnon-production build');
  const paths = ['/', '/privacy', '/dashboard', '/robots.txt', '/sitemap.xml', '/opengraph-image', '/this-page-does-not-exist'];
  for (const p of paths) {
    const r = await get(p);
    check(`${p}: X-Robots-Tag: noindex, nofollow`, /noindex/i.test(r.headers.get('x-robots-tag') ?? '') && /nofollow/i.test(r.headers.get('x-robots-tag') ?? ''), r.headers.get('x-robots-tag') ?? 'header missing');
  }
  const asset = (await get('/')).body.match(/\/_next\/static\/[^"']+\.(?:js|css)/)?.[0];
  if (asset) check('a static asset also carries it', /noindex/i.test((await get(asset)).headers.get('x-robots-tag') ?? ''));
  const robots = await get('/robots.txt');
  check('robots.txt disallows everything and advertises no sitemap', /Disallow: \/\s*$/m.test(robots.body) && !/Sitemap:/i.test(robots.body), robots.body.replace(/\n/g, ' | '));
  check('sitemap is empty', !/<loc>/.test((await get('/sitemap.xml')).body));
  check('pages carry a noindex meta tag as well', /noindex/i.test(robotsMeta((await get('/')).body) ?? '') && /noindex/i.test(robotsMeta((await get('/privacy')).body) ?? ''));
}

console.log(`SEO check against ${BASE} (${MODE} build)`);
try { await (MODE === 'staging' ? staging() : MODE === 'wrong-host' ? wrongHost() : production()); } catch (e) { failures.push(`crawl aborted: ${e.message}`); console.log(`  FAIL  crawl aborted: ${e.message}`); }
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('\nFailures:\n - ' + failures.join('\n - ')); process.exit(1); }
