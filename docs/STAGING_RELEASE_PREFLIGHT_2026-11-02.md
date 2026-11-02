# Staging release preflight (2026-11-02)

**Read UPDATE 4 (consolidated plan) first, then UPDATE 3 and UPDATE 2. The first preflight (further below) was read-only; UPDATE 2 includes code, Compose and script fixes, still uncommitted.**

Original scope: read-only preflight. No code or configuration was changed, no branch or commit was created, nothing was pushed or deployed, and neither staging nor production was contacted. Facts come from the local worktree and from earlier read-only captures in `~/verz-hybrid-rag-validation/`. Anything about the live staging server is marked **UNVERIFIED** because I cannot reach it.


---

# UPDATE 5: FINAL RELEASE COMMIT PREPARATION (preparation only; nothing staged or committed)

Scope of this pass: reconfirm state, make the ten path lists exact, define the hunk-level and manual-review items, and prepare a temporary-index procedure and a per-commit verification script **for review**. Nothing was staged (not even into a temporary index apart from dry runs), nothing committed, no branch or ref created, no file changed except this document and the learning report. Neither script below has been run against real commits (none exist). Staging and production not contacted; no secret values.

## 5.1 Reconfirmed state (FACT)
| Item | Value |
|---|---|
| Branch / HEAD | `feature/ai-no-canned-replies` / `d5f93b9f8c1e88a3243858fef5ae1cc3ac0819d8` |
| Entries | 188 (116 modified, 68 untracked entries = 105 untracked files, 4 staged deletions) |
| Staged | the four deletions: `ai-core/prompts/escalation-messages.util.ts`, `site/Pricing.module.css`, `site/Pricing.tsx`, `ui/pricing-cards.tsx` (**correction to UPDATE 4:** one of the four is an AI-pipeline file, not a pricing file, so the deletions split across two commits: 1 in commit 8, 3 in commit 5) |
| Stash | 1, unchanged (`stash@{2026-07-06}`, unrelated) |
| Real index fingerprint | `git ls-files --stage | md5` = `c0c7eb46da08` before and after this pass |
| Restored migration | `cmp` clean against `git show 5ba3e99:...`; sha256 `d1061534a1a7481e3da1fdf7425ce8d43af22b2a3e943b4acf44deb4f2002d79` for both; not present at HEAD, so it appears in commit 1 as an addition |

## 5.2 Exact path lists (VERIFIED by dry run)
Method: every changed path (225: 116 modified + 105 untracked + 4 staged deletions) was assigned to exactly one commit by rule; the lists were then compressed to directory pathspecs where a whole directory belongs to one commit. A temporary index (`GIT_INDEX_FILE`, built from HEAD with `read-tree`, which writes only the temp file) was used with `git add -A -n` (dry run, writes nothing): for every commit the pathspecs select **exactly** the assigned paths (0 extra, 0 missing), the ten selections are disjoint, and together they cover all 225 paths. The real index fingerprint was identical afterwards.

Two files appear in **no** list as whole files because they need hunk or manual treatment (5.3): `apps/backend/src/messages/messages.service.ts` and `apps/backend/src/manage/settings/manage-settings.service.ts`. They are counted in commit 8's list (the commit that completes them); commits 2 and 5 insert prepared versions of them (5.4).
<details><summary>The ten lists (pathspecs; a trailing slash is a directory that belongs wholly to that commit)</summary>

**Commit 1** (1 paths): chore(db): restore applied migration 20260708120000_verz_ai_grounded_retrieval
```
apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql
```

**Commit 2** (52 paths): fix(security): fail closed on internal secrets and webhooks; isolate tenants and realtime; block SSRF and path traversal
```
apps/backend/src/common/security/
apps/backend/src/tenant/
apps/realtime/
apps/whatsapp-web/
apps/backend/src/billing/gateways/stripe.gateway.ts
apps/backend/src/campaigns/worker-backend-url.spec.ts
apps/backend/src/common/guards/internal-api-key.guard.spec.ts
apps/backend/src/common/guards/internal-api-key.guard.ts
apps/backend/src/config/validate-production-secrets.spec.ts
apps/backend/src/config/validate-production-secrets.ts
apps/backend/src/contacts/contacts.service.ts
apps/backend/src/inbound/inbound.controller.spec.ts
apps/backend/src/inbound/inbound.controller.ts
apps/backend/src/knowledge-base/public-file-fetch.spec.ts
apps/backend/src/knowledge-base/public-page-fetch.ts
apps/backend/src/main.ts
apps/backend/src/manage/settings/dto/settings.dto.ts
apps/backend/src/manage/settings/manage-settings.controller.internal-secret.spec.ts
apps/backend/src/manage/settings/manage-settings.controller.ts
apps/backend/src/manage/settings/manage-settings.mass-assignment.spec.ts
apps/backend/src/media/media.controller.ts
apps/backend/src/media/storage.service.ts
apps/backend/src/messages/link-preview.controller.spec.ts
apps/backend/src/messages/link-preview.controller.ts
apps/backend/src/platform-admin/platform-admin-auth.service.ts
apps/backend/src/platform-admin/platform-admin.role-matrix.spec.ts
apps/backend/src/realtime/realtime.service.ts
apps/backend/src/tenant-isolation.db.spec.ts
apps/backend/src/whatsapp/whatsapp.webhook.controller.spec.ts
apps/backend/src/whatsapp/whatsapp.webhook.controller.ts
apps/worker/src/lib/backend-url.ts
apps/worker/src/processors/ai-trial.processor.ts
apps/worker/src/processors/automation.processor.ts
apps/worker/src/processors/billing-cron.processor.ts
apps/worker/src/processors/sla-monitor.processor.ts
apps/worker/src/processors/snooze.processor.ts
```

**Commit 3** (11 paths): fix(payments): verify amount, currency, reference and order state before any financial change
```
apps/backend/src/commerce/ledger/
apps/backend/src/billing/billing-webhook.controller.spec.ts
apps/backend/src/billing/billing-webhook.controller.ts
apps/backend/src/billing/billing-webhook.payment-integrity.spec.ts
apps/backend/src/commerce/webhooks/commerce-webhook.controller.ts
apps/backend/src/commerce/webhooks/commerce-webhook.payment-integrity.spec.ts
apps/backend/src/common/payments/payment-match.util.spec.ts
apps/backend/src/common/payments/payment-match.util.ts
apps/worker/src/processors/commerce-reconciliation.processor.ts
```

**Commit 4** (6 paths): feat(campaigns): consume scheduled campaigns and settle every campaign outcome
```
apps/backend/src/campaigns/campaign-send.worker.spec.ts
apps/backend/src/campaigns/campaigns.module.ts
apps/backend/src/campaigns/campaigns.scheduling.spec.ts
apps/backend/src/campaigns/campaigns.service.ts
apps/backend/src/campaigns/scheduled-campaign.processor.ts
apps/worker/src/processors/campaign-send.processor.ts
```

**Commit 5** (38 paths): feat(billing): remove monthly subscription sales from customer screens and copy
```
apps/frontend/
apps/mobile/
apps/backend/src/billing/billing.controller.ts
apps/backend/src/billing/billing.service.checkout.spec.ts
apps/backend/src/billing/billing.service.subscription-sales.spec.ts
apps/backend/src/billing/billing.service.ts
apps/backend/src/billing/subscription-pricing-removal.spec.ts
apps/backend/src/billing/subscription-sales-routes.spec.ts
apps/backend/src/billing/subscription-sales.util.spec.ts
apps/backend/src/billing/subscription-sales.util.ts
apps/backend/src/manage/settings/manage-settings.service.subscriptions.spec.ts
apps/backend/src/users/users.service.ts
packages/api/src/endpoints/billing.ts
```

**Commit 6** (33 paths): feat(rag): hybrid retrieval modules, pgvector image and design notes (nothing wired)
```
apps/backend/src/knowledge-base/rag/
docs/VERZAI_V2_HYBRID_RAG.md
infra/postgres/Dockerfile
```

**Commit 7** (2 paths): docs(legal): third-party notice for the local embedding model (provenance review open)
```
apps/backend/third-party/all-MiniLM-L6-v2/LICENSE
apps/backend/third-party/all-MiniLM-L6-v2/NOTICE.md
```

**Commit 8** (61 paths): feat(ai): no canned replies, structured replies, escalation, refusal, legacy retirement; wire hybrid retrieval (flag off)
```
apps/backend/src/ai-core/
apps/backend/src/ai-logs/
apps/backend/src/commerce/evaluation/
apps/backend/package.json
apps/backend/scripts/legacy-retirement-readiness.ts
apps/backend/src/ai/ai-responder.service.ts
apps/backend/src/app.boot.spec.ts
apps/backend/src/commerce/ai/commerce-ai.service.spec.ts
apps/backend/src/commerce/ai/commerce-ai.service.ts
apps/backend/src/knowledge-base/knowledge-base.service.ts
apps/backend/src/manage/settings/manage-settings.service.personality.spec.ts
apps/backend/src/manage/settings/manage-settings.service.ts
apps/backend/src/messages/messages.service.spec.ts
apps/backend/src/messages/messages.service.ts
```

**Commit 9** (14 paths): chore(infra): staging deploy contract, restore rehearsal image, required settings, release verification
```
infra/scripts/
infra/.env.example
infra/.env.staging.example
infra/docker-compose.staging.yml
infra/docker-compose.yml
```

**Commit 10** (7 paths): docs: release audit, remediation, refund design, integration test plan, business decisions, staging preflight, learning architecture
```
docs/BUSINESS_LEGAL_DECISIONS.md
docs/COMMERCE_REFUND_DESIGN.md
docs/DIGITAL_SELF_LEARNING_ARCHITECTURE.md
docs/REAL_INTEGRATION_TEST_PLAN.md
docs/RELEASE_BLOCKER_REMEDIATION_2026-11-02.md
docs/RELEASE_READINESS_2026-11-02.md
docs/STAGING_RELEASE_PREFLIGHT_2026-11-02.md
```

</details>

## 5.3 Mixed-purpose and manual-review files
| File | Treatment | Status |
|---|---|---|
| `messages/messages.service.ts` (34 hunks) | Hunks **1 and 7** (the `fetchPublicFile` import and the media-URL download) belong to commit 2; the other 32 to commit 8. Mechanical | VERIFIED: an offset-aware application of the chosen hunks to the HEAD content succeeds, and all 34 hunks rebuild the working-tree file byte-for-byte |
| `manage/settings/manage-settings.service.ts` (22 hunks) | Hunks **2-11** (the field whitelist helper and the `pick()` calls) are commit 2 and apply mechanically (VERIFIED the same way). Hunk 1 (an import cleanup), hunks **15-22** (`approveAi` no longer requires a paid plan or credits; email text) are commit 5. Hunks **12-14, 16-17** (default-agent personality sync, `select` of `aiPersonality`, `const saved`) are commit 8. **Hunks 13-18 are physically interleaved**: the closing brace of `updateAi`, the new `syncDefaultAgentPersonality` method and the rewritten `approveAi` share the same lines | **MANUAL REVIEW REQUIRED.** The intermediate version for commit 5 must be hand-composed from three sources and checked by `tsc` plus its specs. Fallbacks if you prefer not to hand-compose: (a) put the whole file and its two specs (`...personality.spec.ts`, `...subscriptions.spec.ts`) in commit 2, accepting a product change inside the security commit; (b) put the whole file in commit 5 and accept that commit 2's mass-assignment spec cannot pass at commit 2 |
| `(dashboard)/ai/page.tsx` | Assigned to commit 5: its change is the zero-credit activation message that pairs with the `approveAi` change. Judgment call | confirm |
| `(legal)/terms/page.tsx`, `(dashboard)/channels/page.tsx` | Both commit 5 (subscription wording and the Telegram/TikTok wording are both customer-facing copy). Judgment call | confirm |
| `infra/docker-compose.yml` (production) | Commit 9, **only** the `INTERNAL_SECRET` pass-through; named in the message | confirm |
| `docs/VERZAI_V2_HYBRID_RAG.md` | Commit 6 (it documents the modules added there) rather than commit 10 | confirm |
| Specs placed by what they test | `manage-settings.service.subscriptions.spec.ts` to 5, `...personality.spec.ts` to 8, `...mass-assignment.spec.ts` to 2, `credit-governed-ai.spec.ts` to 8 (imports the final `manage-settings.service.ts`) | follows the file decision above |
Everything else is single-purpose by path. No file is unassignable; only the manual item above carries risk.

## 5.4 Dependencies and required tests per commit
Standard gate for every commit: `apps/backend` `npx tsc --noEmit` and `npx jest --silent`. Extra gates:

| # | Depends on | Extra required tests | Notes |
|---|---|---|---|
| 1 | none | `cmp` against `5ba3e99`; migration folder count; fresh `prisma migrate deploy` | |
| 2 | 1 | worker `tsc`; `apps/realtime` `npm test` (10); `apps/whatsapp-web` `npm test` (32); security specs (guard, internal-secret, mass-assignment, role matrix, link-preview, storage-key, public-file-fetch, inbound, whatsapp webhook, validate-production-secrets, tenant onboarding); the database tenant-isolation suite when a disposable DB is available | commit 2 carries prepared versions of `messages.service.ts` (A) and `manage-settings.service.ts` (A) |
| 3 | 2 (soft: `stripe.gateway.ts`) | payment-match, ledger, take-rate, webhook integrity, billing webhook specs; worker `tsc` | |
| 4 | 2 | campaigns specs (50); worker `tsc` | `app.boot.spec.ts` is **not** here (commit 8) |
| 5 | 2 (soft) | billing/subscription specs; frontend and mobile `tsc`; `manage-settings` subscriptions spec | carries prepared `manage-settings.service.ts` (B) and the three pricing deletions |
| 6 | 1 | rag specs (fusion, retriever, indexer, chunker, flags, reranker, tokenizer, loader, vector-store); must compile alone | pgvector DB suite when available |
| 7 | none | none (documentation) | removable without touching code |
| 8 | 4 (boot spec), 6 (`retrieval-trace`), 2 and 5 (soft) | all ai-core pipeline/prompt/quality/refusal specs, commerce-ai, messages, ai-logs sandbox, hybrid regression (10), boot spec; frontend `tsc` | completes both mixed files; carries the `escalation-messages.util.ts` deletion |
| 9 | none functionally | every `infra/scripts/tests/*.test.sh` | hybrid Compose change **not** included (UPDATE 4 section 4.2) |
| 10 | none | secret/IP scan of the documents | |
Final gate (once, on the tip): `infra/scripts/verify-release-candidate.sh <tip SHA>`.

## 5.5 Temporary-index procedure (FOR REVIEW; do not run until you authorise)
Principle: commits are built **from HEAD** in a temporary index with `git commit-tree` onto a **preparation ref**. The real index (with the four staged deletions), the real branch and the working tree are never touched during preparation. Because the temp index starts from HEAD, the staged deletions cannot leak into commit 1.
```bash
set -euo pipefail
cd /Users/breezyyy/verz-worktrees/no-canned-replies
BASE=$(git rev-parse HEAD)
# safety: remember the real index (copy only) and its fingerprint
REAL_INDEX=$(git rev-parse --git-path index); cp "$REAL_INDEX" "$(mktemp -d)/index.backup"
git ls-files --stage | md5 > /tmp/real-index.before            # expect c0c7eb46da08
# temp index, built from HEAD (not from the real index)
WORK=$(mktemp -d); export GIT_INDEX_FILE=$WORK/index; git read-tree HEAD
PARENT=$BASE
stage()        { git add -A -- "$@"; }                                           # normal whole-file staging
put_version()  { blob=$(git hash-object -w "$2"); git update-index --add --cacheinfo "100644,$blob,$1"; }   # temp index only
commit_step()  { tree=$(git write-tree); PARENT=$(git commit-tree "$tree" -p "$PARENT" -F "$1"); echo "commit: $PARENT"; }
# mixed-file versions are produced by the hunk script in 5.6 into $WORK/versions/
# commit 1:  stage <list 1>;  commit_step msg-01.txt
# commit 2:  stage <list 2>;  put_version apps/backend/src/messages/messages.service.ts   $WORK/versions/messages.A
#                             put_version apps/backend/src/manage/settings/manage-settings.service.ts $WORK/versions/manage-settings.A ; commit_step msg-02.txt
# commit 3,4: stage <list>;  commit_step ...
# commit 5:  stage <list 5>;  put_version ...manage-settings.service.ts $WORK/versions/manage-settings.B   # B = hand-composed, see 5.3
# commit 6,7: stage <list>
# commit 8:  stage <list 8>   # includes both mixed files in their final (working-tree) form and the escalation-messages deletion
# commit 9,10: stage <list>
# tree-equality gate: the tip must equal the working tree exactly (this is what proves nothing was lost or invented)
GIT_INDEX_FILE=$WORK/check git add -A && [ "$(GIT_INDEX_FILE=$WORK/check git write-tree)" = "$(git rev-parse "$PARENT^{tree}")" ]
git update-ref refs/prep/release-candidate "$PARENT" ""            # a ref under refs/prep only; NOT the feature branch
unset GIT_INDEX_FILE
git ls-files --stage | md5 | diff - /tmp/real-index.before && echo "real index unchanged"
```
Stop here until the verification (5.6) passes on `refs/prep/release-candidate`.

**Moving the real branch and index is a separate, later approval** (and the only step that touches the real index): `git update-ref refs/heads/feature/ai-no-canned-replies "$TIP" "$BASE"` (compare-and-swap) and then bring the real index to the new tip with `git read-tree "$TIP"`; the worktree is already identical to the tip, so the tree ends clean and the four staged deletions are now committed (3 in commit 5, 1 in commit 8). Undo: `git update-ref refs/heads/feature/ai-no-canned-replies "$BASE" "$TIP"`, restore the saved `index.backup`. The stash and all working files are untouched in both directions.
Side effects of preparation, for honesty: `hash-object -w`, `write-tree` and `commit-tree` add objects to `.git/objects` (unreachable until the prep ref exists; removable by `git gc`), and the prep ref is one new ref. No branch is created.

### Hunk script for the mixed files (FOR REVIEW)
Validated logic: parse `git diff -U0` hunks, apply a selected subset to the HEAD content with running offsets, write the result under `$WORK/versions/`. `messages.A` = hunks {1,7}; `manage-settings.A` = hunks {2..11}; `manage-settings.B` is composed by hand (5.3). Self-check: applying all hunks must equal the working-tree file.
```python
import re, subprocess, sys
def sh(c): return subprocess.run(c, shell=True, capture_output=True, text=True, check=True).stdout
def parse(f):
    hs, cur = [], None
    for l in sh(f"git diff -U0 -- '{f}'").split('\n'):
        m = re.match(r'^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@', l)
        if m: cur = {'os': int(m[1]), 'oc': int(m[2]) if m[2] is not None else 1, 'minus': [], 'plus': []}; hs.append(cur)
        elif cur is not None and l.startswith('-') and not l.startswith('---'): cur['minus'].append(l[1:])
        elif cur is not None and l.startswith('+') and not l.startswith('+++'): cur['plus'].append(l[1:])
    return hs
def apply(base, hs, sel):
    lines, off = base.split('\n'), 0
    for i, h in enumerate(hs, 1):
        if i not in sel: continue
        s = (h['os'] - 1 if h['oc'] > 0 else h['os']) + off
        assert lines[s:s + h['oc']] == h['minus'], f'hunk {i} does not match its base'
        lines[s:s + h['oc']] = h['plus']; off += len(h['plus']) - h['oc']
    return '\n'.join(lines)
# usage: python hunks.py <path> <comma-separated hunk numbers> <out file>
f, sel, out = sys.argv[1], {int(x) for x in sys.argv[2].split(',')}, sys.argv[3]
base, hs = sh(f"git show HEAD:'{f}'"), parse(f)
assert apply(base, hs, set(range(1, len(hs) + 1))) == open(f).read(), 'all hunks must rebuild the working-tree file'
open(out, 'w').write(apply(base, hs, sel))
```

