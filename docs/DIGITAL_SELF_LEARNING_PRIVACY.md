# AI learning — privacy summary

For the privacy owner and for anyone approving the learning notice. It describes what the code does **today** on branch `feature/digital-self-learning-readiness`. Nothing here is approved legal policy, and nothing is enabled for any real workspace. Technical detail is in `DIGITAL_SELF_LEARNING_PHASE1.md`.

## 1. How a workspace opts in

- Learning is **off for every workspace** and no existing workspace is switched on by any release.
- An administrator reads the notice (built in `learning-disclosure.ts`), ticks that they understand it and are authorised, and turns learning on. The platform must also have the opt-in gate open (`AI_LEARNING_OPT_IN_OPEN=true`, closed by default), which operators open only after privacy approval.
- The system stores **which notice version, which administrator, and when**. The version is a hash of the notice text *and* the retention settings it describes, so any change to either is a new version.
- If the version changes, learning **stops** (evaluation, cost reservation and Digital Self evidence capture) until an administrator acknowledges the new one. Un-pausing does not bypass this.
- Three independent switches: **learning** (on/off), **pause** (stops learning, keeps the opt-in), **approved guidance** (whether approved examples are used in replies). Pausing never disables a Digital Self or existing guidance.
- Turning learning off or pausing stops *new* collection. **It does not delete what was already collected.**
- Administrator activity records (`AiLearningAuditLog`) hold identifiers, counts, flag values and the notice version only. They never contain conversation content or the notice text.

## 2. Data categories

| Category | Contains customer text? | Created | Purpose | Visible to | Kept today |
|---|---|---|---|---|---|
| **Interaction record** (`ai_interaction_logs`) | Yes: customer message, AI reply, the sent text, feedback note | For every AI reply or suggestion, **whether or not learning is on** (the AI log uses it) | AI suggestions and AI analytics in the inbox; read by learning for evaluation | Any signed-in user of the workspace who can open the conversation (existing permissions, unchanged) | Until the conversation/contact is deleted |
| **Evaluation** (`ai_interaction_evaluations`) | Yes: written explanation may quote the conversation | Only while learning is active | Quality scoring, review | Workspace administrators | Until the conversation/contact is deleted |
| **Reviewer feedback and customer-correction notes** | Yes (reviewer-written, may paraphrase or quote) | When a reviewer writes them | Review | Workspace administrators | With the evaluation |
| **Training example** (`ai_training_examples`) | Yes: customer message, AI reply, expected reply, notes | When a reviewer creates one | Becomes guidance only when approved | Workspace administrators | Until deleted by an administrator, or the conversation/contact is deleted |
| **Review task** (`ai_review`) | Yes: description quotes the evaluator's reasoning | For serious findings | Human follow-up | Workspace staff with task access | Until the conversation/contact is deleted |
| **Execution trace** (`ai_executions`: `toolTrace`, `errorMessage`) | Possibly: tool inputs and errors can contain customer text | For every AI execution, regardless of learning | Debugging | Platform staff and administrators | Text cleared when the conversation/contact is deleted; usage metrics (tokens, cost, latency, status) are kept |
| **Digital Self evidence and profile** | **No**: numbers and fixed-vocabulary markers about the *agent's* writing | While learning is active | Style of a human agent | Workspace agents and administrators (existing Digital Self permissions) | Until the conversation is deleted (profile rebuilt) or the agent's profile is reset |
| **Learning cost ledger** (`ai_learning_usage`) | No | Each evaluation | Platform-funded cost control | Platform | Not deleted with conversations (no customer text) |
| **Audit records** | No (ids, counts, flags, versions) | On changes and deletions | Accountability | Workspace administrators | Not deleted with conversations |

**Third party.** To evaluate an exchange, an excerpt of up to about 9,000 characters (customer message, AI reply, recent earlier messages, order and handover status) is sent to **DeepSeek** over its API. VerzChat does not control what the provider retains or whether it uses the data; those terms have **not** been reviewed here (see decisions below). Evaluation is paid by VerzChat and never charged to a customer's AI credits.

**Engineering copies.** An engineer can copy an approved example into the repository's regression tests. Deleting the example in the product cannot remove that copy; the API reports `promotedToRegressionCase` so the administrator is told.

## 3. Training-example lifecycle

| State | Influences AI replies? | Customer text held? | Reversible? |
|---|---|---|---|
| Draft / In review | No | Yes | Yes |
| **Approved** | **Yes**: workspace guidance, or one agent's style for a style correction | Yes | Yes (withdraw) |
| Rejected | No | Yes | Yes (back to review) |
| Archived | No | Yes | Yes (restore to review) |
| **Deleted** | No | **No**: the row and its text are removed | **No** |

- **Withdraw** (approved to review) and **archive** take effect immediately: the guidance query reads approved examples only, the approval record is cleared, and any Digital Self style contribution is removed (profile rebuilt).
- **Delete** is permanent, in one transaction, and removes any style contribution *whether or not the Digital Self feature flag is on*. The audit record holds the id, the previous status and yes/no facts only.
- An archived or rejected example never influences learning, but **keeps its text** until deleted or, once approved, until the retention sweep.
- **Deleting a conversation or contact** removes every example from it, in every state, in the same transaction as the deletion (and aborts the deletion if that fails). Verified for all five states.
- The interaction record and the evaluation behind an example are **not** deleted when the example is. There is no "delete this one interaction" action; they go with the conversation, or with the retention sweep when it is approved.

## 4. Retention — proposals only

The sweep (`AiLearningRetentionService`) exists but is **off** (`AI_LEARNING_RETENTION_ENABLED` must be exactly `true`) and unscheduled. While it is off the notice tells administrators that nothing is deleted automatically.

Proposed, **not approved**: free text 90 days, anonymised metrics 13 months. The exhaustive list of what the sweep may change is `RETENTION_MANIFEST` in `learning-retention.service.ts`; a test proves nothing else changes. It never touches approved guidance, the cost ledger, credit records, audit records or Digital Self data. This implementation did not delete any historical data.

## 5. Outstanding decisions (owner: privacy / legal)

1. **Approve or change the retention periods**, and decide what they may apply to. Note the free-text rule also blanks *interaction records*, which the inbox shows as AI suggestions and uses for AI analytics, so enabling it removes that text for records older than the period.
2. **Approved examples contain customer text and are never aged out.** Decide a maximum age or review cadence, or require anonymising before approval.
3. **Notice wording** needs legal review, including whether an administrator's acknowledgement is the right basis, and whether *end customers* must be told that their messages may be evaluated by an AI provider.
4. **Provider terms**: DeepSeek's retention, training use and cross-border transfer are unreviewed. A data-processing agreement, a different provider, or a different region may be required before any real workspace opts in.
5. **Backups** keep deleted data until they rotate. Retention of backups is not covered.
6. **Regression-case copies in source control**: require anonymised text, or add a removal procedure.
7. **Per-interaction deletion** (without deleting the whole conversation) is not offered; decide whether it is needed for erasure requests.
8. **Erasure requests for one person across workspaces** have no platform-wide tool; today it is per workspace, by deleting the contact.
9. **Mobile**: the web AI Learning tab carries the controls; the mobile app has no equivalent screen.
10. **Platform staff access** to these tables and to the provider excerpt is not described here.

## 6. Before any real workspace opts in

Privacy owner approves the notice and (if wanted) retention; the opt-in gate and deployment variables are set deliberately in the environment (Compose passes them with safe defaults; nothing is committed); a staging run completes the acceptance steps in `DIGITAL_SELF_LEARNING_PHASE1.md` §7 and the staging validation guide; and the provider question in decision 4 is answered.
