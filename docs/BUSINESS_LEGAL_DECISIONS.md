# Business and legal decisions needed before release

Written 2026-11-02 for the owner. This document recommends; it does **not** change any plan, price, entitlement or legal text, and nothing here is legal advice. Items marked **[LEGAL]** need your lawyer; **[OWNER]** need you.

## 1. Free plan allowances and the marketing that contradicts them

| Fact (verified in `prisma/seed.ts`, code and UI) | Value |
|---|---|
| Free plan today | 1 agent, 1 channel, **0 templates, 0 campaigns** |
| What is enforced in code | agents and campaigns only (a Free workspace cannot create a campaign) |
| Starter plan (existing, for reference) | 2 agents, 3 templates, 3 campaigns |
| Sign-in page copy | "Broadcast campaigns to thousands at once" and "Shared team inbox with real-time updates" |
| Channels page, WhatsApp card | "Broadcast campaigns to thousands" |
| Billing screen | now shows "Not included" for a limit of 0 instead of a full `0 / 0` bar |

**Mismatch:** a new Free workspace is shown a promise of campaigns it is not allowed to use, and a "team inbox" with a single agent.
**Proposed Free allowances (yours, not mine): 2 agents, 3 templates, 3 campaigns.** Effects to weigh **[OWNER]**:
- It matches Starter's current numbers, so there would be no difference between Free and Starter on these three lines. Either Starter's allowances are raised or the plans are differentiated another way.
- Campaigns cost real WhatsApp conversation fees to the workspace owner, not to you, but abuse (spam) risk rises with free campaigns. Meta quality ratings are per number, so a spamming Free workspace harms only itself, but your support load rises.
- Nothing has been changed. If approved, apply it through the existing admin overrides (`PATCH plans/:id` or per-workspace `force-plan`) or a reviewed data migration, not code.
- **Do not advertise campaigns as working** until one real scheduled send has been observed (see `REAL_INTEGRATION_TEST_PLAN.md`, section 4).

Alternative that needs no allowance change: reword the sign-in and channel copy to describe only what Free includes.

## 2. Unused AI credits after closure, suspension or termination
What the code does today: credits are a balance on the workspace; they **do not expire** (only in-flight reservations expire). A suspended workspace cannot sign in or call the API, so its balance sits unused. The Terms say nothing about credits. There is a data-deletion page but I did not verify what it does to the balance.
Decisions **[OWNER + LEGAL]**:
1. Are purchased credits refundable on closure, never refundable, or refundable only on request within N days?
2. Do credits expire (for example 12 months after purchase)? If so this needs a code change and a clear notice at purchase; a retroactive expiry of balances already sold is a legal risk.
3. On suspension for breach, are credits forfeited or only frozen? Recommended: frozen, with forfeiture only if the Terms say so explicitly.
4. On closure at the customer's request, what happens to promotional (free trial) credits versus purchased credits?
5. Consumer-protection rules differ by country (Ghana and wherever customers live); this needs counsel, not a default.

## 3. Refund authority and take-rate clawback
See `COMMERCE_REFUND_DESIGN.md`, section 4 (D1 to D9). No refund can be started in the product today, so any promise of refunds to merchants or their customers is currently manual. Recommendation: do not promise in-product refunds until D1 to D5 are decided and the flow has been run in Paystack test mode.

## 4. Terms of Service: subscription and renewal language **[LEGAL]**
Current "Billing" section says: "Your subscription renews automatically at the start of each billing period. You can cancel anytime ... We don't offer refunds for partial months ... If a payment fails, we'll email you and give you 7 days ... before suspending the account."
Why it is stale: monthly subscriptions are no longer sold in the app (credits and Commerce fees instead), and the backend has a test that fails if a subscription price returns to a customer-facing screen. Any existing subscribers' real terms are not visible to me.
Proposed replacement for counsel to adapt (not published; I did not edit contract text):
> VerzChat is not sold as a monthly subscription. AI usage draws on prepaid credits that you buy in the app. Payments you take through VerzChat Commerce carry the platform fee shown in your workspace settings. Any subscription you already hold keeps the terms it was sold under until it ends. [Credits: expiry, refund and closure treatment per decision 2.]

Open points for counsel: whether any live customer is still on an auto-renewing plan (check `subscriptions` where status is active, read-only); the 14-day change-notice promise; the "no refunds for partial months" sentence if nothing renews.

## 5. Unsupported channel claims
| Channel | What actually works | Claim found | Action taken or proposed |
|---|---|---|---|
| WhatsApp Cloud API | send and receive | accurate | none |
| WhatsApp by QR | send and receive, unofficial | marketing page already flags it as not official | none |
| Facebook Messenger | send and receive | accurate | none |
| Instagram | code exists, **no inbound ever received in production** because the Meta app has no Instagram webhook subscription | listed as supported | Fix the Meta configuration and verify (plan section 3) before advertising; until then call it "connecting, not yet receiving" |
| Telegram | bot token can be connected and verified; backend does **not** receive or send messages | Terms listed it; Channels header promised it | **Corrected** in the Terms and the Channels header (this round). The Channels card text and the public site already say "coming soon" or omit it. |
| TikTok | account can be verified through login; messaging needs TikTok's own approval, not granted | Channels header promised it | **Corrected** (this round). Cards already state the limitation. |

Remaining wording to review **[OWNER]**: `changelog` entries that say Disconnect works for Telegram and TikTok are true but may read as "supported"; `ChannelType` also lists TWITTER, LINKEDIN and EMAIL with no implementation visible to customers (not verified this round).

## 6. Summary table of decisions
| # | Decision | Owner | Blocks release? |
|---|---|---|---|
| B1 | Free plan allowances (approve 2/3/3 or reword copy) | OWNER | No, but the copy mismatch should be fixed either way |
| B2 | Credit expiry / refund / closure treatment | OWNER + LEGAL | Yes if credits are sold to the public |
| B3 | Terms billing section rewrite | LEGAL | Yes |
| B4 | Refund authority, cost bearer, clawback (D1 to D9) | OWNER + finance | Yes only if in-product refunds are promised |
| B5 | Instagram: configure Meta, then verify | OWNER (Meta dashboard) | Only if Instagram is advertised |
| B6 | Remaining channel wording (changelog, TWITTER/LINKEDIN/EMAIL) | OWNER | No |