## 5.6 Per-commit verification script (FOR REVIEW; run only on `refs/prep/release-candidate`)
Never touches the real index, branch or working tree: each commit is checked out into a throwaway linked worktree (adds metadata under `.git/worktrees`, removed at the end) with the repository's `node_modules` symlinked in. Caveat: workspace packages resolve to the main tree's `packages/*` through those links, so a commit that changes `packages/api` (commit 5) is checked against the final package sources; acceptable because that package change is isolated to commit 5.
```bash
#!/usr/bin/env bash
set -uo pipefail
BASE=${1:?base sha}; TIP=${2:-refs/prep/release-candidate}; ROOT=$(git rev-parse --show-toplevel); OUT=$(mktemp -d); FAIL=0; N=0
link_deps() { ln -s "$ROOT/node_modules" "$1/node_modules" 2>/dev/null
  for d in apps/backend apps/frontend apps/mobile apps/worker apps/realtime apps/whatsapp-web packages/shared-types packages/shared-utils packages/api; do
    [ -d "$ROOT/$d/node_modules" ] && [ -d "$1/$d" ] && ln -s "$ROOT/$d/node_modules" "$1/$d/node_modules"
    [ -d "$ROOT/$d/dist" ] && [ -d "$1/$d" ] && [ ! -e "$1/$d/dist" ] && ln -s "$ROOT/$d/dist" "$1/$d/dist"
  done; true; }
gate() { local name=$1; shift; if "$@" >"$OUT/$N-$name.log" 2>&1; then echo "  PASS $name"; else echo "  FAIL $name  (log: $OUT/$N-$name.log)"; FAIL=1; fi; }
for sha in $(git rev-list --reverse "$BASE..$TIP"); do
  N=$((N+1)); W=$(mktemp -d); git worktree add --detach "$W" "$sha" >/dev/null 2>&1; link_deps "$W"
  echo "commit $N  $(git log -1 --format=%s "$sha" | cut -c1-90)"
  gate backend-tsc  bash -c "cd '$W/apps/backend' && npx tsc --noEmit"
  gate backend-jest bash -c "cd '$W/apps/backend' && npx jest --silent"
  case $N in
    1) gate migration-identical bash -c "cmp <(git show 5ba3e99:apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql) '$W/apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql'" ;;
    2) gate worker-tsc bash -c "cd '$W/apps/worker' && npx tsc --noEmit"
       gate realtime-tests bash -c "cd '$W/apps/realtime' && npm test"
       gate whatsapp-web-tests bash -c "cd '$W/apps/whatsapp-web' && npm test" ;;
    3|4) gate worker-tsc bash -c "cd '$W/apps/worker' && npx tsc --noEmit" ;;
    5|8) gate frontend-tsc bash -c "cd '$W/apps/frontend' && npx tsc --noEmit"
         gate mobile-tsc bash -c "cd '$W/apps/mobile' && npx tsc --noEmit" ;;
    9) for t in "$W"/infra/scripts/tests/*.test.sh; do gate "$(basename "$t")" bash "$t"; done ;;
  esac
  git worktree remove --force "$W" >/dev/null 2>&1
done
echo "tree equality with the working tree:"
T=$(mktemp -d); GIT_INDEX_FILE=$T/i git add -A && [ "$(GIT_INDEX_FILE=$T/i git write-tree)" = "$(git rev-parse "$TIP^{tree}")" ] && echo "  PASS" || { echo "  FAIL"; FAIL=1; }
echo "logs: $OUT"; exit $FAIL
```
`bash -n` was run on neither script. They are text for your review; no node_modules link behaviour has been exercised here.

## 5.7 Readiness for explicit authorisation
**Release commit preparation is ready for explicit authorisation**, on these terms:
1. Authorise building the ten commits on `refs/prep/release-candidate` through a temporary index (nothing else moves).
2. Decide the manual item first: hand-compose `manage-settings.service.ts` version B (recommended, verified by `tsc` plus its specs at commit 5), or take fallback (a) or (b) in 5.3.
3. Confirm the judgment placements in 5.3 (`ai/page.tsx`, terms/channels pages, production Compose line, the hybrid design document).
4. Moving the real branch and refreshing the real index is a **separate** later approval.
This does **not** make the release deployable: hybrid-RAG live evidence, the Compose strategy (a later commit), staging secrets and the Meta/Paystack acceptance prerequisites remain open (UPDATE 4).

---

# UPDATE 4: CONSOLIDATED RELEASE PLAN

Planning only. Between this update and UPDATE 3 nothing in the repository other than this document and `DIGITAL_SELF_LEARNING_ARCHITECTURE.md` changed. Verified at the start of this pass: branch `feature/ai-no-canned-replies`, HEAD `d5f93b9`, 188 uncommitted entries (the earlier 187 plus the learning report), 4 staged deletions, 1 pre-existing stash, restored migration still byte-identical to `5ba3e99`, no leftover containers. No commit, push, merge or deployment; staging and production not contacted; no secret values.

Convention in this update: **FACT** (verified earlier, cited), **ADOPTED** (recommendation I am treating as the plan unless you object), **DECISION** (needs your approval), **OPERATOR** (needs evidence or action outside this repository).

## 4.0 Status at a glance
| Item | Status |
|---|---|
| Commit sequence | ADOPTED below (ten commits, AI and hybrid wiring combined); needs DECISION on authorising index handling and local commits |
| Hybrid-RAG preservation | **UNRESOLVED**: strategy ADOPTED, but live-state evidence from the operator is missing, so it cannot be called resolved |
| MiniLM notice | ADOPTED: separate, droppable commit; legal question remains open, not blocking staging |
| Production Compose | ADOPTED: separate remediation, outside this release |
| External prerequisites | consolidated in 4.5; none beyond Tier 0 is needed to claim the application deploys |
| Deployment readiness | **NOT CLAIMED.** No committed candidate exists; hybrid evidence and staging prerequisites are open |

## 4.1 Final commit sequence

### Facts that fix the shape (from the import analysis in UPDATE 3 section 5, not re-run)
1. The only hard (new-file) dependencies between groups are: the AI changes import `knowledge-base/rag/retrieval-trace.ts` (hybrid, new file) from `pipeline.types.ts`; `ai-core.module.ts` imports the new refusal service (AI group) and the new hybrid providers; `app.boot.spec.ts` imports the new `campaigns/scheduled-campaign.processor.ts`; the worker-URL spec imports the new `lib/backend-url.ts`.
2. Six shared pipeline files carry hunks from both the AI work and the hybrid wiring: `ai-core.module.ts`, `pipeline.types.ts`, `context-assembly.stage.ts` (+spec), `generation.stage.ts` (+spec), `tool-calling.execution-record.spec.ts` (7 hunks).
3. `hybrid-knowledge-context.source.ts` and `knowledge-source.providers.ts` import the **modified** `knowledge-context.source.ts`, so they belong with the wiring, not with the additive rag modules.
4. The four staged deletions are already in the index. A plain `git commit` for commit 1 would sweep them in.

### Decision: combine the AI changes and the hybrid wiring (ADOPTED)
Splitting them needs hunk-level separation of six shared files with no dependency-free order. Combining removes that risk entirely and costs only commit granularity. The additive hybrid modules (all new files, nothing wired) stay separate, so the large reviewable unit is still small.

### The sequence (ten commits on `feature/ai-no-canned-replies`)
| # | Commit | Exact file groups | Depends on | Hunk-level files |
|---|---|---|---|---|
| 1 | `chore(db): restore applied migration 20260708120000_verz_ai_grounded_retrieval` | `apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/` | none | none. Message states provenance: copied byte-for-byte from `5ba3e99` (branch `feature/verz-ai-grounded-reply-engine`), sha256 `d1061534...2d79`, already applied on staging and production, additive only |
| 2 | `fix(security): fail closed on internal secrets and webhooks; isolate tenants and realtime; block SSRF and path traversal` | internal-auth in backend/realtime/whatsapp-web; `common/security/**`, `common/guards/*`; `config/validate-production-secrets*`, `main.ts`, `stripe.gateway.ts` (lazy client); inbound, whatsapp webhook; media (`media.controller.ts`, `storage.service.ts`); `link-preview*`; `knowledge-base/public-page-fetch.ts` and `public-file-fetch.spec.ts`; manage-settings DTOs, controller, whitelisting and specs; tenant onboarding DTO and specs; `contacts.service.ts`; platform-admin auth and role-matrix spec; `tenant-isolation.db.spec.ts`; `realtime/**` (src, tests, package.json, tsconfig.test.json); `whatsapp-web/src/*`; worker `lib/backend-url.ts`, `worker-backend-url.spec.ts` and the `ai-trial`, `billing-cron`, `snooze`, `sla-monitor`, `automation` processors | 1 | `manage/settings/manage-settings.service.ts` (22 hunks: whitelisting `pick()` here; personality hunks go to 8; subscription hunks to 5); `messages/messages.service.ts` and its spec (take only the `fetchPublicFile` media-URL hunk here) |
| 3 | `fix(payments): verify amount, currency, reference and order state before any financial change` | `common/payments/**`, `commerce/ledger/**`, `commerce/webhooks/**`, `billing-webhook.controller*` and payment-integrity spec, worker `commerce-reconciliation.processor.ts` | 2 (soft: `stripe.gateway.ts`) | `billing-webhook.controller.spec.ts` is fixture-only |
| 4 | `feat(campaigns): consume scheduled campaigns and settle every campaign outcome` | `campaigns/**` (service, module, `scheduled-campaign.processor.ts`, scheduling and worker specs), worker `campaign-send.processor.ts` | 2 | none |
| 5 | `feat(billing): remove monthly subscription sales from customer screens and copy` | `billing/**` except webhook files and the gateway (controller, service, util, specs), `users.service.ts`, frontend billing, landing, site components, legal pages, channels page, dashboard cards, `lib/api.ts`, `packages/api` billing, mobile billing/index/settings, `seo-check.mjs`, platform-admin shell and plans pages; **the four staged deletions** | 2 (soft) | `manage-settings.service.ts` (subscription hunks), `terms/page.tsx` and `channels/page.tsx` (subscription text and the Telegram/TikTok wording both go here), `billing.service.ts` (9 hunks, all this commit), `(dashboard)/ai/page.tsx` (inspect: subscription wording belongs here, anything AI-behaviour belongs to 8) |
| 6 | `feat(rag): hybrid retrieval modules, pgvector image and design notes (nothing wired)` | `knowledge-base/rag/**` (31 files), `infra/postgres/Dockerfile`, `docs/VERZAI_V2_HYBRID_RAG.md` | 1 | none (all new files); must compile alone |
| 7 | `docs(legal): third-party notice for the local embedding model (provenance review open)` | `apps/backend/third-party/all-MiniLM-L6-v2/{LICENSE,NOTICE.md}` | none | none. Separate on purpose so it can be dropped or replaced without touching code (see 4.3) |
| 8 | `feat(ai): no canned replies, structured replies, escalation, refusal, legacy retirement; wire hybrid retrieval (flag off)` | everything under `ai-core/**` (pipeline, stages, prompts, quality, refusal, migration, credits spec, hybrid source and providers, tool-calling), `ai/ai-responder.service.ts`, `ai-logs/**`, `commerce/ai/**`, `commerce/evaluation/**`, `messages/messages.service.ts` and spec (remaining hunks), `knowledge-base/knowledge-base.service.ts`, `app.boot.spec.ts`, `apps/backend/scripts/legacy-retirement-readiness.ts`, backend `package.json` (`ai:legacy-readiness`), `manage-settings` personality specs and hunks | 4 (boot spec), 6 (retrieval-trace) | `messages.service.ts` + spec, `manage-settings.service.ts` (personality hunks). No shared-pipeline splitting is needed any more |
| 9 | `chore(infra): staging deploy contract, restore rehearsal image, required settings, release verification` | `infra/scripts/**` (new lib, tests, `verify-release-candidate.sh`, changed deploy/recreate/restore scripts), `infra/docker-compose.staging.yml`, `infra/.env.staging.example`, `infra/.env.example`, `infra/docker-compose.yml` | none functionally | `docker-compose.yml` is the **production** Compose: its only change is the `INTERNAL_SECRET` pass-through; say so in the message. The hybrid-RAG Compose change is **not** here until 4.2 is closed |
| 10 | `docs: release audit, remediation, refund design, integration test plan, business decisions, staging preflight, learning architecture` | `docs/*.md` (9 files) | none | none; confirm you want audit documents in the repository |

Combined or split compared with UPDATE 3: the old commits 7 and 8 are merged into commit 8; the notice is split out as commit 7; the additive rag modules are commit 6.

### Required tests at each integration point (ADOPTED)
Every commit runs the same cheap gate, because splitting mistakes show up as type errors:
```bash
git rebase -x 'cd apps/backend && npx tsc --noEmit && npx jest --silent' d5f93b9     # after the commits exist, run by you or with your approval
```
Additional gates: after commits 2, 4, 5 and 8, `cd apps/worker && npx tsc --noEmit`, and for 2 also `apps/realtime` and `apps/whatsapp-web` (`npm test`); after 5 and 8, `apps/frontend` and `apps/mobile` `npx tsc --noEmit`; after 9, all `infra/scripts/tests/*.test.sh`. The full exact-SHA run (`infra/scripts/verify-release-candidate.sh`) happens once, at the end, on the final SHA. Specs that must pass at the commit that introduces them are the ones named in that commit's row (security, payment-integrity, campaign, rag, pipeline and boot specs).

### Risks of accidental unrelated changes (and the control for each)
| Risk | Control |
|---|---|
| Staged deletions swept into commit 1 | Needs your approval before anything is committed: unstage them with an index-only restore (the files stay deleted in the worktree), then commit them in 5. Or commit with explicit pathspecs. Either alters the index, hence approval |
| `git add -A` pulls every group into one commit | Stage by explicit path lists generated from the inventory; review `git diff --cached --stat` before each commit; the tree must be clean after commit 10 |
| Mixed files staged whole | Use `git add -p` for the four mixed files named above; after staging, `git diff --cached <file>` must show only that commit's hunks |
| Generated or local files (`dist`, `*.tsbuildinfo`, `.DS_Store`, `.expo`, `.pnpm-store`, `infra/.env.staging`) | None are untracked in this worktree today (checked); `infra/.env.staging` is git-ignored; re-check `git status` before each commit |
| The 2026-07-06 stash applied by accident | It is untouched and unrelated; never `stash pop`/`apply` during this work |
| Secrets in docs or fixtures | Scanned twice: only test fixtures and placeholders; re-scan with the same patterns before commit 10 |

## 4.2 Hybrid RAG (UNRESOLVED: evidence missing)

### FACT (cited from UPDATE 3 section 1; reconstructed from operator scripts, not live state)
Staging was configured by hand with override files: Postgres image `verzchat-staging/postgres-pgvector:16.15-0.8.7`, backend image `e2acaaa...` with two read-only mounts (`/opt/verz-models/all-MiniLM-L6-v2`, `/opt/verz-ort`), `NODE_PATH`, `EMBEDDING_MODEL_DIR`, `RAG_HYBRID_ENABLED=true`, `EMBEDDING_PROVIDER=local-minilm`; the extension and `kb_vector_chunks` exist in the database, not in any migration. **Confirmed concern:** the release script recreates the backend from the repository Compose alone, which carries none of this, so the mounts and RAG settings are dropped and hybrid silently reverts to keyword retrieval. (I make no claim that Postgres would be recreated.)

### Minimal preservation strategy (ADOPTED, not applied)
1. **Repository Compose carries the structure, not the switch.** In `docker-compose.staging.yml`: backend gets the two read-only mounts and `NODE_PATH` / `EMBEDDING_MODEL_DIR` plus pass-through `RAG_HYBRID_ENABLED: ${RAG_HYBRID_ENABLED:-}` and `EMBEDDING_PROVIDER: ${EMBEDDING_PROVIDER:-}`; the Postgres service names the pgvector image tag (and a `build` stanza for reproducibility). The flags remain unset in git; the host's `.env.staging` sets them. Validated earlier with `docker-compose config`; not applied.
2. **Both `up -d` lines in the release script get `--no-deps`** (rollout and rollback). The reason is not a proven Postgres recreation; it is that a release must be able to touch only the five application services regardless of Compose version, and the operator already used `--no-deps` in every hybrid step.
3. **Alternative if you do not want host paths in git:** an optional `STAGING_COMPOSE_OVERRIDES` list in the script that appends `-f` files from the operator's environment.
DECISION needed: option 1+2 (recommended) or option 3.

### What the final deployment artifact must contain
- The exported candidate tree's `docker-compose.staging.yml` with the backend mounts/env pass-through and the pgvector image reference, `infra/postgres/Dockerfile` (committed in commit 6), and a release script that does not recreate dependencies.
- **Not in the artifact, so required on the host:** the pgvector image tag locally present; `/opt/verz-models/all-MiniLM-L6-v2` (with the two pinned files) and `/opt/verz-ort/node_modules/onnxruntime-web`; `RAG_HYBRID_ENABLED` / `EMBEDDING_PROVIDER` in `.env.staging`; the `vector` extension and `kb_vector_chunks` in the database; zero ANN indexes on that table.

### Live-state evidence required from the operator (names and hashes only)
Run on the staging host as the deploy user, output to a file; nothing below prints a secret value. Before sharing, check the file with `grep -iE 'secret|password|token|key' out.txt` and confirm only variable **names** appear.
```bash
{
echo "## compose and docker";            docker compose version
for c in wa_staging_backend wa_staging_postgres; do
  echo "## $c image";                   docker inspect -f '{{.Config.Image}}' $c
  echo "## $c compose labels";          docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}} | {{index .Config.Labels "com.docker.compose.project.working_dir"}}' $c
done
echo "## backend mounts";                docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{if .RW}}rw{{else}}ro{{end}}){{println}}{{end}}' wa_staging_backend
echo "## backend env NAMES ONLY";        docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_backend | cut -d= -f1 | sort
echo "## RAG flag values (non-secret)";  docker exec wa_staging_backend sh -c 'echo "RAG_HYBRID_ENABLED=${RAG_HYBRID_ENABLED:-unset} EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER:-unset} EMBEDDING_MODEL_DIR=${EMBEDDING_MODEL_DIR:-unset}"'
echo "## model and runtime files";       sha256sum /opt/verz-models/all-MiniLM-L6-v2/tokenizer.json /opt/verz-models/all-MiniLM-L6-v2/onnx/model_quantized.onnx; ls /opt/verz-ort/node_modules/onnxruntime-web/package.json; docker exec wa_staging_backend node -e "console.log(JSON.parse(require('fs').readFileSync('/ort/node_modules/onnxruntime-web/package.json','utf8')).version)"
echo "## images on host";                docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E 'postgres-pgvector|verzchat-staging/backend'
echo "## database"
docker exec -i wa_staging_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
select 'vector extension: ' || extversion from pg_extension where extname = 'vector';
select 'indexed chunks: ' || count(*) from kb_vector_chunks;
select 'ANN indexes (must be 0): ' || count(*) from pg_indexes where tablename = 'kb_vector_chunks' and indexdef ~* 'hnsw|ivfflat';
select 'migrations finished: ' || count(*) from _prisma_migrations where finished_at is not null;
SQL
echo "## override files present";        ls -l /root/staging-hybrid-rag-e2acaaa/ ; head -50 /root/staging-hybrid-rag-e2acaaa/override.*.yml
echo "## scheduled recreations";          crontab -l 2>/dev/null; systemctl list-timers --no-pager 2>/dev/null | head -20
echo "## release env file location";     ls -l /root/staging-ai-v2-checkout/infra/.env.staging | awk '{print $1, $3, $NF}'
} > hybrid-evidence.txt 2>&1
```
(Optional, counts only: `select tenant_id, count(*) from kb_vector_chunks group by 1`.)
**I cannot run this and have not seen its output.** The `head -50` of the override files is the one item that could contain a value: the operator reads it before sharing.

