# Crawler and indexing policy (frontend)

Source of truth: `apps/frontend/src/app/robots.ts`, `src/app/sitemap.ts`, `src/lib/seo/`. Verified by `pnpm --filter frontend seo:check`.

## Two separate controls

| Control | Decides | Used for |
| --- | --- | --- |
| `robots.txt` | whether a crawler may **fetch** a URL | AI-crawler policy, `/api/` |
| `noindex` (meta robots / `X-Robots-Tag`) | whether a fetched page may be **indexed** | every private and transactional route, all of staging |

Private routes are deliberately **not** disallowed in robots.txt. A crawler that cannot fetch a page never sees its `noindex`, and a blocked URL can still be indexed from external links. Each private route layout exports `PRIVATE_METADATA` (`noindex, nofollow`).

## Environments

Production is the default. A build is non-production only on a positive signal: `NODE_ENV=development`, `NEXT_PUBLIC_SITE_ENV` in `staging|preview|development|test`, or `NEXT_PUBLIC_SHOW_DEV_TOOLS=true` (what `docker-compose.staging.yml` passes). A non-production build serves `Disallow: /`, an empty sitemap, a noindex meta tag and `X-Robots-Tag: noindex, nofollow` on every response. The signal is read at build time, so the staging image must be built with it.

## Canonicals

The root layout sets no canonical. Each indexable page declares its own self-canonical; private pages have none. Indexable pages are listed in `src/lib/seo/public-pages.ts`, which also feeds the sitemap (`lastModified` is the real last content change, not the build time). Adding a public page means updating that registry and `EXPECTED_PUBLIC` in `scripts/seo-check.mjs`.

## AI crawlers

| Group | Agents | Rule | Why |
| --- | --- | --- | --- |
| Search / user-initiated retrieval | OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, DuckAssistBot, Applebot | allow `/`, disallow `/api/` | Surfaces and cites VerzChat in AI answers; fetches are on behalf of a user query. |
| Training / bulk collection | GPTBot, ClaudeBot, anthropic-ai, Claude-Web, Google-Extended, Applebot-Extended, CCBot, Bytespider, Amazonbot, meta-externalagent, cohere-ai, Diffbot, omgilibot | disallow `/` | Model training or dataset building; no referral benefit. |

- `Google-Extended` and `Applebot-Extended` are control tokens for AI training use. Blocking them does **not** affect Googlebot or Applebot search indexing. Googlebot gets no special group.
- **Verify before relying:** the user-agent names come from vendors' public documentation as known when written and were not re-checked against live vendor pages in this change. Vendors rename agents; review this list periodically.
- Production sits behind Cloudflare, which prepends its own managed robots block (it already blocks several training crawlers and adds a `Content-Signal` line, which Lighthouse reports as an unknown directive). Our rules are appended after it. Changing that is a Cloudflare setting, not an app change.
- robots.txt is advisory; it does not stop crawlers that ignore it.

## Known gaps needing infrastructure approval (not changed here)

- Production nginx sends `Cache-Control: no-store` on all frontend pages, which blocks back/forward cache and edge caching of marketing pages.
- `nginx.staging.conf` adds no `X-Robots-Tag`; staging relies on the app-level header.
- Search Console verification and sitemap submission have not been done and nothing here claims any ranking effect.
