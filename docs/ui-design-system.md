# UI consistency audit and design system (phase 1)

Status: audit and proposal. No product UI was changed in this phase.

## What exists today

Measured from `apps/frontend/src` (counts of Tailwind colour utilities, `h1` sizes and radii per area):

| Finding | Evidence |
| --- | --- |
| **The product's real brand colour is teal**, used directly as `teal-*` in every signed-in area (inbox 267 uses, contacts 180, manage 112, AI 94, campaigns 93, billing 67). | The `brand` token in `tailwind.config.js` is green and is not what the product uses. |
| **Competing accents** appear inside single pages: green, emerald, blue, indigo, violet, purple, sky, cyan (campaigns uses 6 of them). | Same meaning shown in different colours, e.g. success as `green` in campaigns, `emerald` in channels and calls. |
| **Page titles have no scale.** Signed-in `h1` sizes in use: `2xl` (Analytics, Dashboard, channels), `xl` (billing, settings, contacts, templates, automation), `lg` (AI, library, commerce, tasks), `base` (manage). | Four sizes for the same role. |
| **Corner radii are mixed** on the same screen: `rounded-lg`, `-xl`, `-2xl`, `-3xl`. | Campaigns: 15 / 66 / 11. |
| **The marketing site is a separate system.** New landing uses its own CSS variables, hex palette (about 33 hex values) and Bricolage Grotesque; legal and book-demo still use the older landing components and about 59 hex values. | Product uses Inter. |
| **Emoji used as icons** in a few places (chatbot 56, shared components 24, inbox 21). | The product icon library is lucide-react. |
| **Hard-coded hex colours** in places that should use tokens (inbox 14, manage 23, charts 26, platform-admin 47). | |
| **Shared UI is thin.** `components/ui` has a confirm modal, a dropdown and pricing and payment pieces. There is no shared button, input, card, badge, page header or empty state; each page defines its own. | The Analytics `ui.tsx` (Section, Panel, EmptyNote, Skeleton, DeltaView) is the best candidate to promote. |
| **Dark mode is done by global class remapping** in `globals.css` (`.dark .bg-white` etc.), not by tokens. | It works but any new colour that is not in the remap list breaks in dark mode. |
| **Many pages are single large files** (campaigns, contacts, manage, chatbot), so a shared component rollout has to be done page by page. | |

## Decisions proposed

1. **Primary colour: teal 600** (hover 700, tint 50, text 700). It is already what users see in the product. The unused green `brand` token is repointed to teal so `brand-*` becomes the one name for it. The marketing site keeps its own display font and layout but takes the same primary and neutral values.
2. **Semantic colours, one each:** success = green, warning = amber, danger = red, info = blue, AI = purple. These are the hues the dark-mode remap in `globals.css` already covers; rose, sky, violet, emerald, indigo and cyan are not covered, so they are not used for status. Charts use teal, slate, amber and purple in that order.
3. **Type scale:** page title `text-2xl font-semibold`; section heading `text-lg font-semibold`; card heading `text-base font-semibold`; body `text-sm`; helper `text-xs text-gray-500`; metric `text-3xl font-semibold tabular-nums`. Inter throughout the product.
4. **Radius:** controls (buttons, inputs, badges) `rounded-lg`; cards and panels `rounded-xl`; dialogs `rounded-2xl`. `rounded-3xl` is removed.
5. **Spacing:** page padding `p-4 sm:p-6`, content width `max-w-[1280px]` except the inbox, section gap `space-y-6`, card padding `p-4 sm:p-5`.
6. **Icons:** lucide-react only, 16px in buttons and nav, 20px in headers, stroke 2. Emoji icons are replaced where they act as UI icons (not where they are user content).
7. **Dark mode:** keep the class remap for now, and move new tokens to CSS variables so it can be retired page by page.

## Shared components to create (in order of value)

`PageHeader` (title, description, actions), `Button` (primary, secondary, danger, icon), `Card`, `StatusBadge`, `EmptyState`, `Skeleton`, `FormField` (label, input, error), `DataTable` (density, mobile card layout), then promote `Section`, `Panel`, `DeltaBadge` and `InfoTip` out of `components/analytics/ui.tsx`.

## Rollout, one branch per step, each with browser checks at 320, 390, 768, 1024 and 1440 px

1. Tokens and `PageHeader`, `Button`, `Card`, `StatusBadge`, `EmptyState`; adopt them in Dashboard and Analytics.
2. App shell: sidebar, account menu, mobile navigation, active state for nested routes.
3. Inbox-adjacent pages: contacts, templates, library, tasks.
4. Campaigns, automation, chatbot, AI.
5. Billing, settings, account, channels, onboarding, authentication.
6. Platform admin (it already has its own `components/admin`, so this is mostly token alignment).
7. Marketing: legal pages and book-demo moved onto the new marketing layout.

## Risks and constraints

- Colour changes in 20+ large files are easy to get subtly wrong (status colours changing meaning), so each step is reviewed in a browser, not only type-checked.
- The frontend has no automated UI tests and no ESLint configuration, so verification is manual and Playwright-driven.
- The inbox and chat window are intentionally excluded from layout standardisation; they only take tokens.
- **Steps 2 to 5 (done):** shell active state and accessibility; one status palette (green, amber, red, blue, purple) with dark-mode shades; signed-in pages moved onto it. Chatbot node colours and Channels provider colours are deliberate exceptions.
- **Step 6 (done):** platform admin moved onto the same palette. The legal pages and Book a demo use the marketing header and footer (links now point to `/#section` so they work from any page); the old landing navbar, footer and `landing.css` are deleted. The `bootstrap` dependency is now unused and can be removed in a separate change that updates the lockfile.
- **Still open:** card corner radii vary between pages; dark mode is only verified on the Dashboard; tablet widths are unchecked.
