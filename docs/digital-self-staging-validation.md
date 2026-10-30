# Digital Self: staging validation

A repeatable check that two agents' Digital Selves change **how** Verz AI writes and nothing else. It needs a real model, so it
runs on **staging with a synthetic workspace**, never in CI and never against production or real customers.

## What it proves, and what it does not

It asks the same question as each of two agents (several runs each, every run in a fresh Test Chat conversation) and checks:

| Check | How |
| --- | --- |
| Styles are distinguishable | the two sets of replies differ on at least two of: length, energy, follow-up questions, emoji, formality |
| Facts are correct and nothing is invented | every required fact is present (prices compared by value, so `GH₵ 50.00` equals `GH₵50`), no forbidden phrase (for example "discount") appears, and any price in a reply that is not in the allowed list fails |
| Same tools and knowledge | the tool names recorded for both agents' executions match (skipped, not passed, if the executions API returns no trace) |
| Ownership and AI handling unchanged | `assignedTo` and `status` of the conversation are identical before assigning, after assigning, and after the reply |
| Missing or insufficient learning falls back | a conversation with no Digital Self, and (optionally) one with an under-trained Digital Self, still answer correctly |

It does **not** prove the style is "good", that a human would prefer it, or that anything beyond tone, length, emoji, greetings and
language is learned. Sales technique is not learned. Whether the neutral fallback is byte-identical to the old prompt is covered by
automated tests that need no model (`digital-self-pipeline.integration.spec.ts`), not by this procedure.

## Prerequisites (all on staging)

1. Staging runs this branch, and the reviewed migrations (`20261030120000_ai_digital_self`, `20261030130000_digital_self_learning_exclusion`)
   were applied there with the usual backup and restore rehearsal. **Nothing here applies a migration for you.**
2. A **synthetic workspace**: its name must contain `stage`, `staging`, `synthetic` or `test`. It needs Verz AI enabled, commerce on,
   and at least one product, for example a "Red Shirt" priced GH₵50. Note the exact name and price.
3. Three human agents in that workspace: A, B, and (optionally) C, whom you leave **un-seeded** as the "insufficient learning" case.
4. The `digital_self` feature flag enabled **for that workspace only** (feature-flags admin API/UI, `rolloutType: tenants`).
5. An admin JWT for that workspace (kept out of shell history and logs), and enough Test Chat allowance: `2 x RUNS + 2` messages.

## Steps

```bash
cd apps/backend

# 1. Give agents A and B invented history (learner is run directly; nothing is sent to any channel)
CONFIRM_SYNTHETIC_DATA=yes DATABASE_URL='<staging url>' SEED_TENANT_ID=<tenant> SEED_AGENT_A_ID=<A> SEED_AGENT_B_ID=<B> \
  pnpm digital-self:seed-synthetic          # 36 replies each by default; READY needs 30

# 2. Look at the Team page: A and B should be Ready with different style chips; C should say "Not enough of their own replies".

# 3. Validate
CONFIRM_SYNTHETIC_DATA=yes STAGING_API_URL=https://staging.verzchat.com:8443/api/v1 STAGING_TOKEN='<admin jwt>' \
  DS_A=<A digital self id> DS_B=<B digital self id> DS_INSUFFICIENT=<C digital self id> \
  QUESTION='How much is the red shirt?' MUST_CONTAIN='red shirt,GH₵50' ALLOWED_PRICES='GH₵50' MUST_NOT_CONTAIN='discount,free delivery' \
  REPORT_FILE=./ds-validation.json pnpm digital-self:validate

# 4. Clean up: removes the synthetic conversations AND what was learned from them
CONFIRM_SYNTHETIC_DATA=yes DATABASE_URL='<staging url>' SEED_TENANT_ID=<tenant> pnpm digital-self:seed-synthetic --cleanup
```

The Test Chat endpoint allows 3 sends per minute per user, so the validator spaces its sends about 21 seconds apart (a default run takes
roughly 3 minutes) and, if it is still refused with HTTP 429, waits the time the server asks for and retries. If the workspace's
daily test allowance (200 requests by default) is used up it stops and says so rather than waiting until tomorrow.

The validator only needs HTTPS access to the staging API, so it can run from any machine that has this repository, not only inside the
backend container. On macOS (zsh, whose `read` syntax differs from bash):

```bash
cd apps/backend && read -rs "TOKEN?Paste token: "; echo; CONFIRM_SYNTHETIC_DATA=yes STAGING_API_URL=https://staging.verzchat.com:8443/api/v1 STAGING_TOKEN="$TOKEN" DS_A=<id> DS_B=<id> QUESTION='How much is the red shirt?' MUST_CONTAIN='red shirt,GH₵50' ALLOWED_PRICES='GH₵50' MUST_NOT_CONTAIN='discount,free delivery' RUNS=3 REPORT_FILE=./ds-validation.json pnpm digital-self:validate; unset TOKEN
```

Digital Self ids are on the Team page (and in `GET /digital-self`). The validator refuses any host that is not `staging.*`, `localhost`
or `127.0.0.1`, refuses to run without `CONFIRM_SYNTHETIC_DATA=yes`, never prints the token, and never echoes response bodies.
`pnpm digital-self:seed-synthetic` refuses a workspace whose name does not look synthetic.

## Reading the result

`PASS` / `FAIL` / `SKIPPED` per check, exit code 0 only if nothing failed. **Read the saved replies** (`REPORT_FILE`) yourself as well:
the metrics catch an invented price or a missing fact, not an awkward or off-brand sentence. A `SKIPPED` check is a manual check.
Because model output varies, a failure on "distinguishable" should be re-run once before being treated as a defect; a failure on
facts, ownership or invented prices should not be waved away.

## Credentials this needs

A model provider key configured on **staging** (already how the Test Chat works) and an admin token for the synthetic workspace. The
offline logic is covered by `staging-validation.spec.ts` (a fake API, no network, no credentials).
