# AI tool authorisation review (2026-11-04)

Scope: all 13 registered AI tools and the code that dispatches them (`apps/backend/src/ai-core/tools/`). Method: read every handler and the service each one calls; write the attack as a test first (`tool-authorization.spec.ts`, `test/ai-tool-authorization.e2e-spec.ts`); fix; confirm with mutation checks that the tests fail when the fix is removed.

## Trust model
* **Server-controlled (trusted):** the `ToolExecutionContext` (tenant, conversation, contact, phone). Built from the inbound message by the pipeline.
* **Model-controlled (hostile):** the tool name and every argument. A model can be wrong or steered by text in a customer message.
* **Rule:** identity is never an argument. Which record to look at (a product or order the model read earlier) may be an argument, but only as a validated opaque id, and the lookup is always scoped by the context's tenant (and contact for orders).

## Findings and fixes
| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `productId` / `variantLabel` / text arguments were cast (`as string`), not validated. An object such as `{"startsWith":""}` was handed to the database client as a **filter**, so `get_product_details`, `send_product_image` and `add_item_to_order` could be pointed at "the first product" without knowing an id (same workspace only). | Medium | Fixed: `argId` accepts only `[A-Za-z0-9_-]{1,64}` strings |
| 2 | `add_item_to_order` accepted `Number(quantity)`: fractions (1.5), `Infinity`, `"1e9"`, `[3]` passed the `< 1` test, producing absurd or non-finite order totals. | Medium | Fixed: whole numbers 1 to 10 000 only |
| 3 | Free-text arguments (task title/description, delivery fields, remembered facts, pending action) had no length or type limits and were stored as given. Remembered facts could hold nested objects or megabytes. | Low | Fixed: typed and bounded per field (`tool-args.util.ts`) |
| 4 | The registry trusted the context. Nothing checked, when a tool ran, that the conversation belongs to that tenant **and** contact. Several services below it (`LeadsService.scoreConversation`, message and lead lookups) key on `conversationId` alone, so a context built wrongly anywhere would read or write across workspaces. | High (defence in depth; no caller was found building a wrong context) | Fixed: `ToolRegistryService.execute` verifies `{id, tenantId, contactId}` against the database before every handler; failure, or failure to check, refuses the call |
| 5 | A single model turn could request any number of tool calls, and an identical state-changing call (add item, submit for payment, create task, arrange delivery, send image) was executed again each time (model retry or replay) | Medium | Fixed: at most 6 calls per round and 12 per run; an identical state-changing call in one run executes once and later calls receive the first result (no second side effect) |
| 6 | The offered-tools check already refused tools not offered in a run (`Map` lookup, safe for `__proto__`/`constructor` names) | n/a | Confirmed by test; unchanged |
| 7 | `get_order_status` with an order id of another contact or workspace returns "Order not found" (lookup scoped by tenant and contact) | n/a | Confirmed by test; unchanged. A non-string `orderId` is now refused rather than silently ignored |

## Per-tool result
| Tool | Reads / writes | Scope enforced | Arguments |
|---|---|---|---|
| search_products | catalogue (read) | tenant | query bounded; prices ignored unless finite numbers |
| get_product_details | product (read) | tenant | id validated |
| add_item_to_order | order draft (write) | tenant + conversation draft | id, quantity, variant validated; replay-safe |
| get_current_order | order (read) | tenant + conversation | none |
| submit_order_for_payment | order (write, payment link) | tenant + conversation draft; `dryRun` only from context | none; replay-safe |
| get_order_status | order (read) | tenant + contact | id validated |
| create_internal_task | task (write) | tenant; conversation/contact/order from context; the task service additionally drops any reference outside the tenant | text bounded; replay-safe |
| send_product_image | customer message (side effect) | tenant; media URL is the product's own | id validated; replay-safe |
| remember_conversation_facts / set_pending_action / clear_pending_action | conversation AI state (write) | tenant + conversation from context | typed, bounded |
| check_delivery_info | settings (read) | tenant | none |
| arrange_delivery | task (write) | tenant + conversation + contact from context | text bounded; replay-safe |

`qualify_lead` (registered separately by the leads module) is covered by finding 4: its service keys on the conversation id, which the registry now verifies belongs to the tenant and contact before it runs.

## Not covered here
Role and user checks do not apply inside a tool: tools act for the customer in a conversation, not for a staff user. Whether a workspace is allowed commerce tools is decided by the caller when it chooses the offered list; the offered list is enforced at execution (finding 6), and the tools themselves only touch the context's own workspace.
