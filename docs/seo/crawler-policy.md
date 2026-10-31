# Crawler and indexing policy (frontend)

Source of truth: `apps/frontend/src/app/robots.ts`, `src/app/sitemap.ts`, `src/lib/seo/`. Verified by `pnpm --filter frontend seo:check`.

## Two separate controls

| Control | Decides | Used for |
| --- | --- | --- |
| `robots.txt` | whether a crawler may **fetch** a URL | AI-crawler policy, `/api/` |
| `noindex` (meta robots / `X-Robots-Tag`) | whether a fetched page may be **indexed** | every private and transactional route, all of staging |

Private routes are deliberately **not** disallowed in robots.txt. A crawler that cannot fetch a page never sees its `noindex`, and a blocked URL can still be indexed from external links. Each private route layout exports `PRIVATE_METADATA` (`noindex, nofollow`).

## Environments

Two independent guards keep non-production out of search:

1. **Build switch** (below): robots.txt `Disallow: /`, empty sitemap, noindex meta and `X-Robots-Tag` on every response.
2. **Host guard** (`middleware.ts`): any request whose Host is not `verzchat.com` / `www.verzchat.com` gets `X-Robots-Tag: noindex, nofollow`, even if the build switch is missing. It only ever adds noindex. Any new production hostname must be added to `PRODUCTION_HOSTS` in `src/lib/seo/site.ts`, or it will be served noindex. Hostnames reviewed: nginx serves only `verzchat.com`, `www.verzchat.com` (301 to the apex) and `staging.verzchat.com`. `app.verzchat.com` and `api.verzchat.com` appear only as a code fallback and in the API docs; nginx has no server block for them, and if one is ever added for the signed-in app it should stay noindex, so they are deliberately not listed. Host matching ignores case, a port and a trailing dot. After deploying, confirm `curl -sI https://verzchat.com/ | grep -i x-robots-tag` prints nothing.

The build switch:

Production is the default. A build is non-production only on a positive signal: `NODE_ENV=development`, `NEXT_PUBLIC_SITE_ENV` in `staging|preview|development|test`, or `NEXT_PUBLIC_SHOW_DEV_TOOLS=true` (what `docker-compose.staging.yml` passes). A non-production build serves `Disallow: /`, an empty sitemap, a noindex meta tag and `X-Robots-Tag: noindex, nofollow` on every response. The signal is read at build time, so the staging image must be built with it.

## Canonicals

The root layout sets no canonical. Each indexable page declares its own self-canonical; private pages have none. Indexable pages are listed in `src/lib/seo/public-pages.ts`, which also feeds the sitemap (`lastModified` is the real last content change, not the build time). Adding a public page means updating that registry and `EXPECTED_PUBLIC` in `scripts/seo-check.mjs`.

## AI crawlers

| Group | Agents | Rule | Why |
| --- | --- | --- | --- |
| Search / user-initiated retrieval | OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, DuckAssistBot, Applebot | allow `/`, disallow `/api/` | Surfaces and cites VerzChat in AI answers; fetches are on behalf of a user query. |
| Training / bulk collection | GPTBot, ClaudeBot, anthropic-ai, Claude-Web, Google-Extended, Applebot-Extended, CCBot, Bytespider, Amazonbot, meta-externalagent, cohere-ai, Diffbot, omgilibot | disallow `/` | Model training or dataset building; no referral benefit. |

- `Google-Extended` has no user agent of its own; it is a robots.txt token. Google states it controls use of crawled content for Gemini training and grounding and "does not impact a site's inclusion in Google Search nor is it used as a ranking signal". Googlebot gets no special group.
- `Applebot-Extended` only governs how data Applebot already crawled may be used (training); Apple states it is not a ranking input. Apple also says Applebot data may inform AI answers, which only `nosnippet` limits.
- **User-initiated agents may ignore robots.txt.** OpenAI says rules "may not apply" to `ChatGPT-User`; Perplexity says `Perplexity-User` generally ignores them. Their `allow` lines document intent and cost nothing; they are not enforcement. Meta's `meta-externalfetcher` bypasses robots.txt and is not listed.
- **Verification (2026-10-31, vendor pages fetched):** OpenAI (OAI-SearchBot, GPTBot, ChatGPT-User), Anthropic (ClaudeBot, Claude-User, Claude-SearchBot), Perplexity (PerplexityBot, Perplexity-User), Apple (Applebot, Applebot-Extended), Google (Google-Extended), Amazon (Amazonbot), Meta (meta-externalagent) and Common Crawl (CCBot) names match their current documentation. **Not confirmed on a vendor page:** `anthropic-ai` and `Claude-Web` (absent from Anthropic's current help page; kept because blocking an unused token is harmless), `DuckAssistBot`, `Bytespider`, `cohere-ai`, `Diffbot`, `omgilibot`. Amazon also documents `Amzn-SearchBot` (Alexa search eligibility), which is not listed and so falls under the general rule; add it if that visibility is wanted.
- Production sits behind Cloudflare, which prepends its own managed robots block (it already blocks several training crawlers and adds a `Content-Signal` line, which Lighthouse reports as an unknown directive). Our rules are appended after it. Changing that is a Cloudflare setting, not an app change.
- robots.txt is advisory; it does not stop crawlers that ignore it.

## Known gaps needing infrastructure approval (not changed here)

- Production nginx sends `Cache-Control: no-store` on all frontend pages, which blocks back/forward cache and edge caching of marketing pages.
- `nginx.staging.conf` adds no `X-Robots-Tag`; staging relies on the app-level header.
- Search Console verification and sitemap submission have not been done and nothing here claims any ranking effect.