### Validation required before deployment (all must pass)
1. Local: `docker-compose -f infra/docker-compose.staging.yml config --quiet`; the extended Compose test asserts the backend has both mounts, `NODE_PATH`, both RAG variables as pass-through (value not hard-coded `true`) and the Postgres service names the pgvector image; the contract test asserts both `up -d` lines contain `--no-deps`.
2. Local: build the Postgres image from the committed Dockerfile and run the pgvector integration suite against it (`RAG_TEST_DATABASE_URL`).
3. Operator: the evidence file above matches the repository Compose by name (mounts, variable names, image tag); any difference is reconciled **before** the first deploy.
4. After the first staging deploy (operator): both mounts present read-only, RAG variable names present, `vector` 0.8.7, chunk count unchanged, a Test Chat paraphrase question reports `mode: hybrid` including `vector`, no new ERROR lines.
**Status stays UNRESOLVED until step 3 has real evidence.**

## 4.3 MiniLM notice files
FACT: the files originate in commit `17edda5`, match the hybrid commit byte-for-byte, the LICENSE is standard Apache-2.0 text, nothing reads them at runtime, the model files are host mounts and not in git or any image, and the notice itself states that training-data provenance is not verified.
**ADOPTED (safest repository decision):** commit them unchanged as their own commit (7), after the code. Reasons: untracked files would make the clean-tree gate fail, so they must be either committed or removed, and removing them would leave the code comment and design document pointing at a missing attribution; keeping them separate means a reviewer can drop or replace that single commit without touching any code; the notice makes no legal claim beyond what it can show and says what it does not know. This is a repository-hygiene choice, not a legal finding.
**Open legal question (not blocking staging):** is commercial use acceptable of a model whose published card lists many public datasets and a base model whose terms were not audited? Reviewer: your counsel or compliance owner. Evidence that reviewer needs from an engineer or operator with network access: the licence metadata and any NOTICE on the two model pages at the pinned revision `751bff37...`. Staging use of host-mounted files is an internal-use question; the question matters before enabling in production or distributing the files.

## 4.4 Production Compose: separate remediation (outside this release; nothing changed)
| Item | Classification | Plan |
|---|---|---|
| Worker lacks `CREDENTIALS_ENCRYPTION_KEY` | confirmed gap in the file; impact depends on whether production has the key set and any WhatsApp credential saved encrypted (`enc:v1:` prefix) | Operator (read-only): is the variable set on the backend (set/unset only), and `select count(*) from whatsapp_numbers where access_token like 'enc:v1:%'` (also check `tenants.access_token`). If either is true, add `CREDENTIALS_ENCRYPTION_KEY: ${CREDENTIALS_ENCRYPTION_KEY:-}` to the production worker, same value as the backend, **never rotated** |
| Worker lacks `PAYSTACK_SECRET_KEY` | confirmed gap; impact: Commerce reconciliation cannot verify transactions | Add if reconciliation is wanted in production |
| Backend URL | confirmed defect, **already fixed in code** (`backendApiBase()` prefixes `/api/v1`) | No Compose change needed; optionally set `BACKEND_URL` explicitly |
| `PUBLIC_BASE_URL` | not a defect if the public domain is `verzchat.com` (code default); depends on production domain | Set explicitly only if the domain differs |
| `OAUTH_STATE_SECRET`, `PAYSTACK_PUBLIC_KEY` absent on the production backend | potential: the first falls back to `JWT_SECRET` by design; the second yields an empty checkout public key | Confirm which flows production uses |
| Required values on the server | operator | `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET` must exist (backend refuses to start without them) |
Delivery: its own pull request against the production branch, with `production-recreate.test.sh` extended by a production Compose-env check mirroring `staging-compose-env.test.sh`; deploy by recreating the worker only (`--no-deps`), verify worker log "All workers started" and one campaign/quality-sync job, roll back by redeploying the previous image. Approval: yours, separately. It does not gate staging: staging has its own Compose and env file, and the worker code fix ships in the candidate regardless.

## 4.5 External prerequisites (one checklist; names only, never values)

### Tier 0: required to say the application deploys on staging (no integration account needed)
| Item | Notes |
|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | fresh and staging-only; secrets at least 32 characters; enforced by the script |
| `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY` | random; differ from production (enforced) |
| `WHATSAPP_APP_SECRET` | the backend only needs it non-empty to start. A clearly labelled random placeholder is acceptable for a deploy-only check, with the consequence that **every WhatsApp webhook is rejected (400) until the real Meta app secret is set** |
| `CREDENTIALS_ENCRYPTION_KEY` | base64, exactly 32 bytes (enforced); generated once, never changed after data is encrypted |
| `STAGING_PUBLIC_URL` or `VPS_IP` | |
| Host: pgvector image tag, `/opt/verz-models`, `/opt/verz-ort`, `.env.staging` at the release checkout | only if hybrid is to be preserved (4.2) |
| Operator hybrid evidence (4.2) and the secret-presence procedure (UPDATE 2 U-section 5 / UPDATE 3 section 4) | |
Tier 0 passes with: stack healthy, `/api/v1/health` and `/api/v1/health/ready` 200, auth refusals on the internal endpoints, graceful shutdown. No Meta, Paystack, Resend or Stripe credential is required for this.

### Tier 1: acceptance tests per integration (each only for the test it enables)
| Test | Needs | Notes / verification |
|---|---|---|
| WhatsApp Cloud | real `WHATSAPP_APP_SECRET` of a **test** Meta app; test WABA/number; per-workspace webhook `/api/v1/webhook/whatsapp/<tenantId>` and the verify token | unsigned and forged requests must get 400 |
| Messenger / Instagram | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_LOGIN_CONFIG_ID`, `INSTAGRAM_LOGIN_CONFIG_ID` (empty last time), `MESSENGER_WEBHOOK_VERIFY_TOKEN`; webhook `/api/v1/webhook/messenger`; **subscription for the `instagram` object with the `messages` field** (production's app has only `page`); Instagram professional account linked to a Page; messaging permission; testers added while the app is in development mode | steps in `REAL_INTEGRATION_TEST_PLAN.md` section 3 |
| Paystack | `PAYSTACK_SECRET_KEY` (`sk_test_`; the script aborts on `sk_live_`), `PAYSTACK_PUBLIC_KEY` (`pk_test_`); test-mode webhooks to `/api/v1/commerce/webhooks/paystack` and `/api/v1/billing/webhooks/paystack` | test cards from Paystack's documentation |
| Resend inbound email | `RESEND_WEBHOOK_SECRET` (signing secret of the webhook endpoint), `RESEND_API_KEY` for outbound | endpoint `/api/v1/inbound/email`; without the secret the production-mode backend refuses inbound mail (intended). Whether the inbound domain/MX is set up at Resend is outside my evidence: operator confirms |
| AI | `DEEPSEEK_API_KEY` | |
| Hybrid RAG | 4.2 | |

### Domain, callback and non-standard port (OPERATOR, unverified)
The staging URL ends in `:8443`. I have no verified statement of which ports Meta and Paystack accept for webhook callbacks or OAuth redirect URIs, and I will not assert one. Procedure: (1) read the current Meta and Paystack documentation for callback URL port rules and record the page and date; (2) in a **test** Meta app, save the staging callback and use the dashboard's webhook test to see whether the verification GET reaches the backend (`Messenger webhook verified` in the log); (3) add the staging domain to the app's allowed domains and OAuth redirect list; (4) if either provider rejects the port, request a staging hostname served on 443 (DNS and certificate: an operator action, not performed here). Until that passes, Tier 1 tests for Meta and Paystack are BLOCKED; Tier 0 is unaffected.

## 4.6 Release gate: from the dirty worktree to a deployable candidate
Approval column: **YOU** = needs your explicit approval before it happens; **no** = read-only or local.

| # | Step | Detail | Approval |
|---|---|---|---|
| 1 | Inventory | UPDATE 2 U1 plus the status check above; re-run immediately before step 3 and confirm the count matches | no |
| 2 | Close the open decisions | Compose strategy (4.2), MiniLM commit (4.3), the ten-commit sequence and combining 7+8, whether audit docs enter the repo | **YOU** |
| 3 | Authorise index handling | unstage the four staged deletions (index only) or use explicit pathspecs | **YOU** |
| 4 | Authorised hunk staging and local commits | commits 1-10 in order, explicit paths, `git add -p` for the four mixed files, `git rebase -x` gate at each commit, **no push** | **YOU** (to create commits) |
| 5 | Integration verification on the final local SHA | `VERIFY_PG_IMAGE=<pgvector pg16> bash infra/scripts/verify-release-candidate.sh <SHA>` (clean tree, HEAD equals SHA, all steps pass, zero failures); a failure returns to step 4 | no |
| 6 | Push the feature branch and open the PR to `dev` | review by you or a second reviewer | **YOU** (push) |
| 7 | Merge to `dev`, then PR `dev` to `staging` | repository workflow: feature to dev to staging to main; merging to `staging` only updates the branch, it does not deploy | **YOU** (each merge) |
| 8 | Clean-SHA verification on the promoted staging-branch SHA | repeat step 5 on exactly the SHA the operator will deploy; record the summary here | no |
| 9 | Operator prerequisites | Tier 0 secrets validated by name-only procedure; hybrid evidence (4.2) reconciled; host image/mounts present; release checkout and `.env.staging` location agreed | OPERATOR |
| 10 | Staging evidence | release script's own backup and restore rehearsal on the host; acceptance tests A to H of UPDATE 2 U-section 10 as credentials permit; Tier 1 items marked BLOCKED stay BLOCKED, never "mocked-pass" | OPERATOR |
| 11 | Explicit deployment approval | you approve the exact SHA after seeing: step 8 summary with zero failures, hybrid decision closed with live evidence, secrets validated, rollback image tag recorded, backup rehearsal passed | **YOU** (final) |
Anything unticked at step 11 means NO-GO. The hybrid evidence and Tier 0 prerequisites are currently open, so **deployment readiness is not claimed.**

## 4.7 Combined release action list
1. **Next exact task (you decide):** approve or amend 4.1 (sequence, combine 7+8, MiniLM separate) and the Compose strategy in 4.2; I can then prepare the exact `git add` path lists and the per-commit check script text for review, still without staging anything.
2. **Needs your approval:** steps 2, 3, 4, 6, 7, 11 above.
3. **Operator, in parallel:** run the hybrid evidence block (4.2); validate Tier 0 secrets by name; read and test the Meta/Paystack callback-port rules (4.5); report whether production has `CREDENTIALS_ENCRYPTION_KEY` set and encrypted tokens (4.4).
4. **Reviewer:** counsel or compliance on the MiniLM training-data question (not blocking staging).

---

# UPDATE 3: RELEASE DECISIONS AND EVIDENCE

Evidence-gathering only. Nothing in the repository other than this document was changed; no commit, push, merge or deployment; staging and production not contacted; no secret values handled or printed. Experiments used throwaway local containers (all removed). Statements are tagged **VERIFIED** (observed in the repository or by a local experiment), **RECONSTRUCTED** (rebuilt from historical operator scripts and their saved outputs, not live state), or **UNVERIFIED**.

## Decision table

| Decision | Current evidence | Status | Required next action |
|---|---|---|---|
| Hybrid-RAG preservation | Live setup RECONSTRUCTED from operator scripts/outputs (not live state). VERIFIED: the repo staging Compose has none of it, and the deploy script recreates the backend from the repo Compose alone, so the model mounts and RAG settings would be dropped. Postgres recreation NOT reproduced locally (Compose 5.3.1). Proposed Compose change validated locally. | BLOCKED | Operator provides the live-state evidence in 1.5 (and authorises the export); then you decide whether to apply the Compose change and `--no-deps` |
| MiniLM notice provenance | VERIFIED: files byte-identical to those in commit `e2acaaa`; introduced by `17edda5` (collinsasante, 2026-11-02); LICENSE is the standard Apache-2.0 text; not used at runtime. NOT verifiable offline: the model-card licence claims, the pinned revision, training-data licensing | NEEDS OPERATOR DECISION | Decide include/exclude; supply the items in 2.4 if included. Files left untouched |
| Production Compose | VERIFIED: production worker lacks `CREDENTIALS_ENCRYPTION_KEY`, `PAYSTACK_SECRET_KEY`; no `BACKEND_URL`, `PUBLIC_BASE_URL` (the latter two are covered by code defaults). Impact depends on production settings I cannot see | NOT REQUIRED FOR STAGING | Separately approved production remediation (3.4); no shared release dependency except the worker code fix already in the candidate |
| Staging secrets | Required names enumerated and enforced by the deploy script; presence on the host UNVERIFIED | BLOCKED | Operator provisions and validates per section 4 (names only) |
| Meta test setup | No test Meta app known; staging shares production's callback; Instagram object not subscribed in production app; staging URL uses port 8443 (UNVERIFIED whether Meta accepts it) | BLOCKED | Operator creates the test app and confirms the callback port (4.2). Not needed to deploy, needed for acceptance tests B/C/E |
| Paystack test setup | Test-key enforcement exists in `staging-recreate.sh`; no test account/webhook evidence | BLOCKED | Operator supplies test credentials and webhook registration (4.3). Not needed to deploy, needed for acceptance test B |
| Nine-commit sequence | VERIFIED by import analysis: the sequence as written is **not buildable commit by commit** (hard dependency cycle between the hybrid-RAG and AI commits through shared pipeline files). A reordered ten-commit sequence is proposed in section 5 | NEEDS OPERATOR DECISION | Approve the revised sequence and authorise local commits on the feature branch (no push) |

## 1. Hybrid-RAG staging configuration

### 1.1 What must be preserved (RECONSTRUCTED, not live state)
Source: `~/verz-hybrid-rag-validation/` scripts and saved outputs (Postgres swap A/B, backend C/D/E/F/G, rollout runbook, server audit). Historical outputs are dated 2026-11-02 16:00-16:30.

| Piece | Reconstructed value | Evidence |
|---|---|---|
| Postgres image | `verzchat-staging/postgres-pgvector:16.15-0.8.7`, built from `infra/postgres/Dockerfile` (`PG_IMAGE=postgres:16.15-alpine`, `PGVECTOR_VERSION=v0.8.7`, `OPTFLAGS=""`), data volume `staging_postgres_staging_data` unchanged; previous image `postgres:16-alpine` (id `0cefaabd882e`) | swap-B output: "image tag is the pgvector image", "data volume unchanged", "migrations still applied", "extension NOT created" |
| Extension and table | `vector` 0.8.7 created by hand; `kb_vector_chunks` made by `ensurePgVectorSchema` (not a Prisma migration), 3 indexes, **0 ANN indexes (must stay 0, otherwise the stock image cannot read the table)** | outputs E-schema and F |
| Backend image | `verzchat-staging/backend:e2acaaa11660c1c893d6c2b7533097ab34fe1aad`, recreated with `--no-deps --no-build` | scripts C/D |
| Backend mounts | `/opt/verz-models/all-MiniLM-L6-v2` to `/models/all-MiniLM-L6-v2` (ro); `/opt/verz-ort` to `/ort` (ro) | script D override |
| Backend env | `NODE_PATH=/ort/node_modules`, `EMBEDDING_MODEL_DIR=/models/all-MiniLM-L6-v2`, `RAG_HYBRID_ENABLED=true`, `EMBEDDING_PROVIDER=local-minilm` | scripts D, F |
| Pinned files | tokenizer sha256 `da0e7993...c62a0`, model sha256 `afdb6f1a...bdb1`, onnxruntime-web 1.31.1 | script D checks |
| Provenance of the config | override files `/root/staging-hybrid-rag-e2acaaa/{override.postgres.yml,override.backend.yml,override.enable.yml}` layered on the candidate's Compose file; env file `/root/staging-ai-v2-checkout/infra/.env.staging` | scripts D, F; swap step-2b |
| Live data | pilot tenant `08dd98ed` has 6 indexed chunks; flag `verz_ai_v2` effective for it | outputs E, G |

**Not claimed as live state:** whether any of this still holds today (anything could have been recreated since), the Compose version on the host, the override files' current contents, or whether other tenants were indexed after 16:30.

### 1.2 The deployment risk (VERIFIED where stated)
- **Certain (VERIFIED by reading the script):** `staging-release-deploy.sh` runs `"${COMPOSE[@]}" up -d --no-build --force-recreate backend worker realtime whatsapp-web frontend` using only the exported candidate's `docker-compose.staging.yml`. The recreated backend therefore has **no model mounts and no RAG variables**. The code then silently falls back to keyword retrieval (flag unset), so hybrid retrieval stops working with no error. The one-off `prisma migrate deploy` container also runs without them (harmless, migrations do not use them).
- **Not reproduced (VERIFIED experiment, local only):** I tested whether `up -d --force-recreate <service>` also recreates a *dependency* whose repo definition differs from the running container, using a throwaway two-service project (`db` with a different image tag and environment, `app` depending on it) on Compose 5.3.1. Result: the dependency container ID and image did **not** change, with or without `--no-deps`. So the Postgres-on-stock-image scenario I described in UPDATE 2 was **not confirmed** and that wording is corrected above. The staging host's Compose version is **UNVERIFIED**; behaviour may differ between versions, so this remains a version-dependent risk.
- **Also noted:** the script reads `$ROOT/infra/.env.staging` from the checkout it is run in, while the historical operations used `/root/staging-ai-v2-checkout/infra/.env.staging`; if the release is run from a different checkout the env file must be present there or the script aborts at its required-settings check.
- **Precedent:** every hybrid step by the same operator used `up -d --no-deps --no-build` with explicit `-f` override files, so a deployment strategy that names services and skips dependencies is already the operator's practice.

### 1.3 Smallest safe proposal (NOT applied; the rules forbid modifying Compose/scripts in this task)
1. **Compose (`infra/docker-compose.staging.yml`)**: the change already validated in UPDATE 2 section U3: postgres image `verzchat-staging/postgres-pgvector:16.15-0.8.7` with its `build` args; backend `NODE_PATH`, `EMBEDDING_MODEL_DIR`, `RAG_HYBRID_ENABLED: ${RAG_HYBRID_ENABLED:-}`, `EMBEDDING_PROVIDER: ${EMBEDDING_PROVIDER:-}` and the two read-only mounts. The flag variables stay unset in the repository, so retrieval is keyword-only unless the host's `.env.staging` sets them; this preserves the "off unless enabled" property.
2. **Deploy script**: add `--no-deps` to the two `up -d` lines (rollout and rollback) so a release can never touch Postgres, Redis or MinIO; add a pre-flight that the pgvector image tag exists locally when the Compose file names it.
3. **Trade-offs to accept:** (a) the repo Compose now names a host path (`/opt/verz-models`, `/opt/verz-ort`); on a host without them Docker creates empty root-owned directories (harmless with the flag unset); (b) the Compose change alters the Postgres service's config, so the *next* time anyone recreates it (not this deploy) it restarts once, about 10-30 s, onto the same pgvector image and volume; (c) the `kb_vector_chunks` table is not in any Prisma migration, so a brand-new environment needs the explicit `ensurePgVectorSchema` step from the runbook before hybrid can be enabled.
4. **Alternative if you prefer not to put host paths in the repository:** keep the Compose clean and add an optional `STAGING_COMPOSE_OVERRIDES` list to the deploy script that appends `-f` files from the operator's environment (the same mechanism the operator used). More script change, no host paths in git.

### 1.4 Validation commands (local, no server)
```bash
# the compose resolves, and names the pgvector image + mounts + RAG vars (names only)
docker-compose --project-name chk -f infra/docker-compose.staging.yml config --quiet
docker-compose --project-name chk -f infra/docker-compose.staging.yml config | grep -E "postgres-pgvector|/models/all-MiniLM|/ort:ro|RAG_HYBRID_ENABLED|EMBEDDING_PROVIDER"
bash infra/scripts/tests/staging-compose-env.test.sh        # extend with: backend mounts + NODE_PATH + both RAG vars present, flag value not hard-coded to true
bash infra/scripts/tests/staging-release-contract.test.sh   # extend with: both `up -d` lines contain --no-deps
# on a pgvector image: build and smoke-test the Postgres image
docker build --build-arg PG_IMAGE=postgres:16.15-alpine -t verzchat-staging/postgres-pgvector:16.15-0.8.7 -f infra/postgres/Dockerfile infra/postgres
RAG_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:<port>/<name>_test npx jest src/knowledge-base/rag/pgvector-store.integration.spec.ts
# the dependency-recreation experiment (re-run with the host's Compose version)
```
After a real deploy (operator, on the host): backend still has both mounts (`docker inspect` mounts, ro), the two RAG variable **names** present, `select extversion from pg_extension where extname='vector'` returns 0.8.7, the pilot tenant's chunk count is unchanged, a Test Chat paraphrase question reports `mode: hybrid` including `vector`, no new ERROR lines.

### 1.5 Live-state evidence I need you to authorise or provide (I did not and will not collect it)
1. Authorisation for the operator to run the read-only export in UPDATE 2 U3 on the staging host, plus these extras: `docker compose version`; the output of `docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}} {{index .Config.Labels "com.docker.compose.project.working_dir"}}'` for `wa_staging_backend` and `wa_staging_postgres`; `ls -l /root/staging-hybrid-rag-e2acaaa/` and the three override files (no secrets expected; the operator confirms before sharing); `docker image ls verzchat-staging/postgres-pgvector`; the list of tenants with indexed chunks and counts (counts only, no content); `crontab -l` and any systemd timers that might recreate containers.
2. Confirmation that the pgvector image tag exists on the host and was built from the committed `infra/postgres/Dockerfile` (image id or the build command used).
3. Confirmation of which checkout/env-file path the release will be run from.
4. A decision between proposals 1.3(1) and 1.3(4), and approval of `--no-deps`.
Until 1 and 2 arrive, the configuration stays **reconstructed**, never "verified live".

