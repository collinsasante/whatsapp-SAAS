# VerzChat SEO Keyword Map

Working document for Phase 3 content architecture. Every keyword here was checked
against actual product capabilities (backend modules, live Pricing component) before
being assigned to a page — see `apps/frontend/src/lib/seo.ts` for the shared metadata
helper used to implement these.

## How to read this

- **Cluster**: a group of related search intent, mapped to one page (never split one
  cluster across multiple pages — that causes keyword cannibalization).
- **Primary keyword**: the single phrase the page's `<title>`/H1 is built around.
- **Supporting keywords**: used in body copy, subheadings, and `keywords` metadata —
  not stuffed, just covered naturally where they fit.
- **Intent**: what the searcher wants, so content answers it instead of just
  mentioning the keyword.

## Feature landing pages

| Cluster | Page | Primary keyword | Supporting keywords | Intent | Backing feature |
|---|---|---|---|---|---|
| Shared inbox | `/shared-inbox` | shared WhatsApp inbox | WhatsApp team inbox, multiple agents one WhatsApp number, WhatsApp business inbox for teams | Commercial — evaluating tools for team WhatsApp access | `apps/backend/src/conversations`, multi-agent access |
| Broadcast messaging | `/whatsapp-broadcasts` | WhatsApp broadcast messaging | WhatsApp bulk messages, WhatsApp business API broadcast, send WhatsApp campaigns | Commercial — needs to message many customers at once | `apps/backend/src/campaigns` |
| CRM / contact management | `/whatsapp-crm` | WhatsApp CRM | WhatsApp contact management, CRM for WhatsApp business, customer conversation history WhatsApp | Commercial — wants conversation + contact history in one place | `apps/backend/src/contacts` |
| Chatbot automation | `/whatsapp-chatbot` | WhatsApp chatbot | WhatsApp automation, WhatsApp auto reply, WhatsApp business chatbot builder | Commercial — wants to automate replies/routing | `apps/backend/src/chatbot-flows`, `apps/backend/src/automation` |

## Existing pages (already covered in Phase 2)

| Page | Primary keyword | Notes |
|---|---|---|
| `/` | WhatsApp business inbox for teams | Sitewide Organization/WebSite/SoftwareApplication schema lives here |
| `/faq` | VerzChat FAQ | FAQPage schema, targets long-tail question queries |
| `/book-demo` | WhatsApp business demo | Bottom-of-funnel conversion page |
| `/contact-us` | contact VerzChat | Low search volume, kept for trust/NAP signals |

## Blog content (Phase 3)

Informational, top-of-funnel content that funnels into the feature pages above via
internal links. Each post targets a cluster's informational-intent keywords (the
"how / what / why" queries the commercial feature page doesn't answer directly).

| Post | Target keyword | Links to |
|---|---|---|
| "How to Set Up a Shared WhatsApp Inbox for Your Team" | how to share one WhatsApp number with a team | `/shared-inbox` |
| "WhatsApp Broadcast Messages: Rules, Limits, and Best Practices" | WhatsApp broadcast message rules | `/whatsapp-broadcasts` |
| "WhatsApp CRM vs Traditional CRM: What's Actually Different" | WhatsApp CRM vs CRM | `/whatsapp-crm` |

**Next content priority (not yet written)**: a post targeting the chatbot/automation
cluster (e.g. "WhatsApp Auto-Reply: How Business Automation Actually Works") to give
`/whatsapp-chatbot` the same informational-content support the other three clusters
have. See `docs/seo-checklist.md` for the full backlog.

## Local relevance

VerzChat's real pricing already localizes to Ghana (₵ pricing via `GHS_RATE` in
`Pricing.tsx`). Feature pages and blog posts should mention Ghana/West Africa
business contexts where natural (e.g. mobile money adoption, WhatsApp being the
dominant business channel), but must not fabricate location-specific claims not
backed by the product (no fake local office addresses, no NAP schema — VerzChat is
remote-first with no physical storefront, so `LocalBusiness` schema is intentionally
not used; `Organization` schema is the correct type).

## Rejected/deferred clusters

- **"MoMo payments on WhatsApp"** — considered per the original content brief, but
  rejected after checking the codebase: Mobile Money (via Paystack) is only used for
  VerzChat's own subscription billing (`apps/backend/src/billing/gateways/paystack.gateway.ts`),
  not as a customer-facing feature for VerzChat users to collect payments from their
  own customers over WhatsApp. Building a page claiming this capability would be a
  false claim. Revisit only if that feature actually ships.
