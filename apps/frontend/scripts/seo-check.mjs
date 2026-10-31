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
 * Exit code 0 only if every check passed. The two modes must be run against two separate builds: the staging switch is read at build time.
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BASE = (args.base ?? 'http://localhost:3000').replace(/\/$/, '');
const MODE = args.mode ?? 'production';
const SITE = 'https://verzchat.com';

/** Must match src/lib/seo/public-pages.ts. A page added there must be added here on purpose: this list is the independent expectation. */
const EXPECTED_PUBLIC = ['/', '/book-demo', '/changelog', '/api-docs', '/data-deletion', '/terms', '/privacy', '/gdpr'];
/** Every route that must carry noindex. Includes every folder of the signed-in app and every transactional page. */
const PRIVATE = [
  '/dashboard', '/inbox', '/contacts', '/campaigns', '/settings', '/ai', '/ai-pending', '/ai-test', '/analytics', '/automation', '/billing', '/calls',
  '/channels', '/chatbot', '/commerce', '/library', '/manage', '/tasks', '/templates', '/account', '/platform-admin', '/pay/test-reference',
  '/reset-password', '/verify-email', '/onboarding', '/login', '/register', '/forgot-password', '/join/test-token', '/auth/login', '/auth/register', '/auth/callback',
];
const TRAINING_CRAWLERS = ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'Amazonbot', 'meta-externalagent', 'cohere-ai', 'Diffbot', 'omgilibot'];
const SEARCH_CRAWLERS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'DuckAssistBot', 'Applebot'];

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok    ${name}`); } else { failures.push(`${name}${detail ? ` (${detail})` : ''}`); console.log(`  FAIL  ${name}${detail ? `  <- ${detail}` : ''}`); }
}
async function get(path, follow = true) {
  const res = await fetch(BASE + path, { redirect: follow ? 'follow' : 'manual', headers: { 'user-agent': 'seo-check' } });
  return { status: res.status, headers: res.headers, body: await res.text(), url: res.url };
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
  check('blocks only /api/ for general crawlers, so private routes can be crawled and their noindex read', JSON.stringify([...new Set(groupFor(groups, '*')?.rules.filter(([k]) => k === 'disallow').map(([, v]) => v))]) === JSON.stringify(['/api/']), JSON.stringify(groupFor(groups, '*')?.rules));
  check('no private path is disallowed anywhere', !PRIVATE.some((p) => disallowed.some((d) => d !== '/' && p.startsWith(d.replace(/\/$/, '') + '') && d.length > 1 && !d.startsWith('/api'))), disallowed.join(' '));
  for (const bot of TRAINING_CRAWLERS) check(`training crawler ${bot} is blocked`, groupFor(groups, bot)?.rules.some(([k, v]) => k === 'disallow' && v === '/'));
  for (const bot of SEARCH_CRAWLERS) check(`search crawler ${bot} is allowed`, groupFor(groups, bot)?.rules.some(([k, v]) => k === 'allow' && v === '/') && !groupFor(groups, bot)?.rules.some(([k, v]) => k === 'disallow' && v === '/'));
  check('Googlebot is not given its own restrictive group', !groupFor(groups, 'Googlebot'));

  console.log('\nsitemap.xml');
  const sm = await get('/sitemap.xml');
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expectedLocs = EXPECTED_PUBLIC.map((p) => (p === '/' ? SITE : SITE + p));
  check('lists exactly the intended public pages', JSON.stringify([...locs].sort()) === JSON.stringify([...expectedLocs].sort()), locs.join(' '));
  check('lists no private or transactional route', !locs.some((l) => PRIVATE.some((p) => l.endsWith(p))));
  const mods = [...sm.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  check('every URL has a lastmod', mods.length === locs.length);
  check('every lastmod is a real past date (not the build time)', mods.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d) <= new Date() && new Date(d) > new Date('2025-01-01')), mods.join(' '));
  check('lastmod dates are not all identical (they are not stamped with the build time)', new Set(mods).size > 1);
  check('no changefreq or priority (Google ignores them)', !/<changefreq>|<priority>/.test(sm.body));

  console.log('\npublic pages');
  for (const path of EXPECTED_PUBLIC) {
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
    const cs = canonicals(r.body);
    check(`${path}: noindex, and no canonical to the homepage`, /noindex/i.test(robotsMeta(r.body) ?? '') && !cs.includes(SITE) && !cs.includes(SITE + '/') && cs.length === 0, `final ${r.url.replace(BASE, '')} ${r.status} robots=${robotsMeta(r.body)} canonical=${cs.join(',')}`);
  }
  const nf = await get('/this-page-does-not-exist');
  check('unknown URL: real 404 with noindex', nf.status === 404 && /noindex/i.test(robotsMeta(nf.body) ?? ''));
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
try { await (MODE === 'staging' ? staging() : production()); } catch (e) { failures.push(`crawl aborted: ${e.message}`); console.log(`  FAIL  crawl aborted: ${e.message}`); }
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('\nFailures:\n - ' + failures.join('\n - ')); process.exit(1); }