## 2. MiniLM notice-file provenance

### 2.1 Files (VERIFIED)
`apps/backend/third-party/all-MiniLM-L6-v2/LICENSE` (11,358 bytes, sha256 `cfc7749b96f6...`) and `NOTICE.md` (3,592 bytes, sha256 `c61ddaf84413...`). Both untracked in this worktree.

### 2.2 Where they came from (VERIFIED from git)
Both files exist, byte-identical (hashes match), in commit `e2acaaa` on the hybrid-RAG branch, and were added by commit `17edda5` "feat(ai): add local MiniLM-L6-v2 embedding adapter (onnxruntime-web WASM), off by default", author collinsasante, 2026-11-02. This worktree received them through the earlier hunk-by-hunk integration. `LICENSE` is the standard Apache-2.0 text: compared with the AWS SDK's copy installed in `node_modules`, the only differences are indentation of the title line and the appendix boilerplate placeholder (`[yyyy] [name of copyright owner]`, which is the standard unfilled appendix). `NOTICE.md` is original prose written in the repository; it cites the Hugging Face model pages and a pinned revision (`751bff37...`) and states its own limits.

### 2.3 What can and cannot be established
| Question | Answer | Basis |
|---|---|---|
| Needed at runtime? | **No.** Nothing reads these files; the only references are a code comment in `minilm-loader.ts` and `docs/VERZAI_V2_HYBRID_RAG.md`. The model files themselves are not in the repository or any image (host mounts). | VERIFIED by search |
| Needed for compliance? | Apache-2.0 requires the licence text to accompany redistributed copies. The model files are not distributed from this repository; they are copied by the operator onto the host. Whether a copy leaves your control (customers, partners, a cloud image) is a fact I cannot see. | Licence text + repository layout |
| Is the notice's source of truth in the repo? | Partly. The package declares no model dependency (`onnxruntime-web` is "not yet a dependency", per the notice itself). The upstream licence statements (`license: apache-2.0` on the two model cards), the pinned revision's existence, and the absence of an upstream NOTICE file **cannot be verified offline**. | UNVERIFIED |
| Training-data/commercial-use clearance? | **Not established, and the notice says so itself.** Apache-2.0 on the weights does not by itself settle the terms of the datasets or the base model. | NOTICE.md text |
| Appropriate to include? | The notice is honest about what it does not establish, and nothing in it contradicts the evidence I could check. Whether to ship it is a compliance choice, not a technical one. I express no legal conclusion. | - |

