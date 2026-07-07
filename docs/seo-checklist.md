# VerzChat SEO Checklist & Maintenance

Companion to `docs/seo-keyword-map.md`. Covers Search Console setup and the
recurring maintenance this SEO work needs to keep paying off.

## 1. Google Search Console setup (one-time, manual)

1. Go to [Google Search Console](https://search.google.com/search-console) and add
   `https://verzchat.com` as a **URL-prefix property** (not Domain property — the
   site is single-host, no need for the DNS-verification flow that requires).
2. Choose the **HTML tag** verification method. Copy just the `content="..."` value
   from the tag Google shows you.
3. Set it as an environment variable on the frontend deploy:
   ```
   GOOGLE_SITE_VERIFICATION=<paste the content value here>
   ```
   This is read in `apps/frontend/src/app/layout.tsx` — the tag is only emitted
   when the env var is set, so nothing ships until you do this step.
4. Redeploy the frontend (env-var-only change — see the deploy notes in the repo
   for whether that needs a full `up -d` or just a restart for your environment).
5. Back in Search Console, click **Verify**.
6. Once verified, go to **Sitemaps** in the left nav and submit:
   ```
   https://verzchat.com/sitemap.xml
   ```
7. Repeat steps 1-6 for Bing Webmaster Tools if you want Bing/DuckDuckGo coverage
   (Bing supports importing directly from a verified Google Search Console
   property, which is faster than re-verifying from scratch).

## 2. What to check in Search Console (first 2 weeks)

- **Coverage / Pages report** — confirm all public pages (landing, `/faq`,
  `/contact-us`, `/book-demo`, `/shared-inbox`, `/whatsapp-broadcasts`,
  `/whatsapp-crm`, `/whatsapp-chatbot`, `/blog` and its posts, legal pages) show as
  **Indexed**, and every `/dashboard`, `/platform-admin`, auth route etc. is
  correctly **Excluded by robots.txt** (not "Discovered — currently not indexed",
  which would mean robots.txt isn't blocking it as intended).
- **Enhancements → Breadcrumbs / FAQ** — confirm the JSON-LD is being parsed
  without errors. If a schema type shows 0 valid items, run the affected page's
  HTML through [Google's Rich Results Test](https://search.google.com/test/rich-results).
- **Core Web Vitals** — should reflect the LCP fix (see before/after numbers in
  the PR description). Watch for regressions if new above-the-fold sections are
  added later without checking `data-aos` usage (see the comment in `Hero.tsx`).

## 3. Recurring maintenance

| Task | Frequency | Notes |
|---|---|---|
| Check Search Console Coverage + Core Web Vitals | Monthly | Catch indexing regressions or new 404s early |
| Bump `sitemap.ts`'s `lastModified` when a static page's content meaningfully changes | Per change | Blog posts already carry their own real dates — only the static-page constant needs manual bumping |
| Re-run Lighthouse on `/` and any page with new above-the-fold content | Per above-the-fold change | Specifically re-check for new `data-aos` on first-viewport elements |
| Re-check pricing/feature claims in `llms.txt`, `index.md`, and marketing copy against `Pricing.tsx` | Whenever pricing/plan limits change | This drifted out of sync once already (see Phase 3 fixes) — it's the single most likely thing to go stale |
| Validate JSON-LD after adding any new page | Per new page | [Rich Results Test](https://search.google.com/test/rich-results) — confirm `@id` references resolve to something real instead of dangling |
| Review `robots.ts`'s `DISALLOWED_PREFIXES` | When adding a new authenticated route | New app routes must be added here or they'll be crawlable |

## 4. Content backlog (not yet built)

Prioritized roughly by effort vs. expected value:

1. **Blog post for the chatbot/automation cluster** — the other 3 feature pages
   (`/shared-inbox`, `/whatsapp-broadcasts`, `/whatsapp-crm`) each have a
   supporting blog post; `/whatsapp-chatbot` doesn't yet. Suggested angle:
   "WhatsApp Auto-Reply: How Business Automation Actually Works."
2. **FAQPage schema for the homepage's own FAQ section** — `BottomCTA.tsx`
   renders a real, unique FAQ accordion on the home page, but it currently has
   no `FAQPage` JSON-LD (only `/faq` does). Low effort, real rich-result upside.
3. **A 5th feature page if a genuinely new capability ships** — the "MoMo
   payments on WhatsApp" idea was rejected this round because the capability
   doesn't exist yet (see `docs/seo-keyword-map.md`'s "Rejected/deferred
   clusters" section). Revisit if that ships.
4. **Real per-page `lastModified` dates for static pages** — `sitemap.ts` still
   uses one build-time constant for non-blog pages. Wiring this to actual git
   history or a CMS timestamp is more accurate but wasn't worth the complexity
   for a handful of rarely-changing pages this round.
5. **Bing Webmaster Tools verification** — see step 7 above, not done as part of
   this work since it depends on the Google Search Console verification landing
   first.

## 5. What NOT to do

- Don't add more feature pages without checking the target capability actually
  exists in the codebase first (see the keyword map's rejected-clusters note —
  this already caught one false claim before it shipped).
- Don't reintroduce `data-aos` on above-the-fold content — it's the exact
  regression that caused the original 35s LCP (see `Hero.tsx`'s inline comment).
- Don't hardcode pricing numbers in new marketing copy — link to `/#pricing` or
  the feature pages instead, so a future plan change doesn't require hunting
  down every place a dollar amount was typed by hand.