### 2.4 Information needed to close this (leave the files untouched until then)
1. Your decision: keep with commit 6 (hybrid additions) / keep out of this release / replace with counsel's wording.
2. Operator or counsel: fetch the two Hugging Face model cards at the pinned revision and record the licence metadata and any NOTICE file (needs network; I did not fetch).
3. Counsel: acceptability of the training-data provenance for commercial use, or a written risk acceptance.
4. Whether the model files will ever be copied outside your own staging/production hosts.
5. Whether the git history should show a different author for the notice text (it was committed under the repository owner's identity; I cannot establish who drafted the prose).
The hybrid code is off by default (`RAG_HYBRID_ENABLED` unset), so excluding the notice does not change runtime behaviour; excluding the *code* is a separate question.

## 3. Production Compose gaps

Comparison method: variable **names** per service, parsed from `infra/docker-compose.yml` (production) and `infra/docker-compose.staging.yml` (corrected staging), plus the code that reads them. Production Compose was not modified.

### 3.1 Worker
| Variable | Staging (corrected) | Production | Classification |
|---|---|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | passed | **absent** | **Confirmed defect in the file** (worker reads it in `whatsapp-credentials.ts` and the quality-sync processor). **Impact depends on production state:** the backend and whatsapp-web in production do receive the key. If the key is set on the server and any WhatsApp number was saved while it was set, the stored token is encrypted and the worker throws "Cannot decrypt credential", so campaign sends and quality sync fail. If the key is empty in production, nothing is encrypted and nothing breaks. UNVERIFIED which |
| `PAYSTACK_SECRET_KEY` | passed | **absent** | **Confirmed defect in the file**; impact: the Commerce reconciliation processor cannot verify transactions (it reads this directly). UNVERIFIED whether the processor is relied on in production |
| `BACKEND_URL` | `http://backend:3001/api/v1` | absent | **Confirmed defect, fixed in code** (`backendApiBase()` adds the prefix to the default and to any value). No Compose change required; setting it explicitly is optional |
| `PUBLIC_BASE_URL` | staging address + `/api/v1` | absent | **Not a defect if production is `verzchat.com`**: the code default is `https://verzchat.com/api/v1`. Depends on the real public domain; set explicitly if it differs |
| `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_WEB_INTERNAL_URL` | passed | passed (`INTERNAL_SECRET` newly added, uncommitted) | OK |
| `REALTIME_URL`/`REALTIME_INTERNAL_URL` | default | default | OK (`http://realtime:3002` default is correct) |

### 3.2 Backend and others
| Item | Finding | Classification |
|---|---|---|
| Backend: `OAUTH_STATE_SECRET`, `PAYSTACK_PUBLIC_KEY` | absent from production (staging has them) | Potential: `OAUTH_STATE_SECRET` falls back to `JWT_SECRET` by design; `PAYSTACK_PUBLIC_KEY` is read for checkout widgets, absent means an empty public key. Depends on whether production uses those flows |
| Backend: `ENABLE_DEV_TOOLS`, `ANTHROPIC_API_KEY` | staging-only | Correct (dev tools must not be enabled in production) |
| Backend: `GOOGLE_*`, `SENTRY_DSN`, `SMTP_REPLY_TO` | production-only | Production features |
| Backend `RESEND_WEBHOOK_SECRET`, `FACEBOOK_APP_SECRET`, `WHATSAPP_APP_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY` | all present in production Compose | OK in the file; the **values** must exist on the server, and the backend now refuses to start in production without `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET` |
| realtime, whatsapp-web | no name differences from staging | OK |
| Dependencies (`depends_on`) | identical to staging for every service | OK |
| Required release-time dependency shared with staging | the worker code fix (`backend-url`), which ships in the candidate regardless of Compose | none blocking staging |

### 3.3 Dependent on production-specific configuration (cannot be settled from the repository)
Whether production has `CREDENTIALS_ENCRYPTION_KEY` set and whether any stored credential is already encrypted; whether the public domain is `verzchat.com`; whether Paystack reconciliation is expected to run in production; which values exist in the production `.env`.

### 3.4 Recommended production remediation (separate approval, after the staging release)
1. Read-only evidence from the operator: is `CREDENTIALS_ENCRYPTION_KEY` set on the backend (set/unset only), and `select count(*) from whatsapp_numbers where access_token like 'enc:v1:%'` (prefix verified in `packages/shared-utils/src/credentials-encryption.ts`; the `whatsapp_numbers.access_token` column is mapped in the Prisma schema; also check `tenants.access_token`, which older workspaces use).
2. If encrypted values exist or the key is set: add `CREDENTIALS_ENCRYPTION_KEY: ${CREDENTIALS_ENCRYPTION_KEY:-}` to the production worker **before** deploying anything that sends campaigns from the worker, using the same value as the backend.
3. Add `PAYSTACK_SECRET_KEY` to the production worker if reconciliation is wanted; optionally `BACKEND_URL` and `PUBLIC_BASE_URL` for explicitness.
4. Ship as its own reviewed change with the production deploy contract tests (`production-recreate.test.sh`), not bundled with the staging release. Production changes do not block staging, because the staging stack has its own Compose and env file.

## 4. External staging prerequisites (checklist for the operator; names only, never values)

### 4.1 Strictly required to DEPLOY the stack (the deploy script and backend startup refuse without them)
| Variable | Used by | Notes |
|---|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | postgres, redis, backend, worker, realtime, whatsapp-web | fresh, staging-only |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | backend; realtime (`JWT_SECRET`) | at least 32 characters, different from production (enforced) |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | minio, backend | |
| `INTERNAL_SECRET` | backend, worker, realtime | different from production (enforced) |
| `WHATSAPP_WEB_INTERNAL_API_KEY` | backend, worker, whatsapp-web | different from production (enforced) |
| `WHATSAPP_APP_SECRET` | backend | the secret of the Meta app whose webhooks will reach staging; any non-empty value lets the backend start, but WhatsApp tests need the real one |
| `CREDENTIALS_ENCRYPTION_KEY` | backend, worker, whatsapp-web | base64, exactly 32 bytes (enforced); **do not change once data is encrypted** |
| `STAGING_PUBLIC_URL` or `VPS_IP` | Compose URLs | |
| `PLATFORM_ADMIN_SETUP_SECRET` | backend | only to create the first platform admin; different from production |

### 4.2 Required only for a specific integration test
| Test | Variables / items | Notes |
|---|---|---|
| WhatsApp Cloud (acceptance C) | real `WHATSAPP_APP_SECRET`; a **test** Meta app with a WhatsApp test number/WABA; per-workspace webhook `https://<staging>/api/v1/webhook/whatsapp/<tenantId>` and the verify token | callback must be reachable over HTTPS with a valid certificate (the certificate for `staging.verzchat.com` exists) |
| Messenger / Instagram | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_LOGIN_CONFIG_ID`, `INSTAGRAM_LOGIN_CONFIG_ID` (empty in the last staging capture), `MESSENGER_WEBHOOK_VERIFY_TOKEN`; webhook `https://<staging>/api/v1/webhook/messenger` | **Instagram needs a subscription for the `instagram` object with the `messages` field** (the production app has only `page`); Instagram professional account linked to a Page; messaging permission; the tester added as app role while in development mode; `subscribed_apps` for the account (exact steps in `docs/REAL_INTEGRATION_TEST_PLAN.md` section 3) |
| Domain / port | the staging public URL ends in `:8443`. **UNVERIFIED:** whether Meta accepts a non-standard port for webhook callbacks and OAuth redirect URIs (my recollection is that Meta documents port 443 only; check the current Meta documentation). If it does not, a staging hostname on 443 is needed. Also add the staging domain to the Meta app's allowed domains / OAuth redirect list | operator decision before building the test app |
| Resend inbound email | `RESEND_WEBHOOK_SECRET` (signing secret of the Resend webhook) , `RESEND_API_KEY` for outbound | webhook URL `https://<staging>/api/v1/inbound/email`; without the secret the production-mode backend refuses inbound mail (intended) |
| AI | `DEEPSEEK_API_KEY` (and `ENABLE_DEV_TOOLS=true` already set for Test Chat) | |
| Hybrid RAG | model files + onnxruntime-web mounts on the host, pgvector Postgres image, `RAG_HYBRID_ENABLED=true`, `EMBEDDING_PROVIDER=local-minilm` | section 1 |

### 4.3 Paystack test mode
| Item | Detail |
|---|---|
| Variables | `PAYSTACK_SECRET_KEY` (**must be `sk_test_...`**; `staging-recreate.sh` aborts on `sk_live_`), `PAYSTACK_PUBLIC_KEY` (`pk_test_...`) |
| Webhooks to register in the Paystack **test** dashboard | `https://<staging>/api/v1/commerce/webhooks/paystack` (Commerce orders) and `https://<staging>/api/v1/billing/webhooks/paystack` (credit packs) |
| Prerequisites | the test account's webhook IP/URL reachable from the internet (same non-standard-port caveat as above, **UNVERIFIED** for Paystack); test cards from Paystack's documentation; a test workspace with Commerce enabled |
| Not required to deploy | the stack boots without the Paystack keys (Commerce features then report unavailable); Stripe keys are optional |

### 4.4 Not required for staging
Production secrets (never copy them), Stripe keys, TikTok credentials, Google OAuth, Sentry, SMTP unless emails are tested.

## 5. Commit readiness

No file was staged or committed. Method: classification of all 224 changed paths into the nine groups (UPDATE 2 U1), plus an import analysis of every changed TypeScript file to find dependencies between groups. "Hard" = imports a file that exists only in another group; "soft" = imports a file that already exists at HEAD but is modified in another group.

### 5.1 Findings that change the plan
1. **The proposed order has a cycle and would not build commit by commit.** Hybrid RAG (C2) and the AI changes (C6) interlock: `pipeline.types.ts` (C6 file) imports `knowledge-base/rag/retrieval-trace.ts` (a new C2 file), and `ai-core.module.ts` (a C2-classified file) imports the new `refusal/security-refusal.service.ts` (a C6 file). Six shared files carry hunks from both efforts: `ai-core.module.ts` (5 hunks), `pipeline.types.ts` (4), `stages/context-assembly.stage.ts` (10) and its spec (3), `stages/generation.stage.ts` (6) and its spec (7), `tools/tool-calling.execution-record.spec.ts` (7).
2. `app.boot.spec.ts` (C6) imports the new `campaigns/scheduled-campaign.processor.ts` (C5), so it must come after campaigns.
3. `worker-backend-url.spec.ts` belongs to C3 (it tests the C3 worker helper), not C5; classification regexes in UPDATE 2 put it in C5.
4. Soft edges (no new-file dependency): C2, C4, C7 touch files whose neighbours C3 modifies (`public-page-fetch.ts`, `stripe.gateway.ts`), and C3's webhook controller imports `messages.service.ts` (C6). Safe if C3 goes first.

### 5.2 Revised sequence (ten commits, still on `feature/ai-no-canned-replies`)
| # | Commit | Files (see inventory) | Depends on | Tests required (from the verification script) | Mixed files needing `git add -p` | Accidental-inclusion risks |
|---|---|---|---|---|---|---|
| 1 | `chore(db): restore applied migration 20260708120000...` | C1: the single migration folder | none | provenance `cmp`; fresh install; gate | none | none; message must carry the provenance (commit `5ba3e99`, sha256 `d1061534...2d79`) |
| 2 | `fix(security): ...` | C3 (+ `worker-backend-url.spec.ts`) | 1 | security specs (guard, internal-secret, mass-assignment, role matrix, link-preview, storage-key, public-file-fetch, inbound, whatsapp webhook), realtime 10, whatsapp-web 32, tenant-isolation DB suite, validate-production-secrets | `manage-settings.service.ts` (22 hunks: field whitelisting is C3; personality is C6; subscription removal is C7), `messages.service.ts` (34 hunks: only the media-URL hunk), `knowledge-base.service.ts` (1 hunk, check which effort), `platform-admin` files (C3 role-matrix spec yes, `plans/page.tsx` no) | `git add -A` would pull everything; frontend platform-admin files belong to C7 |
| 3 | `fix(payments): ...` | C4 | 2 (soft: `stripe.gateway.ts`) | payment-match, ledger, webhook integrity, billing webhook, reconciliation typecheck | `billing-webhook.controller.spec.ts` (fixture changes only) | `billing.service.ts` is C7, not this commit |
| 4 | `feat(campaigns): ...` | C5 | 2 | campaigns suites (50), worker typecheck | none | `app.boot.spec.ts` stays out (commit 8) |
| 5 | `feat(billing): remove monthly subscription sales...` | C7, incl. the 4 staged deletions (`git rm` state is already staged) | 2 (soft) | subscription-pricing-removal, subscription-sales specs, frontend/mobile typecheck, billing specs | `manage-settings.service.ts` (subscription hunks), `terms/page.tsx` and `channels/page.tsx` (subscription text vs Telegram/TikTok wording), `billing.service.ts`, `PlatformAdminShell.tsx`, `plans/page.tsx` | the staged deletions must not be left behind; `Pricing*`/`pricing-cards` must go together with their removal test |
| 6 | `feat(rag): hybrid retrieval modules and pgvector image (inactive, nothing wired)` | all **new** C2 files only: `knowledge-base/rag/**`, `hybrid-knowledge-context.source*`, `knowledge-source.providers*`, `third-party/**` (pending 2.4), `infra/postgres/Dockerfile`, `docs/VERZAI_V2_HYBRID_RAG.md` | 1 | rag specs (fusion, retriever, indexer, chunker, flags, reranker, tokenizer, loader, vector-store), pgvector DB suite | none (all additions) | `third-party/**` pending decision; confirm these files compile alone with `tsc --noEmit` |
| 7 | `feat(ai): remove canned replies; structured replies, escalation, refusal, legacy retirement` | C6 | 4 (for `app.boot.spec.ts`), 6 (for `retrieval-trace` import), 2 (soft) | ai-core pipeline/prompts/quality/refusal specs, commerce-ai, messages, ai-logs sandbox, boot spec | `pipeline.types.ts` (take the C6 hunks and the `retrievalTrace` field/type import together), `ai-core.module.ts` (refusal hunk only), `context-assembly`/`generation` stages and specs (C6 hunks), `messages.service.ts` + spec (all except the media-URL hunk), `manage-settings.service.ts` (personality hunks) | the largest commit; reviewers should expect large diffs |
| 8 | `feat(rag): wire hybrid retrieval into the Verz AI pipeline (flag off by default)` | remaining C2 hunks: `knowledgeSourceProviders` in `ai-core.module.ts`, `knowledge-context.source.ts`, hybrid hunks in the two stages/specs/types, `tool-calling*`, `knowledge-base.service.ts`, `hybrid-rag-and-digital-self.integration.spec.ts` | 6, 7 | hybrid regression (10), full pipeline specs, boot spec | the same six shared files, opposite hunks | splitting by hunk is error-prone: if per-commit builds fail, **merge commits 7 and 8** rather than force it |
| 9 | `chore(infra): staging deploy contract...` | C8 | none functionally | every `infra/scripts/tests/*.test.sh` | `docker-compose.staging.yml` (add the hybrid proposal only after the 1.3 decision) | `infra/docker-compose.yml` change is production Compose: include only the `INTERNAL_SECRET` pass-through, and say so in the message |
| 10 | `docs: ...` | C9 | none | none (read for secrets/IPs: scanned, none) | none | audit docs contain operational detail; confirm you want them in the repository |

Verification at each commit (to catch hunk-splitting errors): `git rebase --exec 'cd apps/backend && npx tsc --noEmit && npx jest -- <that commit's specs>' <base>` after creating the commits, and the full `infra/scripts/verify-release-candidate.sh <final SHA>` at the end.
Risk summary: the main risk is a commit that compiles only with a later commit's hunk; the second is a stray file (`git status` must be empty afterwards, and `git diff --cached --stat` reviewed before each commit); the third is committing `infra/.env.staging` (git-ignored; only `*.example` are tracked) or build output (none present).

### 5.3 Migration integrity (re-confirmed at the end of this pass)
`apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql` is **byte-identical** to `git show 5ba3e99:...` (`cmp` clean; sha256 `d1061534a1a7481e3da1fdf7425ce8d43af22b2a3e943b4acf44deb4f2002d79`, equal to the checksum recorded in the staging and production migration tables).

## 6. Summary

1. **What can safely proceed:** local commit preparation on the feature branch (no push), following the revised ten-commit sequence with per-commit builds; the exact-SHA verification script once commits exist; production-Compose remediation planning (separate approval); drafting the test Meta app and Paystack test-account setup.
2. **What requires your decision:** apply the Compose change and `--no-deps` (or the override mechanism) for hybrid RAG; include or exclude the MiniLM notice files; approve the revised commit order (including merging commits 7 and 8 if hunk-splitting fails); whether the audit documents enter the repository; whether the Meta test app needs a hostname on port 443.
3. **What requires external credentials or evidence:** the staging host's live-state export (1.5); staging secrets present and validated (4.1); a test Meta app and Instagram test account; Paystack test keys and webhooks; Resend inbound secret; Hugging Face model-card licence metadata and counsel's view on training data; the host's Docker Compose version.
4. **Is commit preparation safe to authorise?** Yes, with conditions: local commits only, on the existing feature branch, in the revised order, verified build-by-build, nothing pushed, `third-party/**` held back until decided, and the stash `stash@{2026-07-06}` left alone. Nothing about preparing commits touches staging or production.
5. **Is staging still NO-GO?** **Yes.** No committed release candidate exists, the hybrid-RAG preservation decision and live evidence are open, and the staging secrets and test credentials are unconfirmed. Staging becomes a reasonable GO when the commits exist, the exact-SHA verification passes with zero failures, the hybrid decision is closed, and the operator confirms secrets.

---

---

# UPDATE 2 (staging-candidate preparation) - current state

This update supersedes the status of the sections below where they conflict. Nothing was committed, pushed, merged or deployed; staging and production were not contacted; no secret value was printed (secret-bearing checks used throwaway random values or fixed placeholders and a log scan found none).

## U0. Verdict: **NO-GO to deploy; the candidate is prepared but not yet committed**

All technical defects found by preflight are fixed or have a documented, validated proposal, and a full 40-step verification of the working tree passes. The release candidate is still **NOT ESTABLISHED** because nothing is committed, and the exact-SHA verification can only run after commits exist. Open items are in U9.

## U1. Phase 1: preserved state and inventory

| Item | Value |
|---|---|
| Branch / HEAD | `feature/ai-no-canned-replies` / `d5f93b9f8c1e88a3243858fef5ae1cc3ac0819d8` (unchanged) |
| Staged | 4 deletions: `ai-core/prompts/escalation-messages.util.ts` (no remaining importer), `Pricing.tsx`, `Pricing.module.css`, `ui/pricing-cards.tsx` (referenced only by a spec asserting they stay gone). None accidental. |
| Unstaged modified | 116 files (109 at last report + 7 changed in this phase: deploy scripts, tests, worker processors) , +1,817 / -1,306 lines |
| Untracked | 67 entries / 104 files (61 at last report + 6 new in this phase: `lib/staging-required-settings.sh`, 2 shell tests, `verify-release-candidate.sh`, worker `lib/backend-url.ts`, its spec) |
| Stashes / resets | **correction:** the repository has 1 pre-existing stash (`stash@{2026-07-06}`, "On dev: pre-existing uncommitted work (landing/mobile assets)", 15 files; stashes are shared by all worktrees). It is not from this work and was not touched; earlier text saying "0" was wrong. No resets; nothing discarded or overwritten |
| Generated or temporary files | none in the worktree (`dist`, `dist-test`, `.next`, `.DS_Store`, `.expo`, `.pnpm-store` absent; build output I created was removed and is git-ignored) |
| Secrets in the diff | pattern scan found only two test fixtures (`'sk_live_super_secret'` used to prove it is not printed) |
| Restored migration | byte-identical to `git show 5ba3e99:...` (`cmp` clean, SHA-256 `d1061534...2d79`); re-verified at the end of this phase and by the verification script |
| `.gitignore`d, not for commit | `infra/.env.staging` (real settings file) is ignored; only `*.example` files are tracked |

Classification (attribution is by area; the 5 mixed files are listed below the table):

| Group | Files | Meaning |
|---|---|---|
| C1 Restore migration | 1 | `20260708120000_verz_ai_grounded_retrieval` |
| C2 Hybrid RAG | 45 | rag module, pgvector store, MiniLM provider, hybrid source, `third-party` notice, pgvector Dockerfile, design doc |
| C3 Security | 56 | internal auth (backend, realtime, whatsapp-web), webhooks, tenant isolation, SSRF/media, mass assignment, startup validation, platform-admin matrix |
| C4 Payment integrity | 11 | payment matching, ledger, webhooks, reconciliation |
| C5 Campaigns | 7 | scheduled consumer, worker send fixes |
| C6 Verz AI | 49 | no canned replies, structured replies, escalation, refusal, legacy retirement, credits |
| C7 Subscription removal and copy | 35 | billing UI/API removal, pricing components, terms/channels wording |
| C8 Deploy contract and tooling | 14 | Compose, env examples, deploy/recreate/restore scripts, shell tests, verification script |
| C9 Documentation | 6 | audit, remediation, refund design, test plan, business decisions, this preflight |

Re-assignments the automatic rules got wrong: `manage-settings.service.personality.spec.ts` (C6) and `manage-settings.service.subscriptions.spec.ts` (C7); `PlatformAdminShell.tsx` and `platform-admin/plans/page.tsx` (C7); `worker-backend-url.spec.ts` is C3 (worker URL) not C5.
**Mixed files that need hunk-level staging (`git add -p`) because two efforts touch them:** `messages/messages.service.ts` and its spec (C6 plus the C3 media-URL SSRF hunk), `ai-core/pipeline/pipeline.types.ts` (C2 and C6), `manage/settings/manage-settings.service.ts` (C3 field whitelisting, C6 personality, C7 subscription removal), `(legal)/terms/page.tsx` and `(dashboard)/channels/page.tsx` (C7 subscription text plus the Telegram/TikTok wording from C3), `ai-core/ai-core.module.ts` (C2 only, but verify), `billing/billing.service.ts` (C7 plus Stripe lazy init is in `stripe.gateway.ts`, C3).

<details><summary>Full file-by-file inventory (A added, M modified, D deleted)</summary>

**C1: Restore migration (verbatim 5ba3e99) (1 files)**

```
A apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql
```

**C2: Hybrid RAG integration (45 files)**

```
M apps/backend/src/ai-core/ai-core.module.ts
A apps/backend/src/ai-core/pipeline/hybrid-knowledge-context.source.spec.ts
A apps/backend/src/ai-core/pipeline/hybrid-knowledge-context.source.ts
A apps/backend/src/ai-core/pipeline/hybrid-rag-and-digital-self.integration.spec.ts
M apps/backend/src/ai-core/pipeline/knowledge-context.source.ts
A apps/backend/src/ai-core/pipeline/knowledge-source.providers.spec.ts
A apps/backend/src/ai-core/pipeline/knowledge-source.providers.ts
M apps/backend/src/ai-core/tools/tool-calling.execution-record.spec.ts
M apps/backend/src/ai-core/tools/tool-calling.service.ts
M apps/backend/src/knowledge-base/knowledge-base.service.ts
A apps/backend/src/knowledge-base/rag/embedding-adapters.ts
A apps/backend/src/knowledge-base/rag/embedding-provider.ts
A apps/backend/src/knowledge-base/rag/hybrid-fusion.spec.ts
A apps/backend/src/knowledge-base/rag/hybrid-fusion.ts
A apps/backend/src/knowledge-base/rag/hybrid-retriever.spec.ts
A apps/backend/src/knowledge-base/rag/hybrid-retriever.ts
A apps/backend/src/knowledge-base/rag/knowledge-indexer.spec.ts
A apps/backend/src/knowledge-base/rag/knowledge-indexer.ts
A apps/backend/src/knowledge-base/rag/local-minilm/fixtures/embedding-reference-wasm.json
A apps/backend/src/knowledge-base/rag/local-minilm/fixtures/embedding-reference.json
A apps/backend/src/knowledge-base/rag/local-minilm/fixtures/tokenizer-parity.json
A apps/backend/src/knowledge-base/rag/local-minilm/local-minilm.integration.spec.ts
A apps/backend/src/knowledge-base/rag/local-minilm/minilm-embedding-provider.spec.ts
A apps/backend/src/knowledge-base/rag/local-minilm/minilm-embedding-provider.ts
A apps/backend/src/knowledge-base/rag/local-minilm/minilm-loader.spec.ts
A apps/backend/src/knowledge-base/rag/local-minilm/minilm-loader.ts
A apps/backend/src/knowledge-base/rag/local-minilm/wordpiece-tokenizer.spec.ts
A apps/backend/src/knowledge-base/rag/local-minilm/wordpiece-tokenizer.ts
A apps/backend/src/knowledge-base/rag/pgvector-store.integration.spec.ts
A apps/backend/src/knowledge-base/rag/pgvector-store.ts
A apps/backend/src/knowledge-base/rag/rag-flags.spec.ts
A apps/backend/src/knowledge-base/rag/rag-flags.ts
A apps/backend/src/knowledge-base/rag/reranker.spec.ts
A apps/backend/src/knowledge-base/rag/reranker.ts
A apps/backend/src/knowledge-base/rag/retrieval-trace.ts
A apps/backend/src/knowledge-base/rag/semantic-chunker.spec.ts
A apps/backend/src/knowledge-base/rag/semantic-chunker.ts
A apps/backend/src/knowledge-base/rag/testing/concept-embedder.ts
A apps/backend/src/knowledge-base/rag/testing/fixture-kb.ts
A apps/backend/src/knowledge-base/rag/vector-store.spec.ts
A apps/backend/src/knowledge-base/rag/vector-store.ts
A apps/backend/third-party/all-MiniLM-L6-v2/LICENSE
A apps/backend/third-party/all-MiniLM-L6-v2/NOTICE.md
A docs/VERZAI_V2_HYBRID_RAG.md
A infra/postgres/Dockerfile
```

**C3: Security: internal auth, webhooks, tenant isolation, SSRF, mass assignment, startup validation (56 files)**

```
M apps/backend/src/billing/gateways/stripe.gateway.ts
A apps/backend/src/common/guards/internal-api-key.guard.spec.ts
M apps/backend/src/common/guards/internal-api-key.guard.ts
A apps/backend/src/common/security/safe-equal.util.spec.ts
A apps/backend/src/common/security/safe-equal.util.ts
A apps/backend/src/common/security/storage-key.util.spec.ts
A apps/backend/src/common/security/storage-key.util.ts
M apps/backend/src/config/validate-production-secrets.spec.ts
M apps/backend/src/config/validate-production-secrets.ts
M apps/backend/src/contacts/contacts.service.ts
M apps/backend/src/inbound/inbound.controller.spec.ts
M apps/backend/src/inbound/inbound.controller.ts
A apps/backend/src/knowledge-base/public-file-fetch.spec.ts
M apps/backend/src/knowledge-base/public-page-fetch.ts
M apps/backend/src/main.ts
A apps/backend/src/manage/settings/dto/settings.dto.ts
A apps/backend/src/manage/settings/manage-settings.controller.internal-secret.spec.ts
M apps/backend/src/manage/settings/manage-settings.controller.ts
A apps/backend/src/manage/settings/manage-settings.mass-assignment.spec.ts
A apps/backend/src/manage/settings/manage-settings.service.personality.spec.ts
A apps/backend/src/manage/settings/manage-settings.service.subscriptions.spec.ts
M apps/backend/src/manage/settings/manage-settings.service.ts
M apps/backend/src/media/media.controller.ts
M apps/backend/src/media/storage.service.ts
A apps/backend/src/messages/link-preview.controller.spec.ts
M apps/backend/src/messages/link-preview.controller.ts
M apps/backend/src/platform-admin/platform-admin-auth.service.ts
A apps/backend/src/platform-admin/platform-admin.role-matrix.spec.ts
M apps/backend/src/realtime/realtime.service.ts
A apps/backend/src/tenant-isolation.db.spec.ts
A apps/backend/src/tenant/dto/update-onboarding.dto.ts
M apps/backend/src/tenant/tenant.controller.ts
A apps/backend/src/tenant/tenant.onboarding.mass-assignment.spec.ts
M apps/backend/src/tenant/tenant.service.ts
M apps/backend/src/whatsapp/whatsapp.webhook.controller.spec.ts
M apps/backend/src/whatsapp/whatsapp.webhook.controller.ts
M apps/frontend/src/app/platform-admin/PlatformAdminShell.tsx
M apps/frontend/src/app/platform-admin/plans/page.tsx
M apps/realtime/package.json
A apps/realtime/src/gateway.isolation.test.ts
M apps/realtime/src/gateway.ts
M apps/realtime/src/index.ts
A apps/realtime/src/internal-auth.ts
A apps/realtime/src/realtime.test.ts
A apps/realtime/src/rooms.ts
A apps/realtime/tsconfig.test.json
M apps/whatsapp-web/src/index.ts
A apps/whatsapp-web/src/internal-auth.test.ts
A apps/whatsapp-web/src/internal-auth.ts
M apps/whatsapp-web/src/session-manager.ts
A apps/worker/src/lib/backend-url.ts
M apps/worker/src/processors/ai-trial.processor.ts
M apps/worker/src/processors/automation.processor.ts
M apps/worker/src/processors/billing-cron.processor.ts
M apps/worker/src/processors/sla-monitor.processor.ts
M apps/worker/src/processors/snooze.processor.ts
```

**C4: Payment integrity (11 files)**

```
M apps/backend/src/billing/billing-webhook.controller.spec.ts
M apps/backend/src/billing/billing-webhook.controller.ts
A apps/backend/src/billing/billing-webhook.payment-integrity.spec.ts
M apps/backend/src/commerce/ledger/commerce-ledger.service.spec.ts
M apps/backend/src/commerce/ledger/commerce-ledger.service.ts
A apps/backend/src/commerce/ledger/commerce-ledger.take-rate.spec.ts
M apps/backend/src/commerce/webhooks/commerce-webhook.controller.ts
A apps/backend/src/commerce/webhooks/commerce-webhook.payment-integrity.spec.ts
A apps/backend/src/common/payments/payment-match.util.spec.ts
A apps/backend/src/common/payments/payment-match.util.ts
M apps/worker/src/processors/commerce-reconciliation.processor.ts
```

**C5: Campaign execution and reliability (7 files)**

```
A apps/backend/src/campaigns/campaign-send.worker.spec.ts
M apps/backend/src/campaigns/campaigns.module.ts
A apps/backend/src/campaigns/campaigns.scheduling.spec.ts
M apps/backend/src/campaigns/campaigns.service.ts
A apps/backend/src/campaigns/scheduled-campaign.processor.ts
A apps/backend/src/campaigns/worker-backend-url.spec.ts
M apps/worker/src/processors/campaign-send.processor.ts
```

**C6: Verz AI: no canned replies, structured replies, credits, escalation, refusals (49 files)**

```
M apps/backend/package.json
A apps/backend/scripts/legacy-retirement-readiness.ts
A apps/backend/src/ai-core/credits/credit-governed-ai.spec.ts
A apps/backend/src/ai-core/migration/legacy-retirement.util.spec.ts
A apps/backend/src/ai-core/migration/legacy-retirement.util.ts
M apps/backend/src/ai-core/pipeline/pipeline.types.ts
M apps/backend/src/ai-core/pipeline/stages/context-assembly.stage.spec.ts
M apps/backend/src/ai-core/pipeline/stages/context-assembly.stage.ts
M apps/backend/src/ai-core/pipeline/stages/escalation.stage.spec.ts
M apps/backend/src/ai-core/pipeline/stages/escalation.stage.ts
M apps/backend/src/ai-core/pipeline/stages/generation.stage.spec.ts
M apps/backend/src/ai-core/pipeline/stages/generation.stage.ts
M apps/backend/src/ai-core/pipeline/stages/guard.stage.spec.ts
M apps/backend/src/ai-core/pipeline/stages/guard.stage.ts
M apps/backend/src/ai-core/pipeline/stages/policy.stage.spec.ts
M apps/backend/src/ai-core/pipeline/stages/policy.stage.ts
A apps/backend/src/ai-core/pipeline/stages/prompt-build.stage.spec.ts
M apps/backend/src/ai-core/pipeline/stages/prompt-build.stage.ts
M apps/backend/src/ai-core/pipeline/verz-ai-pipeline.spec.ts
D apps/backend/src/ai-core/prompts/escalation-messages.util.ts
A apps/backend/src/ai-core/prompts/handoff-context.spec.ts
A apps/backend/src/ai-core/prompts/handoff-context.ts
A apps/backend/src/ai-core/prompts/prompts.controller.authz.spec.ts
M apps/backend/src/ai-core/prompts/prompts.controller.ts
M apps/backend/src/ai-core/prompts/prompts.service.spec.ts
M apps/backend/src/ai-core/prompts/prompts.service.ts
M apps/backend/src/ai-core/prompts/response-rules.spec.ts
A apps/backend/src/ai-core/prompts/retired-wording.ts
A apps/backend/src/ai-core/prompts/seed/responder-system.seed.spec.ts
M apps/backend/src/ai-core/prompts/seed/responder-system.v1.ts
M apps/backend/src/ai-core/prompts/shared-identity-block.ts
M apps/backend/src/ai-core/quality/harness.ts
A apps/backend/src/ai-core/quality/no-canned-replies.spec.ts
M apps/backend/src/ai-core/quality/scenarios.ts
A apps/backend/src/ai-core/refusal/security-refusal.service.spec.ts
A apps/backend/src/ai-core/refusal/security-refusal.service.ts
M apps/backend/src/ai-logs/ai-logs.controller.sandbox.spec.ts
M apps/backend/src/ai-logs/ai-logs.controller.ts
A apps/backend/src/ai-logs/ai-logs.module-graph.spec.ts
M apps/backend/src/ai-logs/ai-logs.module.ts
M apps/backend/src/ai/ai-responder.service.ts
A apps/backend/src/app.boot.spec.ts
M apps/backend/src/commerce/ai/commerce-ai.service.spec.ts
M apps/backend/src/commerce/ai/commerce-ai.service.ts
M apps/backend/src/commerce/evaluation/evaluation-runner.service.ts
M apps/backend/src/commerce/evaluation/evaluation-scoring.service.spec.ts
M apps/backend/src/commerce/evaluation/evaluation-scoring.service.ts
M apps/backend/src/messages/messages.service.spec.ts
M apps/backend/src/messages/messages.service.ts
```

**C7: Subscription-sales removal and customer-facing copy (35 files)**

```
M apps/backend/src/billing/billing.controller.ts
M apps/backend/src/billing/billing.service.checkout.spec.ts
A apps/backend/src/billing/billing.service.subscription-sales.spec.ts
M apps/backend/src/billing/billing.service.ts
A apps/backend/src/billing/subscription-pricing-removal.spec.ts
A apps/backend/src/billing/subscription-sales-routes.spec.ts
A apps/backend/src/billing/subscription-sales.util.spec.ts
A apps/backend/src/billing/subscription-sales.util.ts
M apps/backend/src/users/users.service.ts
M apps/frontend/scripts/seo-check.mjs
M apps/frontend/src/app/(dashboard)/ai/page.tsx
M apps/frontend/src/app/(dashboard)/billing/page.tsx
M apps/frontend/src/app/(dashboard)/channels/page.tsx
M apps/frontend/src/app/(dashboard)/dashboard/page.tsx
M apps/frontend/src/app/(landing)/page.tsx
M apps/frontend/src/app/(legal)/api-docs/page.tsx
M apps/frontend/src/app/(legal)/changelog/page.tsx
M apps/frontend/src/app/(legal)/terms/page.tsx
M apps/frontend/src/app/book-demo/page.tsx
M apps/frontend/src/components/dashboard/BusinessCard.tsx
M apps/frontend/src/components/site/FinalCta.tsx
M apps/frontend/src/components/site/Hero.tsx
M apps/frontend/src/components/site/Overview.tsx
D apps/frontend/src/components/site/Pricing.module.css
D apps/frontend/src/components/site/Pricing.tsx
M apps/frontend/src/components/site/SiteFooter.tsx
M apps/frontend/src/components/site/SiteNav.tsx
M apps/frontend/src/components/site/Trust.tsx
M apps/frontend/src/components/site/data.ts
D apps/frontend/src/components/ui/pricing-cards.tsx
M apps/frontend/src/lib/api.ts
M apps/mobile/app/(app)/billing/index.tsx
M apps/mobile/app/(app)/index.tsx
M apps/mobile/app/(app)/settings/index.tsx
M packages/api/src/endpoints/billing.ts
```

**C8: Staging deploy contract and verification tooling (14 files)**

```
M infra/.env.example
M infra/.env.staging.example
M infra/docker-compose.staging.yml
M infra/docker-compose.yml
A infra/scripts/lib/staging-required-settings.sh
M infra/scripts/staging-recreate.sh
M infra/scripts/staging-release-deploy.sh
M infra/scripts/staging-verify-backup-restore.sh
A infra/scripts/tests/staging-compose-env.test.sh
M infra/scripts/tests/staging-migration-gate.test.sh
M infra/scripts/tests/staging-recreate.test.sh
A infra/scripts/tests/staging-required-settings.test.sh
M infra/scripts/tests/staging-verify-backup-restore.test.sh
A infra/scripts/verify-release-candidate.sh
```

**C9: Documentation (6 files)**

```
A docs/BUSINESS_LEGAL_DECISIONS.md
A docs/COMMERCE_REFUND_DESIGN.md
A docs/REAL_INTEGRATION_TEST_PLAN.md
A docs/RELEASE_BLOCKER_REMEDIATION_2026-11-02.md
A docs/RELEASE_READINESS_2026-11-02.md
A docs/STAGING_RELEASE_PREFLIGHT_2026-11-02.md
```

</details>

**Should not enter the release without a decision:** `apps/backend/third-party/all-MiniLM-L6-v2/*` (its own NOTICE says training-data provenance is unverified; accept the licence risk or leave out C2); `infra/docker-compose.yml` (production Compose, only adds `INTERNAL_SECRET` pass-through, but has the same worker gaps as staging, see U2); `docs/*` (audit documents contain operational detail; confirm you want them in the repository); `scripts/legacy-retirement-readiness.ts` plus the `ai:legacy-readiness` npm script (an operations tool, harmless but unrelated to staging).

## U2. Phase 2: deploy-contract defects fixed

| # | Defect | Fix | Proof |
|---|---|---|---|
| 1 | Deploy script required only 6 settings | New `infra/scripts/lib/staging-required-settings.sh`; the release script now requires `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` as well, and checks the encryption key decodes to exactly 32 bytes (never printing it) | `tests/staging-required-settings.test.sh`: 32 checks, each variable missing and empty, format check, no value ever printed |
| 1b | `staging-recreate.sh check` did not compare the new shared secrets with production | fails when `INTERNAL_SECRET` or `WHATSAPP_WEB_INTERNAL_API_KEY` is identical in both files | `tests/staging-recreate.test.sh`: 13 checks (was 9), output shows no value |
| 2 | Worker lacked `CREDENTIALS_ENCRYPTION_KEY`, `PAYSTACK_SECRET_KEY`, `PUBLIC_BASE_URL` | added to the staging worker; `PUBLIC_BASE_URL` = staging address + `/api/v1` | `tests/staging-compose-env.test.sh`: 61 checks incl. no production address in the worker block |
| 3 | Worker `BACKEND_URL` omitted `/api/v1` (internal notifications 404, swallowed) | `apps/worker/src/lib/backend-url.ts` `backendApiBase()` accepts either form and always returns the prefixed one; used by the AI-trial and billing-cron processors; staging Compose sets `BACKEND_URL: http://backend:3001/api/v1` | 9 unit tests; **live**: worker job completed with no failure while a bare call to the unprefixed path returned 404 and the prefixed path 201 |
| 4 | `RESEND_WEBHOOK_SECRET` not passed to staging backend | added (plus `PAYSTACK_PUBLIC_KEY`, which the code reads) and listed in `.env.staging.example` | Compose test |
| 5 | Cross-check of every service's variables | done against source: backend/worker/realtime/whatsapp-web names verified in code; realtime `JWT_SECRET` is the same Compose variable as the backend's; whatsapp-web `BACKEND_INTERNAL_URL` is host-only by design (the service appends `/api/v1`); no variable invented. Compose test also asserts `SKIP_2FA`, `SKIP_EMAIL_VERIFICATION`, `WEBHOOK_ALLOW_PRIVATE_URLS` and the `*_TEST_DATABASE_URL` variables are never set on any service | Compose test |
| 6 (new) | Restore rehearsal fails on staging's real database | see U5 | rehearsal |

**Production gap, not changed (outside the staging brief):** `infra/docker-compose.yml`'s worker has the same missing `CREDENTIALS_ENCRYPTION_KEY`, `PAYSTACK_SECRET_KEY`, `PUBLIC_BASE_URL`. The worker URL bug is fixed in code for both. Fix the production Compose in the production release.

## U3. Phase 3: hybrid-RAG reconciliation

Source of truth used: the operator scripts and outputs in `~/verz-hybrid-rag-validation/` (steps C, D, E, F, G, the Postgres swap scripts A/B and their outputs, `staging-rollout-runbook.md`, `server-audit-output.txt`) and the e2acaaa patch. Staging was not contacted.

**Documented live configuration (recorded 2026-11-02, UNVERIFIED today):**
| Piece | Value |
|---|---|
| Backend image | `verzchat-staging/backend:e2acaaa11660c1c893d6c2b7533097ab34fe1aad` (the hybrid branch commit on top of base `d5f93b9`), not a `d5f93b9` image |
| Postgres image | `verzchat-staging/postgres-pgvector:16.15-0.8.7`, built from `infra/postgres/Dockerfile` with `PG_IMAGE=postgres:16.15-alpine`, `PGVECTOR_VERSION=v0.8.7`, `OPTFLAGS=""`; same data volume `staging_postgres_staging_data`; previous image `postgres:16-alpine` id `0cefaabd882e` |
| Database state | `CREATE EXTENSION vector` 0.8.7 run by hand; table `kb_vector_chunks` (from `ensurePgVectorSchema`, **not** a Prisma migration, so absent from a fresh install); 3 indexes, **0 ANN (hnsw/ivfflat) indexes (must stay 0**, otherwise the stock image cannot read the table); pilot tenant `08dd98ed` has 6 chunks (model `Xenova/all-MiniLM-L6-v2@751bff3:int8`) |
| Backend mounts (read-only) | `/opt/verz-models/all-MiniLM-L6-v2` to `/models/all-MiniLM-L6-v2`; `/opt/verz-ort` to `/ort` |
| Pinned files | `tokenizer.json` sha256 `da0e7993...c62a0`; `model_quantized.onnx` sha256 `afdb6f1a...bdb1`; `onnxruntime-web` 1.31.1 on the mount |
| Backend env | `NODE_PATH=/ort/node_modules`, `EMBEDDING_MODEL_DIR=/models/all-MiniLM-L6-v2`, `RAG_HYBRID_ENABLED=true`, `EMBEDDING_PROVIDER=local-minilm` |
| How it was applied | three override files in `/root/staging-hybrid-rag-e2acaaa/` (`override.postgres.yml`, `override.backend.yml`, `override.enable.yml`) layered on the candidate's `docker-compose.staging.yml`; env file `/root/staging-ai-v2-checkout/infra/.env.staging` |
| Feature flag | `verz_ai_v2` effective for the pilot tenant |

**What this branch already contains:** the hybrid code (rag module, hybrid source, providers) applied hunk-by-hunk on `d5f93b9`, with Digital Self preserved and 10 regression tests; pgvector suite 13/13 on a real pgvector Postgres (synthetic embeddings only).

**The hazard (found by reading the deploy script):** `staging-release-deploy.sh` runs `compose up -d --force-recreate backend worker realtime whatsapp-web frontend` **without `--no-deps`**, using only the repo's `docker-compose.staging.yml`. Two consequences: (a) *(corrected in UPDATE 3: a local experiment did NOT reproduce this)* Postgres is a dependency whose repo definition is the stock `postgres:16-alpine`; I assumed a normal deploy could recreate it on the stock image, but with Docker Compose 5.3.1 `up -d --force-recreate app` left a differing dependency container untouched (UPDATE 3, section 1.2). The host's Compose version is unknown, so this stays a version-dependent risk, not a confirmed one; (b) the recreated backend loses the mounts and RAG env (no override files), so hybrid silently reverts to keyword retrieval. Existing hybrid functionality would be removed by the deploy itself.

**Minimal repository change (proposed, validated, NOT applied; this phase asked for a proposal):** in `infra/docker-compose.staging.yml`
```yaml
  postgres:
    image: verzchat-staging/postgres-pgvector:16.15-0.8.7        # was postgres:16-alpine
    build:
      context: ./postgres
      args: { PG_IMAGE: "postgres:16.15-alpine", PGVECTOR_VERSION: v0.8.7 }
  backend:
    environment:
      NODE_PATH: /ort/node_modules
      EMBEDDING_MODEL_DIR: /models/all-MiniLM-L6-v2
      RAG_HYBRID_ENABLED: ${RAG_HYBRID_ENABLED:-}              # unset = keyword retrieval, as today
      EMBEDDING_PROVIDER: ${EMBEDDING_PROVIDER:-}
    volumes:
      - /opt/verz-models/all-MiniLM-L6-v2:/models/all-MiniLM-L6-v2:ro
      - /opt/verz-ort:/ort:ro
```
Validated with `docker-compose config` on a temporary copy (exit 0; resolves to the pgvector image; repo file untouched). Settings `RAG_HYBRID_ENABLED=true`, `EMBEDDING_PROVIDER=local-minilm` then go in the host's `.env.staging`, not the repository. Also add `postgres` to the deploy script's image build/skip handling and `--no-deps` (or an explicit exclusion) so a release never recreates the database container; that is a script change I did not make.

**Status: BLOCKED on a live-state export (read-only, names and hashes only).** The operator must confirm today's live values still match the table above. Safe export to run on the staging host and share:
```bash
docker inspect -f '{{.Config.Image}}' wa_staging_postgres wa_staging_backend
docker inspect -f '{{range .Mounts}}{{.Source}}->{{.Destination}}:{{if .RW}}rw{{else}}ro{{end}} {{end}}' wa_staging_backend
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_backend | cut -d= -f1 | sort      # NAMES ONLY
docker exec wa_staging_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select extname||' '||extversion from pg_extension where extname='vector'"
docker exec wa_staging_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from kb_vector_chunks; select count(*) from pg_indexes where tablename='kb_vector_chunks' and indexdef ~* 'hnsw|ivfflat'"
sha256sum /opt/verz-models/all-MiniLM-L6-v2/tokenizer.json /opt/verz-models/all-MiniLM-L6-v2/onnx/model_quantized.onnx
ls /root/staging-hybrid-rag-e2acaaa/ ; cat /root/staging-hybrid-rag-e2acaaa/override.*.yml
```
(`override.*.yml` contain no secrets per the recorded scripts; the env block dump above prints names only. Never run `docker inspect` on the env without the `cut`.)

## U4. Phase 4: deploy-contract test results

All run locally, no Docker daemon of any server. `bash infra/scripts/tests/<file>`:

| Test | Result |
|---|---|
| staging-release-contract | 22/22 |
| staging-migration-gate | 22/22 (exclusion list updated for the new local-only verification script) |
| staging-recreate | 13/13 |
| staging-required-settings (new) | 32/32 |
| staging-compose-env (new) | 61/61 |
| staging-verify-backup-restore | 15/15 |
| staging-ai-preflight | 47/47 |
| staging-eval-baseline | 54/54 |
| production-recreate | 17/17 |
`bash -n` passes for every script touched; shellcheck is not installed here (not run).

Review of what `staging-release-deploy.sh` invokes: `lib/staging-migration-gate.sh`, `lib/staging-required-settings.sh` (new), `staging-recreate.sh check`, `staging-migration-preflight.sql`, `staging-verify-backup-restore.sh`, `docker compose` (build/run/up), `prisma migrate status|deploy`. `backup.sh`, `staging-phase-a-*`, `production-*` are not invoked by it.

**Migration gates (executed against the real checksums of a database built from this tree):** (a) this tree incl. the restored folder, no exception: PASS; (b) candidate without the folder, strict: REFUSED with the exact reason; (c) without the folder but `STAGING_ALLOWED_EXTRA_MIGRATIONS=20260708120000_verz_ai_grounded_retrieval`: PASS; (d) an edited applied migration: REFUSED; (e) the restored folder tampered, even with the exception set: REFUSED (checksum is still compared); (f) an unknown name in the variable: REFUSED. **Conclusion:** with the folder committed the exception is unnecessary and must not be set; the allow-list entry can stay or go with no effect.

## U5. Phase 4: backup and restore rehearsal (disposable local infrastructure)

Environment: Colima Docker VM on this Mac (local socket; context verified not remote), PostgreSQL 16 + pgvector 0.8.7 image, Redis 7. Source DB `waplatform_staging` built by `prisma migrate deploy` of this tree (95 migrations), seeded with 2 tenants, 200 contacts, 200 conversations, 20 articles, plus the `vector` extension and a `kb_vector_chunks` table with 20 vectors. Dump taken with the release script's own command (`pg_dump -Fc`).

| Step | Result |
|---|---|
| Existing rehearsal script, database **without** extensions | PASS |
| Existing rehearsal script, database **with** the vector extension (what staging now is) | **FAIL**: `extension "vector" is not available` (stock `postgres:16-alpine`). **A real release would have aborted at its mandatory backup step.** |
| Fix: `RESTORE_CHECK_IMAGE` (default unchanged), and the release script passes the image the staging Postgres is actually running | rehearsal PASS with the matching image; 3 new assertions in the script's test |
| Full restore into a fresh server | `pg_restore --exit-on-error` exit 0; row counts equal for tenants, contacts, conversations, articles, vector chunks, migrations (2, 200, 200, 20, 20, 95) |
| Content check | contacts md5 and vector-rows md5 identical source vs restored; extension 0.8.7 present; nearest-neighbour query returns the expected row |
| Schema check | `pg_dump -s` identical except random dump tokens |
| `prisma migrate status` / `deploy` on the restored DB | "up to date" / "No pending migrations" |
| `staging-migration-preflight.sql` on the restored DB | exit 0, all six conflict counters 0 |
| Rollback guards (the SQL the rollback runs) | unfinished-migration guard passes on a clean DB and **raises** when an unfinished row is inserted; phone-less contacts 0; unresolved credit reservations 0 |
| Startup after restore | production-mode boot of backend, realtime, worker, whatsapp-web against the restored DB with throwaway secrets: backend health 200 and ready 200; realtime health 200 and `/internal/emit` 401 without the secret; whatsapp-web health 200, 401 without the key; worker "All workers started" |
| Worker to backend path | job completed, no failure; unprefixed path 404, prefixed path 201 (the defect and the fix, live) |
| Graceful shutdown | SIGTERM on the real node processes: worker, whatsapp-web, realtime, backend each exit within 1 s; worker logged "Graceful shutdown", realtime logged "closing connections"; no orphan processes; no "unhandled" in any log; none of the five throwaway secret values appears in any log |
| Not done | the actual release script (needs root and the staging Docker daemon); a restore of the real staging dump; whatsapp-web has no SIGTERM handler (it exits immediately without closing sessions cleanly) |

**Rollback behaviour and irreversible operations (unchanged, reconfirmed from code):** rollback is image-only and gated by the SQL guards above; it does not restore Compose or env changes, so an operator who changed `.env.staging` must revert it separately. The database dump is the only way back from a bad migration, and it discards writes since the dump. Irreversible: sent WhatsApp/Instagram/email messages, Paystack test charges, changed Meta webhook registrations, rotating `CREDENTIALS_ENCRYPTION_KEY` (credentials unreadable) or `JWT_SECRET` (everyone signed out). This candidate adds no executable migration, so a code-only rollback is the expected path.

## U6. Phase 5: proposed commit sequence (on the existing feature branch; NOT executed)

Promotion stays `feature/ai-no-canned-replies` to `dev` to `staging` to `main` by pull request; do not commit to `staging` directly. Run `git status` and `git diff --cached --stat` before each commit, and use `git add -p` for the mixed files. Conventional Commits; each commit builds and passes its own tests where possible (C2 depends on C6 for `pipeline.types.ts`).

| # | Commit message | Contents | Notes |
|---|---|---|---|
| 1 | `chore(db): restore applied migration 20260708120000_verz_ai_grounded_retrieval` | C1 | body: copied byte-for-byte from `5ba3e99` (branch `feature/verz-ai-grounded-reply-engine`); already applied on staging and production; SHA-256 `d1061534...2d79`; additive only |
| 2 | `feat(ai): remove canned replies, structured replies, escalation and refusal` | C6 (+ the mixed-file hunks that belong to it) | the largest functional change |
| 3 | `feat(billing): remove monthly subscription sales from customer screens` | C7 | the 4 staged deletions go here (`git rm` already staged) |
| 4 | `fix(security): fail closed on internal secrets, webhooks and startup; isolate tenants and realtime` | C3 + the `messages.service.ts` media-URL hunk | |
| 5 | `fix(payments): verify amount, currency, reference and state before any financial change` | C4 | |
| 6 | `feat(campaigns): consume scheduled campaigns and settle every outcome` | C5 | |
| 7 | `feat(rag): hybrid retrieval with pgvector and local embeddings (flag off by default)` | C2 | decide the MiniLM notice first; nothing here runs unless `RAG_HYBRID_ENABLED=true` |
| 8 | `chore(infra): staging deploy contract, restore rehearsal image, release verification` | C8 | after the U3 compose proposal is decided, add it here |
| 9 | `docs: release audit, remediation, refund design, integration test plan, staging preflight` | C9 | |

Migration provenance must appear in commit 1's message (above) and in `docs/RELEASE_BLOCKER_REMEDIATION_2026-11-02.md` (already there).
Order rationale: schema first, AI behaviour, product copy, then hardening, then optional capability, then tooling and docs.

## U7. Phase 6: exact-SHA verification

New script `infra/scripts/verify-release-candidate.sh <40-char-sha>`. It refuses unless HEAD equals the SHA and the tree is clean (`ALLOW_DIRTY=1` rehearses it but stamps the result "NOT A RELEASE VERIFICATION" and exits 3). It uses only disposable local containers and prints no secret.
```bash
git checkout feature/ai-no-canned-replies && git status --porcelain --untracked-files=all   # must print nothing
SHA=$(git rev-parse HEAD)
VERIFY_PG_IMAGE=<postgres 16 image with pgvector 0.8.x> bash infra/scripts/verify-release-candidate.sh "$SHA" | tee verify-$SHA.txt
```
Steps (40 in the last run): migration provenance and tree; fresh install, status, schema vs `schema.prisma`; 50-to-95 upgrade with a surviving row; migration gate; backup-restore rehearsal with the vector extension; typecheck of backend, frontend, mobile, worker, realtime, whatsapp-web; **full backend Jest with every database-gated suite enabled** (tenant isolation, media library, Digital Self with Redis, pgvector store, each on its own disposable database because those suites TRUNCATE tables) covering security, payment, campaign, hybrid-RAG regression, boot-graph and all unit suites; realtime tests including the real-socket isolation tests; whatsapp-web tests; every `infra/scripts/tests/*.test.sh`; builds; live boot of the four services with health, auth refusals, the worker-to-backend path and SIGTERM; log scan for unhandled errors and secret values.
Not covered: frontend and mobile tests (no runner exists), the real-embedding MiniLM suite (needs model files; it is skipped and reported), real Meta/Paystack/Stripe calls, the staging host itself.

**Dry run on this dirty tree (pre-commit, ALLOW_DIRTY=1, `ragtest/pg16-pgvector:arm64`): 40 steps PASS, 0 FAIL.** Jest: 242 suites passed, 1 skipped (the real-model suite); 3,796 tests passed, 35 skipped. The first dry run found two genuine defects that are now fixed: the production-isolation shell test did not know about the new local-only script, and the database suites interfered when sharing one database. This is evidence about the working tree only, **not** about a commit.

## U8. Status of the earlier blocking findings (section 8 below)

| # | Finding | Status |
|---|---|---|
| 1 | No release candidate | OPEN (needs your commits) |
| 2 | Deploy script missing required secrets | FIXED, tested |
| 3 | Worker Compose gaps | FIXED, tested (staging); production Compose still has them |
| 4 | Worker `BACKEND_URL` | FIXED in code and staging Compose, tested live |
| 5 | `RESEND_WEBHOOK_SECRET` | FIXED |
| 6 | Hybrid-RAG drift | PROPOSED and validated; live state export BLOCKED; the deploy script WILL recreate the backend without the RAG mounts/env (certain); Postgres recreation is version-dependent (see UPDATE 3) |
| 7 | Staging shares production's Meta callback | OPEN (manual) |
| 8 | Dirty tree unreviewed | INVENTORIED (U1); review and commit are yours |
| 9 | No real-provider / acceptance evidence | OPEN |
| new | Restore rehearsal fails on a database with the vector extension | FOUND and FIXED in this phase |

## U9. Remaining blockers and decisions

1. **Commit the work** per U6 (your approval needed), then run U7 on the resulting SHA and record its summary here. Until then no candidate exists.
2. **Decide U3:** apply the proposed Compose change (and add `--no-deps`/exclude Postgres in the deploy script) so a deploy cannot undo hybrid RAG; provide the live-state export so I can confirm it matches. Until decided, **do not run the release script against the current staging server**: it recreates the backend from the repository Compose alone, which drops the model mounts and RAG settings (hybrid silently reverts to keyword retrieval).
3. Decide whether `third-party` MiniLM files and notice enter the repository.
4. Production Compose worker gaps (`CREDENTIALS_ENCRYPTION_KEY`, `PAYSTACK_SECRET_KEY`, `PUBLIC_BASE_URL`) before any production release.
5. Provision the secrets listed in section 4 on the staging host and run the section 5 validation procedure; create the test Meta app and Paystack test credentials (section 9 actions 5 to 8).
6. Real-provider evidence (sections 10 B to F below) remains absent; whatsapp-web has no graceful-shutdown handler.

## U10. GO/NO-GO

**NO-GO for deploying to staging today.** Reasons: no committed release candidate; the hybrid-RAG Compose decision is open and the current deploy script would drop the live backend's hybrid setup; staging secrets and Meta/Paystack test credentials are not confirmed.
**GO for committing the work and running the exact-SHA verification** (U6, U7): every technical blocker found by preflight is fixed or has a validated proposal, and the working tree passes all 40 verification steps. Staging becomes a reasonable GO when items 1, 2 and 5 of U9 are done and the exact-SHA run passes with zero failures. This is not a production readiness statement.

---

# Original preflight (earlier today; statuses superseded by UPDATE 2 where they conflict)

## 0. Verdict

**NO-GO for staging.** The exact release candidate cannot be established: every remediation change exists only as uncommitted work on top of `d5f93b9`, and the repository's own staging deploy script refuses a dirty checkout. In addition, preflight found defects that would break or silently degrade a staging deploy even once the work is committed (section 8, "Blocking findings").

## 1. Branch, SHA and worktree

| Item | Value |
|---|---|
| Worktree | `/Users/breezyyy/verz-worktrees/no-canned-replies` |
| Branch | `feature/ai-no-canned-replies` |
| HEAD | `d5f93b9f8c1e88a3243858fef5ae1cc3ac0819d8` ("fix(ai): read a 0-1 confidence as a fraction and pin the structured-reply contract with tests", 2026-11-02) |
| Merge base with `origin/main` | `e0c6b021805378f9691103a19aa68ff7342be2d0` |
| `origin/staging` | `5ff4a0eb758b8dfee022f3e68457e63603f75e03`; HEAD is 70 commits ahead of it |
| Stashes | 0 |
| Worktree state | **DIRTY**: 109 modified, 4 staged deletions (`Pricing.tsx`, `Pricing.module.css`, `pricing-cards.tsx`, `ui/pricing-cards` area, from the subscription-sales removal), 60 untracked entries; diff against HEAD is about 1,773 insertions and 1,298 deletions |
| Untracked, deliberately new | the restored migration folder, `common/payments`, `common/security`, the realtime/whatsapp-web `internal-auth` files and tests, the `rag/` and `third-party/` trees, `infra/postgres/`, the `docs/*` reports |

Note: the five documents named in the task live in `docs/` (for example `docs/COMMERCE_REFUND_DESIGN.md`); there are no copies at the repository root.

## 2. Release candidate status: **NOT ESTABLISHED**

Why:
1. No commit contains the work. `d5f93b9` has none of the Round 1-3 fixes (payment integrity, internal secrets, hybrid RAG, campaign consumer, mass-assignment fixes, realtime isolation, restored migration). Deploying `d5f93b9` would ship the vulnerabilities the audit found.
2. `infra/scripts/staging-release-deploy.sh deploy <sha>` requires a full 40-character SHA equal to the checkout HEAD, a clean tree (`git status --porcelain --untracked-files=all` empty), `CONFIRM_STAGING_RELEASE=<sha>`, and a backup-restore rehearsal. A dirty tree is refused.
3. The uncommitted set mixes work from different efforts (subscription-sales removal, Digital Self, hybrid RAG, remediation). It has not been reviewed as one reviewable diff, and the `Pricing`/`pricing-cards` deletions are staged while everything else is not.
4. All verification so far (Rounds 1-3) ran against this dirty tree. Those results prove the tree as it stood, not a specific commit.

What is needed to establish a candidate (your actions; I was told not to commit): review the diff and `git status` for stray files; confirm `.pnpm-store/`, `.DS_Store` and `apps/mobile/.expo/*` are not committed (they appear in the status of the main checkout and must not ride into a release); commit on a feature branch, promote through `dev` and `staging` per the repository workflow; then re-run the full verification on that exact SHA and record it here. Until then this document describes the intended candidate, not a release.

## 3. Migration status and provenance

- Folder `apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql` **is present** (4,097 bytes, untracked in git, i.e. not yet committed).
- SHA-256 `d1061534a1a7481e3da1fdf7425ce8d43af22b2a3e943b4acf44deb4f2002d79`, **identical** to `git show 5ba3e99:.../migration.sql` and to the checksum recorded in the production and staging `_prisma_migrations` captures.
- Provenance: commit `5ba3e994c921f049b662f3e1a51bdbd64d12ddb7`, author collinsasante, 2026-07-08 12:20:52 UTC, "feat(ai): grounded retrieval, verification gate, and escalation logic", contained only in `feature/verz-ai-grounded-reply-engine` (plus some `*-dev` branches), not in `main`, `staging`, `dev`, `d5f93b9` or this branch.
- Content: additive only (`CREATE TABLE IF NOT EXISTS knowledge_base_chunks`, `ai_knowledge_gaps`; `ADD COLUMN IF NOT EXISTS` on `ai_interaction_logs` and `tenant_settings`; GIN index). No drops or data changes. The current code does not use these objects.
- Tree checks: 95 migration folders, each with `migration.sql`; names sort strictly in timestamp order; no duplicate timestamps; `migration_lock.toml` provider `postgresql`. Latest two: `20261030120000_ai_digital_self`, `20261030130000_digital_self_learning_exclusion`.
- Executable migrations new to staging in this candidate: **none** beyond what staging has already applied (the restored folder is already applied there, per the captured staging table). The newest migrations (`ai_credit_reservations`, `preserve_legacy_schema_values`, Digital Self x2) are in staging's captured history as well (95 distinct names, 95 finished). **UNVERIFIED for the live server today**: the capture predates any later changes.
- Interaction with the repository's own gate: `docs/staging-release.md` documents `STAGING_ALLOWED_EXTRA_MIGRATIONS=20260708120000_verz_ai_grounded_retrieval` as an exception for a candidate that lacks the folder. With the folder restored the gate compares its checksum, which matches, so the exception is **not needed and should not be set**. The gate's hard-coded `STAGING_KNOWN_EXTRA_MIGRATIONS` list becomes redundant but harmless. Decision needed: whether the restored folder is accepted into `staging`/`main` (production also has it applied, 95 distinct names there), or whether to keep the exception. Merging it means the branch it came from stays unmerged but its schema is in history.
- Production divergence (from the Round 3 analysis, read-only captures): 12 recorded checksums differ from the repo files, and production lacks four columns the repo migrations create (`canned_responses.category`, `conversation_events.metadata`, `feature_flags.rollout_type`, `platform_settings."updatedBy"`). Staging has no such difference. This does not affect a staging deploy; it matters for production (separate gate).
- Verified earlier on disposable Postgres: fresh install (95 migrations) equals staging's schema with 0 differences; `migrate deploy`/`status` tolerate production-style history quirks; 50-to-95 upgrade preserved seeded data.
- The gate additionally runs `staging-migration-preflight.sql` (counts of rows that the "preserve legacy values" migration might affect) and requires a successful backup-restore rehearsal. Neither has been run for this candidate.

## 4. Environment-variable matrix

Legend: **R** required for staging to start or to be safe; **C** conditional on a feature being tested; **O** optional; **NEVER** must not be set in staging. "In compose" = present in `infra/docker-compose.staging.yml`; "Gap" = the code reads it but compose does not pass it. Secrets are never printed in this document. `NODE_ENV=production` in staging, so production startup validation applies.

### Backend (`wa_staging_backend`)

| Variable | Need | In compose | Notes |
|---|---|---|---|
| `NODE_ENV` | R | yes (production) | Triggers startup validation |
| `DATABASE_URL` | R | yes | must end `_staging` (script checks) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | R | yes | |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | R | yes | at least 32 chars, different from production (checked by `staging-recreate.sh`) |
| `INTERNAL_SECRET` | R | yes (added, uncommitted) | startup refuses without it; also used by worker and realtime |
| `WHATSAPP_WEB_INTERNAL_API_KEY` | R | yes | startup refuses without it; same value in whatsapp-web and worker |
| `WHATSAPP_APP_SECRET` | R | yes | startup refuses without it; unsigned WhatsApp webhooks refused |
| `CREDENTIALS_ENCRYPTION_KEY` | R (practically) | yes | 32-byte base64; code treats unset as "no encryption". **Never change once data is encrypted** |
| `FRONTEND_URL`, `PUBLIC_URL`, `API_URL` | R | yes | CORS, links, webhook-visible URLs |
| `REALTIME_URL` | R | yes | |
| `STORAGE_DRIVER`, `MINIO_ENDPOINT/PORT/USE_SSL/BUCKET/ACCESS_KEY/SECRET_KEY` | R | yes | local-driver traversal fix applies if `STORAGE_DRIVER=local`; AWS_* only for s3 |
| `PLATFORM_ADMIN_SETUP_SECRET` | C (first admin only) | yes | must differ from production |
| `PAYSTACK_SECRET_KEY` | C (Commerce/credits) | yes | must be `sk_test_*` (script rejects `sk_live_`) |
| `PAYSTACK_PUBLIC_KEY` | C | **Gap** | read by code, not passed |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | O | yes | backend now boots without them; card payments return 503 |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_LOGIN_CONFIG_ID`, `INSTAGRAM_LOGIN_CONFIG_ID`, `MESSENGER_WEBHOOK_VERIFY_TOKEN` | C (Messenger/Instagram) | yes | staging's `INSTAGRAM_LOGIN_CONFIG_ID` was empty in the last capture |
| `TIKTOK_CLIENT_ID/SECRET` | O | yes | verification login only |
| `DEEPSEEK_API_KEY` | C (AI) | yes | |
| `ANTHROPIC_API_KEY` | O | yes | not found in a source grep; purpose UNVERIFIED |
| `ENABLE_DEV_TOOLS` | C | yes | `true` only on staging, enables AI test chat |
| `RESEND_API_KEY`, `SMTP_*`, `SUPPORT_FORWARD_EMAIL`, `SUPPORT_TENANT_ID`, `BILLING_NOTIFY_EMAIL` | C (email) | yes | |
| `RESEND_WEBHOOK_SECRET` | C (inbound email) | **Gap** | without it production-mode backend refuses inbound email |
| `GHS_RATE`, `THROTTLE_LIMIT`, `THROTTLE_TTL`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `OAUTH_STATE_SECRET`, `SLACK_WEBHOOK_URL` | O | yes | `OAUTH_STATE_SECRET` falls back to the JWT secret |
| `RAG_HYBRID_ENABLED`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL_DIR`, `NODE_PATH` (+ read-only mounts `/models`, `/ort`) | C (hybrid RAG) | **Gap** | the runbook set these by hand on the server; the repo compose does not contain them or the pgvector image (section 5) |
| `SENTRY_DSN`, `GOOGLE_CLIENT_ID/SECRET`, `KB_LEARNING_DISABLED`, `AI_CORRECTIONS_DISABLED`, `ADMIN_DEMO_EMAIL` | O | no | |
| `SKIP_2FA`, `SKIP_EMAIL_VERIFICATION`, `WEBHOOK_ALLOW_PRIVATE_URLS` | **NEVER** | no | weaken auth or SSRF protection |
| `*_TEST_DATABASE_URL`, `EXPORT_DATABASE_URL` | **NEVER** | no | test or tooling only |

### Worker (`wa_staging_worker`)

| Variable | Need | In compose | Notes |
|---|---|---|---|
| `DATABASE_URL`, `REDIS_HOST/PORT/PASSWORD` | R | yes | |
| `INTERNAL_SECRET` | R | yes | for backend notifications and realtime emits |
| `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_WEB_INTERNAL_URL` | R | yes | |
| `CREDENTIALS_ENCRYPTION_KEY` | R | **Gap** | the worker decrypts WhatsApp number tokens; with the backend key set and this missing, campaign sends and quality sync throw "Cannot decrypt credential" |
| `PAYSTACK_SECRET_KEY` | C (reconciliation) | **Gap** | |
| `BACKEND_URL` | R | **Gap, and wrong default** | default `http://backend:3001`, but worker calls `${BACKEND_URL}/manage/settings/...` while the backend serves `/api/v1/...`; the AI-trial-expired and subscription-downgraded notifications currently 404 (swallowed by `.catch`). Setting `BACKEND_URL=http://backend:3001/api/v1` works around it without code change |
| `PUBLIC_BASE_URL` | C (campaign click tracking) | **Gap** | defaults to `https://verzchat.com/api/v1` (production) |
| `REALTIME_URL`, `REALTIME_INTERNAL_URL` | O | no | default `http://realtime:3002` is correct inside compose |
| `DEEPSEEK_API_KEY`, `SLACK_WEBHOOK_URL`, `NODE_ENV` | O/R | yes | |

### Realtime (`wa_staging_realtime`)

| Variable | Need | In compose | Notes |
|---|---|---|---|
| `JWT_SECRET` | R | yes | service now refuses to start without it; must equal the backend's |
| `INTERNAL_SECRET` | R | yes | `/internal/emit` returns 503 without it |
| `REDIS_HOST/PORT/PASSWORD` | R | yes | |
| `FRONTEND_URL`, `BACKEND_URL` | R | yes | CORS origins |
| `PORT`, `NODE_ENV` | O | yes | |

### WhatsApp-web (`wa_staging_whatsapp_web`)

| Variable | Need | In compose | Notes |
|---|---|---|---|
| `WHATSAPP_WEB_INTERNAL_API_KEY` | R | yes | service answers 503 to everything but `/health` without it |
| `BACKEND_INTERNAL_URL` | R | yes | `http://backend:3001`; the service appends `/api/v1` itself |
| `DATABASE_URL` | R | yes | |
| `CREDENTIALS_ENCRYPTION_KEY` | R | yes | same key as backend |
| `PORT`, `NODE_ENV`, `LOG_LEVEL` | O | yes | |

### Infrastructure services
Postgres: `POSTGRES_USER/PASSWORD/DB` (R; DB name must end `_staging`). Redis: password via command (R). MinIO: `MINIO_ROOT_USER/PASSWORD` (R). Frontend: `PORT`, `NODE_ENV`. Nginx: certificates for `staging.verzchat.com`. Deploy-time only: `RELEASE_TAG` (set by the script to the SHA), `CONFIRM_STAGING_RELEASE`, `STAGING_ENV_FILE`, `STAGING_PUBLIC_URL`/`VPS_IP` (R).

### Deploy-script coverage gap
`staging-release-deploy.sh` requires only `POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET MINIO_ACCESS_KEY MINIO_SECRET_KEY` and `STAGING_PUBLIC_URL|VPS_IP`. It does **not** require `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET` or `CREDENTIALS_ENCRYPTION_KEY`, and `staging-recreate.sh check` only warns about the last two. A deploy therefore can pass the script and then crash-loop the new backend. `INTERNAL_SECRET` and `WHATSAPP_APP_SECRET` are also not in the repo's checks of "different from production".

## 5. Secret-presence validation (values never printed)

Run on the staging host by an operator, as root, from a shell with history disabled (`set +o history`). Nothing below prints a value, a length, a prefix or a hash. This is a procedure to follow; I did not run it.

1. File presence and permissions only: `stat -c '%a %U' infra/.env.staging` (expect `600 root`).
2. Names present and non-empty in the staging env file, without echoing the line:
```bash
for k in JWT_SECRET JWT_REFRESH_SECRET INTERNAL_SECRET WHATSAPP_WEB_INTERNAL_API_KEY WHATSAPP_APP_SECRET \
         CREDENTIALS_ENCRYPTION_KEY POSTGRES_PASSWORD REDIS_PASSWORD MINIO_ACCESS_KEY MINIO_SECRET_KEY \
         PAYSTACK_SECRET_KEY RESEND_WEBHOOK_SECRET FACEBOOK_APP_SECRET; do
  awk -F= -v k="$k" '$1==k && length(substr($0,index($0,"=")+1))>0 {f=1} END{printf "%-34s %s\n", k, (f?"SET":"MISSING")}' infra/.env.staging
done
```
3. What the running containers actually received (set or not, never the value):
```bash
for c in wa_staging_backend wa_staging_worker wa_staging_realtime wa_staging_whatsapp_web; do
  for k in INTERNAL_SECRET WHATSAPP_WEB_INTERNAL_API_KEY JWT_SECRET WHATSAPP_APP_SECRET CREDENTIALS_ENCRYPTION_KEY PAYSTACK_SECRET_KEY; do
    docker exec "$c" sh -c "[ -n \"\${$k:-}\" ] && echo \"$c $k SET\" || echo \"$c $k unset\"" 2>/dev/null
  done
done
```
4. Cross-service equality without printing: compare salted digests that are discarded, only the verdict is shown:
```bash
h(){ docker exec "$1" sh -c "printf %s \"\${$2:-}\"" | sha256sum | cut -d' ' -f1; }
for k in INTERNAL_SECRET WHATSAPP_WEB_INTERNAL_API_KEY; do
  a=$(h wa_staging_backend $k)
  for c in wa_staging_worker $( [ $k = INTERNAL_SECRET ] && echo wa_staging_realtime || echo wa_staging_whatsapp_web ); do
    [ "$a" = "$(h $c $k)" ] && echo "$k backend==$c OK" || echo "$k backend!=$c MISMATCH"
  done
done; unset a
```
   (Digests stay in shell variables and are never echoed. Do not paste this output anywhere that also holds values.) Do the same for `JWT_SECRET` between backend and realtime, and `CREDENTIALS_ENCRYPTION_KEY` between backend, worker and whatsapp-web.
5. Staging must differ from production: run `infra/scripts/staging-recreate.sh check` (prints names only). It already fails on identical JWT secrets, on a `sk_live_` Paystack/Stripe key, and on a database whose name does not end `_staging`.
6. Format checks that leak nothing: `CREDENTIALS_ENCRYPTION_KEY` must decode to 32 bytes (`printf %s "$VAL" | base64 -d | wc -c` equals 32, run inside the container so the value never reaches the terminal history); other secrets at least 32 characters (`[ ${#VAL} -ge 32 ]`, print only pass or fail).
7. Never `docker inspect` an environment block or `docker compose config` to a terminal or log: both print values. Never run these commands with `-x`.
8. After the run, `history -c` and confirm no capture file contains a secret (`grep -c` for the variable names only).

## 6. Infrastructure prerequisites

| Area | Status |
|---|---|
| Staging project/containers | `verzchat-staging` Compose project; containers `wa_staging_{postgres,redis,minio,backend,frontend,realtime,worker,whatsapp_web,nginx}`. Last captured (2026-11-02): all running, no memory limits, host 24 GB RAM, 38 GB free disk. **UNVERIFIED today.** |
| Database | `postgres:16-alpine` 16.15 in repo compose, volume `staging_postgres_staging_data`, DB name must end `_staging`. **Drift:** staging's actual server was changed by hand for hybrid RAG (pgvector image, `vector` extension, `kb_vector_chunks` table, model and ORT mounts, RAG env). `infra/postgres/Dockerfile` is untracked and the repo compose does not use it. A deploy from the repo compose would recreate Postgres with the stock image (extension library missing) and the backend without RAG settings. Capture the live staging compose and state first, then decide whether to commit the pgvector image and mounts to the repo compose. **UNVERIFIED.** |
| Redis | `redis:7-alpine`, password-protected, volume `staging_redis_staging_data`, healthcheck defined. Needed by backend, worker, realtime (BullMQ queues incl. `scheduled-campaign`, `campaign-send`). |
| Storage | MinIO volume `staging_minio_staging_data` plus backend uploads volume `staging_uploads_staging_data`; no healthcheck defined for MinIO. Bucket must exist. |
| Ingress | Nginx publishes host ports 8080 (HTTP) and 8443 (HTTPS) for `staging.verzchat.com`; cert from certbot, outside Compose. Routes: `/api/`, `/socket.io/`, `/storage/`, `/health`, `/`, `/_next/static/`. The public staging URL is `https://staging.verzchat.com:8443`. |
| Health checks | Defined in Compose only for Postgres and Redis. The deploy script probes: backend `http://127.0.0.1:3001/api/v1/health`, realtime `:3002/health`, whatsapp-web `:3004/health`, frontend `:3000/`, `nginx -t`, ingress `:8080/api/v1/health`, worker liveness via `node -e`. **New and not yet used by the script:** `/api/v1/health/ready` (database reachability) should be added to the checks. Redis outages are not covered by any health check. |
| Webhook URLs (to register on provider side, base `https://staging.verzchat.com:8443`) | WhatsApp: `/api/v1/webhook/whatsapp/<tenantId>` (GET verify + POST); Messenger/Instagram: `/api/v1/webhook/messenger`; Paystack Commerce: `/api/v1/commerce/webhooks/paystack`; Paystack/Stripe billing: `/api/v1/billing/webhooks/paystack`, `/stripe`; inbound email (Resend): `/api/v1/inbound/email`. |
| Meta app | Staging currently shares production's Meta callback (`https://verzchat.com/api/v1/webhook/messenger`), so Meta events never reach staging. A separate test Meta app is required. |
| Service dependencies | backend needs Postgres, Redis, MinIO, realtime (HTTP, secret), whatsapp-web (HTTP, key). worker needs Postgres, Redis, backend (HTTP, secret, see `BACKEND_URL` finding), realtime, whatsapp-web. realtime needs Redis, JWT secret. whatsapp-web needs Postgres, backend (HTTP, key). |
| Backups | `/root/staging-release-backups/<tag>`; the script takes a pre-migration dump after stopping writers and requires a restore rehearsal (`staging-verify-backup-restore.sh`). Not run for this candidate. |

## 7. Deployment and rollback review

Deploy flow (`staging-release-deploy.sh deploy <sha>`, root on the staging host only): lock, verify stack/volumes/DB identity, verify required settings, secret-boundary check, export the exact commit, build images tagged with the SHA, tag current images `rollback-YYYYMMDD-HHMMSS`, verify applied migration checksums against the candidate, `prisma migrate status`, run `staging-migration-preflight.sql`, stop backend/worker/whatsapp-web, take and verify a database backup, `prisma migrate deploy`, recreate services, health checks.

Rollback (`... rollback rollback-YYYYMMDD-HHMMSS` with `CONFIRM_CODE_ONLY_ROLLBACK=<tag>`): **code only** (previous images). It refuses if migrations are unfinished, if phone-less contacts exist, or if AI-credit reservations are unresolved.

Limitations and irreversible steps:
- Migrations are forward-only. A schema rollback means restoring the pre-migration dump, which discards all staging data written since. This candidate adds no executable migration, so a code-only rollback is the expected path; if a later candidate does add one, assume restore-from-backup.
- The previous image tags are only as good as the last deploy: the staging server's hand-modified state (pgvector, RAG env) is not captured by an image tag. Rolling back images does not roll back Compose/env changes.
- Changing `CREDENTIALS_ENCRYPTION_KEY` after credentials were encrypted makes them unreadable; never rotate it as part of rollback. Changing `JWT_SECRET` signs every user out.
- Setting `WHATSAPP_APP_SECRET` wrongly stops all inbound WhatsApp (webhooks return 400); the fix is the variable, not a rollback.
- New fail-closed behaviour changes who gets in: services answer 401/503 without the right secrets; backend refuses to start without the three required secrets. Deploy order matters: whatsapp-web and realtime first (they only refuse requests), then backend, then worker.
- External effects are irreversible: WhatsApp/Instagram messages sent to real devices, Paystack test transactions, Meta webhook registrations, emails.
- Migration `preserve_legacy_schema_values` and its preflight query exist because legacy data can be affected; review `staging-migration-preflight.sql` output before proceeding.
- The restore rehearsal and `staging-release-contract.test.sh` / `staging-migration-gate.test.sh` were not run in this preflight.

## 8. Blocking findings (fix or decide before a staging deploy)

1. **No release candidate** (sections 1-2).
2. **Deploy script does not require the new mandatory secrets**; a deploy can succeed and then crash-loop the backend. Add `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` to its required list (code change; not made).
3. **Worker compose gaps**: `CREDENTIALS_ENCRYPTION_KEY` (campaign sends fail), `PAYSTACK_SECRET_KEY` (reconciliation), `PUBLIC_BASE_URL` (tracking links point at production), `BACKEND_URL` (see 4).
4. **Worker cannot reach the backend's internal endpoints**: default `BACKEND_URL` omits `/api/v1`, so AI-trial-expired and downgrade notifications 404 silently. Pre-existing defect, found now. Fix by setting `BACKEND_URL=http://backend:3001/api/v1` for the worker, or correct the URL in code.
5. **`RESEND_WEBHOOK_SECRET` is not passed to staging backend**: inbound email is refused in production mode.
6. **Hybrid-RAG staging drift** between the repo compose and the live server (section 6).
7. **Staging shares production's Meta callback**: WhatsApp (via per-tenant URL) can be tested, Messenger/Instagram cannot until a test Meta app is used.
8. **Dirty-tree contents unreviewed**, including files that must not be committed (`.pnpm-store/`, `.DS_Store`, `.expo` caches).
9. **Real-provider, restore-rehearsal and acceptance evidence is absent** (section 10).

## 9. Manual actions before staging

| # | Action | Owner |
|---|---|---|
| 1 | Review and commit the work through feature, dev, staging; record the SHA | you |
| 2 | Decide whether the restored migration folder is merged to `staging`/`main` (recommended yes) | you |
| 3 | Fix findings 2-5 above (small code or env changes) | you / me on request |
| 4 | Snapshot the live staging state: Compose file in use, images, env variable names, RAG mounts, `_prisma_migrations` | operator |
| 5 | Generate fresh staging-only `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`; confirm `WHATSAPP_APP_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` (unchanged if data exists), `RESEND_WEBHOOK_SECRET` | operator |
| 6 | Create a **test** Meta app: WhatsApp test number/WABA, Messenger page, Instagram test account as tester; set `FACEBOOK_*`, `INSTAGRAM_LOGIN_CONFIG_ID`; register staging webhooks (section 6) with the verify token; subscribe Instagram object and `messages` field | you (Meta dashboard) |
| 7 | Paystack **test-mode** account: `sk_test_*` key, webhook to the two staging paths | you |
| 8 | Resend: inbound signing secret for the staging URL | you |
| 9 | Test workspaces and test users, one per provider; second workspace for isolation tests | operator |
| 10 | Hybrid RAG: stage MiniLM files and ORT as read-only mounts, pgvector image; run the runbook steps | operator |
| 11 | Backup-restore rehearsal (`staging-verify-backup-restore.sh`) | operator |
| 12 | DNS/cert for `staging.verzchat.com:8443` confirmed (no change needed unless expired) | operator |
| 13 | Legal/business decisions needed only for production, listed in `BUSINESS_LEGAL_DECISIONS.md`; none block a staging test | you |

## 10. Staging acceptance checklist

Record evidence for every row (request, UTC time, sanitized log lines, DB rows, screenshot). A row passes only on the real provider's observable result. Mocked or local results do not count.

### A. Platform baseline
| Check | Expected |
|---|---|
| Containers healthy; `/api/v1/health` 200, `/api/v1/health/ready` 200 | all services up, no restart loops |
| Backend log at start | `[config]` lines name only missing optional integrations; no "Refusing to start" |
| `curl` realtime `/internal/emit` with no header / wrong / right secret | 401 / 401 / 200 |
| `POST /internal/whatsapp-web/events` no key / wrong / right | 401 / 401 / 200 |
| `POST /manage/settings/ai/trial-expired` no secret; valid secret with no `tenantId` | 401; 400 |
| Worker log after a trial/downgrade event (after fixing `BACKEND_URL`) | notification created, no 404 |
| Graceful stop of backend, worker, realtime | clean exit within about 10 s |

### B. Paystack (test mode) - plan section 1
| Check | Expected |
|---|---|
| Pay a test order with the success test card | webhook `charge.success` processed; order `PAID`; ledger `GMV` + negative `TAKE_RATE` at the workspace rate |
| Resend the same webhook | no new ledger rows |
| Mismatched amount, currency or reference (controlled signed test event) | HTTP 200 with outcome `FAILED` and reason; order unchanged; zero ledger rows |
| Unsigned or forged signature | 400 |
| Failed card | order stays `PENDING_PAYMENT` |
| Reconciliation job | no exception for a good order; `AMOUNT_MISMATCH` for a seeded mismatch (needs worker `PAYSTACK_SECRET_KEY`) |
| Credit-pack purchase | credits added exactly once |
| Refund | **not testable**; no refund path exists (design only) |

### C. WhatsApp Cloud API - plan section 2
| Check | Expected |
|---|---|
| Meta GET verification | 200 with challenge |
| Inbound text | stored in the correct test workspace only |
| Unsigned / wrong-signature POST | 400 and nothing stored |
| Reply inside 24 h; media; template outside window | delivered; statuses progress SENT, DELIVERED, READ |
| Same number cannot leak into another workspace | confirmed with the second workspace |

### D. Campaigns - plan section 4
| Check | Expected |
|---|---|
| Schedule 3 minutes ahead | `SCHEDULED`, then `RUNNING`, then `COMPLETED`; recipients `SENT`, counters correct (needs worker `CREDENTIALS_ENCRYPTION_KEY`) |
| Opted-out and blocked contacts | `FAILED`, never messaged |
| Delete before the time | job removed, nothing sent |
| Pause then resume | stops promptly, no one messaged twice |
| Revoke token, then run | campaign ends `FAILED` with reasons, no endless retries |
| Restart worker mid-run | remaining recipients sent, no duplicates |
| Tracking link | uses the staging URL (needs `PUBLIC_BASE_URL`) |

### E. Hybrid RAG - plan section 5
| Check | Expected |
|---|---|
| Index one test workspace (dry run first) | chunk counts as expected |
| Paraphrased questions | answered from the right article; trace shows hybrid with vector |
| Second workspace asks the same | never sees the first workspace's articles |
| Remove model files | falls back to keyword search with a logged reason |
| Memory and latency | within the runbook's expectations; flag-off rollback works |
| Digital Self still works alongside | suggestion mode behaves as before |

### F. WhatsApp-web (QR) - plan section 6
| Check | Expected |
|---|---|
| Pair a spare account | connected; send/receive text and media |
| Restart the container | session restores without a new QR |
| Network drop | reconnects with backoff |
| Log out on the phone | channel shows disconnected; sends fail clearly |
| HTTP API without key / with key unset | 401 / 503 |

### G. Tenant isolation
| Check | Expected |
|---|---|
| Workspace A token against workspace B ids (contacts, rules, tags, teams, segments, keys, campaigns, orders, KB) | 404/empty; B's rows unchanged |
| A's JWT with B's tenant claim | 401 |
| Suspended member, deactivated user, suspended workspace | 401 on next request |
| Settings/onboarding as AGENT or VIEWER | 403; as admin, protected fields rejected (take rate, payment verification) |
| Platform admin VIEWER / SUPPORT attempting SUPER_ADMIN actions | 403 |
| Link preview and `mediaUrl` to internal addresses | refused |
| Media `GET` with traversal key | 404 |

### H. Realtime
| Check | Expected |
|---|---|
| Two workspaces open, same conversation id | events and typing stay inside each workspace |
| Socket without or with forged token | refused |
| SLA breach alert (after worker reaches realtime with the secret) | appears for the right workspace only |
| Backend/worker emits | delivered; with a wrong secret refused (401) |

## 11. GO/NO-GO for staging

**NO-GO.** Blockers: (1) no committed, clean, reviewed release candidate, so the deploy script would refuse and any result would not be attributable to a SHA; (2) the deploy script does not check the secrets whose absence now crash-loops the backend; (3) the worker compose gaps and the worker `BACKEND_URL` defect; (4) unknown drift between the live staging server and the repo compose (hybrid RAG).

Becomes GO for staging when: the work is committed and the tree is clean; the SHA is recorded here; items 2-5 and 8 of section 8 are fixed and the full verification (backend Jest, six typechecks, service tests, migration rehearsal) is rerun on that SHA; the live staging state is captured and reconciled; the secrets pass section 5 on the host; and the backup-restore rehearsal succeeds. Passing those makes a staging deployment reasonable; it does not make production ready (see the Round 3 checklist).
