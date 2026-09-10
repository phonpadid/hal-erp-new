## Context

`PaymentService.record()` (`back/src/modules/payment-handoff/payment.service.ts:269-270`) refuses any document that is not `DocStatus.COMPLETED`. Separately, a `WorkflowStep`/`DocumentApprovalStep` can carry `requires_payment_slip = true`, which blocks `APPROVE` on that step until a `PaymentAttachment` (evidence only, `payment_id = null`) is attached (`assertSlipAttached`, `approval-routing.service.ts:73-86`). Today those two mechanisms don't talk to each other: the slip proves a transfer happened, but the formal `Payment` row — rate, method, reference, WHT, FX — still waits for every remaining step to approve, even though `record()` itself never touches the budget ledger (`Record Payment and FX Gain/Loss` already states it "MUST NOT write any `budget_txn`"; the RESERVE→ACTUAL conversion for `CUT_BUDGET` types happens separately, at full-approval settlement, via `Payment-Ready Signal on Settlement`).

For a company whose real practice is "finance pays at their step, not at the end," this means a second, purely clerical visit to `ReadyToPayView` after the chain finishes to log a transfer that already happened. The sharper problem is what a later step's reject should mean once that `payment` row exists: budget-wise nothing is at risk (`Auto-Release on Reject or Cancel` still releases the full reservation correctly, because ACTUAL was never booked early) — but the `payment` row itself is now a record of real money having left the company for a document the system says was never approved, and today nothing represents that gap or stops a naive resubmit from papering over it.

## Goals / Non-Goals

**Goals:**
- Let `record()` run at the exact step that already demands payment evidence, while the document is still `IN_APPROVAL`.
- Keep every step after that gated step fully capable of APPROVE / REJECT / RETURN, unchanged.
- Give a reject that follows an early record a real, visible outcome instead of silently mis-releasing budget or silently doing nothing.
- Reuse the existing GL reversal mechanism (`GL_JV_POST`, "Any Entry Can Be Reversed, Once") as the actual accounting remedy — this change only has to make the *need* for that remedy discoverable.

**Non-Goals:**
- Not a general "pay any in-flight document any time" feature. Only steps an admin has explicitly marked `requires_payment_slip` unlock early recording — this is an opt-in per workflow step (invariant 7: configuration over code), not a global change to when payment is allowed.
- Not building new GL auto-reversal logic. The recovery flag routes a human to the existing manual, once-only reversal voucher; it never posts or reverses GL itself.
- Not deciding, in code, whether a flagged amount is actually recoverable (disputed, written off, partially recovered). That is an accounting judgment call surfaced by this feature, not resolved by it.

## Decisions

**1. Trigger condition: current step requires evidence AND evidence already exists.**
`record()` accepts a document when `status === IN_APPROVAL` and the step at `document.currentStepNo` (the frozen `DocumentApprovalStep`, same source `slipRequired` already reads — `document.service.ts:~930`) has `requiresPaymentSlip = true` and at least one `PaymentAttachment` already exists for the document.
*Alternative rejected:* allowing `record()` on any `IN_APPROVAL` document regardless of step config — defeats the reserve-until-approved safety net for every document type that hasn't opted in.
*Alternative rejected:* auto-recording the instant a slip is attached, with no separate confirm — rate, payment method, reference number and WHT code are real inputs finance must supply; nothing about them can be inferred from a slip image.

**2. Surface the Record action on the document itself, reusing the existing dialog.**
Extract the `Record Payment` dialog currently living only in `ReadyToPayView.vue:286-366` into a shared component, and mount it on `DocumentDetailView.vue` next to the slip card, gated by the same condition as (1) plus `PAYMENT_MANAGE`. This directly collapses the user's "round 1 / round 2" complaint into one screen for the documents that qualify, without duplicating form logic.
*Alternative rejected:* leaving Record only in `ReadyToPayView` and just widening its query to include eligible in-flight documents — technically simpler, but keeps finance bouncing between two screens for the exact case this change exists to fix.

**3. Recording early never books ACTUAL, so REJECT's unconditional release is untouched — the gap is a leftover `payment` row, not a budget-ledger conflict.**
`record()` still writes no `budget_txn` regardless of when it runs (`Record Payment and FX Gain/Loss`, unchanged). The RESERVE→ACTUAL conversion for `CUT_BUDGET` types still only happens at full-approval settlement (`Payment-Ready Signal on Settlement`, unchanged trigger). So when a later step rejects a document with an early-recorded payment, `Auto-Release on Reject or Cancel` / invariant 5 needs **no change at all** — release still runs unconditionally and releases the full original reservation, exactly as it does for every other rejection today, because ACTUAL was never booked.
What's actually new: real money already left the company for this submission (the `payment` row proves it), but the budget now shows a clean, full release — as if nothing was spent. That gap is not a budget bug to fix; it is a fact that needs a human to reconcile it outside the ledger. So in `approval-routing.service.ts`'s `REJECT` branch (`~line 309-318`), alongside the existing unconditional release, check `em.count(Payment, { document: documentId })`; if one exists, stamp it `recoveryStatus = 'PENDING_RECOVERY'`, `recoveryFlaggedAt = now()`.
*Alternative rejected:* computing release off the outstanding formula (`ΣRESERVE − ΣRELEASE − ΣACTUAL`) as if ACTUAL might already be partially booked — unnecessary, since this path never books ACTUAL early; would have added complexity for a case that cannot occur.
*Alternative rejected:* blocking REJECT entirely once a payment exists, forcing remaining approvers into an "acknowledge only" mode — rejected because it removes a real control (a downstream approver catching a genuine problem) instead of just changing what rejecting means; the point of this design is to keep that power while making its consequence honest.

**3a. Resubmission is refused while a recovery flag is open.**
`Reject Returns and Releases` lets the requester revise and resubmit the *same* document, generating a fresh route while the old one is marked superseded. `payment.document_id` is unique, so a stale `PENDING_RECOVERY` payment row from the doomed attempt would either block a legitimate future payment outright or (worse) be silently reused for an unrelated resubmission. Rather than version payment rows the way `document_approval_step` versions routes, resubmission is refused outright — with a clear reason — while the document carries an unresolved recovery flag. This keeps the fix scoped to "surface and stop," not "invent a payment-attempt-versioning model," and matches the general principle that a real financial exception should block forward motion until a person closes it, not route around it automatically.

**4. `payment.recoveryStatus` is ordinary mutable metadata, not a ledger row.**
Only `budget_txn` and `approval_log` are append-only (invariant 2). `payment` is already a single mutable settlement record (one row per document, unique on `document_id`); adding a nullable status column to it doesn't touch the append-only tables and needs no new ledger semantics.

**5. Recovery surfaced as a filtered list, not a notification, for v1.**
A `GET /payments/recovery-pending` endpoint (permission: `PAYMENT_MANAGE`) lists `payment` rows with `recoveryStatus = 'PENDING_RECOVERY'`, each linking to the document and to raising a `GL_JV_POST` reversal against the original posting. No new GL code — this only makes an existing manual action findable for a case that could not occur before this change.

**6. Locking.**
`record()` already wraps its write in `em.transactional(...)` (`payment.service.ts:~85`). Extend that transaction to `SELECT FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`) the `document` row before re-checking `status` and `currentStepNo`, so a concurrent APPROVE on the gated step (which advances `currentStepNo`) and a concurrent `record()` call can't both read a stale step number. The approval path's own step-transition write already takes this lock for its own transaction; `record()` needs to take the same lock so the two serialize instead of racing.

**Sequence A — early record (no `budget_txn`, `payment.settled` deferred):**
1. `record()` opens `em.transactional(...)`, `SELECT ... FOR UPDATE` the document row.
2. Re-validate: `status === IN_APPROVAL`, current step `requiresPaymentSlip`, `PaymentAttachment` exists, no existing `Payment` for this document (unique constraint backstop).
3. Insert `Payment` row (rate, method, reference, WHT, FX delta) — no `budget_txn` write, same as today's rule.
4. Adopt any pre-existing document-only `PaymentAttachment` rows onto the new `payment_id` (existing behavior, `payment.service.ts:227-232`).
5. Commit. Do **not** emit `payment.settled` yet — there is no ACTUAL `budget_txn` for GL to read against.

**Sequence B — the document later reaches full approval (unchanged trigger, now checks for an existing payment):**
1. Final step approves → `CUT_BUDGET` post-action fires as today: `budget_txn` ACTUAL for the consumed amount + RELEASE for any unused reserved difference (`Convert Reserve to Actual`, `budget-control`), atomic with the transition to `COMPLETED`.
2. The settlement path checks for an existing `Payment` row for this document; if one exists (the early-record case), it emits `payment.settled` for that row instead of requiring a fresh `record()` call. If none exists, behavior is exactly today's — the document lands in the ready-to-pay queue as usual.
3. GL posting proceeds unchanged (`gl-journal`, `Posting on Payment Settlement`).

**Sequence C — a later step rejects instead (the new case):**
1. REJECT branch runs its existing unconditional release — full original reservation, invariant 5, unchanged.
2. Check `em.count(Payment, { document: documentId })`. If one exists, stamp `recoveryStatus = 'PENDING_RECOVERY'` on it (ordinary column update, decision 4) in the same transaction as the terminal status write.
3. No `budget_txn` write beyond the normal release; no GL posting is ever triggered for this payment (it never reached `payment.settled`) — the real cash outflow it represents is reconciled later by a human-raised `GL_JV_POST`, not by this transaction.

## Risks / Trade-offs

- **[Risk]** A downstream reject — mistaken or in bad faith — creates recovery-chasing work for a payment that was actually fine. → **Mitigation:** nothing is auto-reversed; `PENDING_RECOVERY` only puts the document on a human-reviewed list, and raising the actual reversal JV still requires a person to act on it.
- **[Risk]** Treating this as a way to weaken downstream scrutiny (mark steps `requires_payment_slip` just to rush money out before later checks matter). → **Mitigation:** the flag is per-step, admin-configured, already gates approval today for a different reason (evidence-before-approve); this change doesn't add new places to set it, only new behavior for steps that already had it.
- **[Risk]** Between an early record and either outcome (settle or reject), the budget ledger and the `payment` table can briefly disagree — the ledger still shows a live reservation while a `payment` row already exists proving money moved. → **Mitigation:** this window already exists today in spirit (the slip-attach evidence proves the same fact); it is bounded by however long the remaining approval steps take, and is exactly what `recoveryStatus` exists to catch if the document is ultimately rejected rather than approved.
- **[Risk]** Race between approve-that-advances-the-step and record-at-that-step. → **Mitigation:** shared row lock, decision 6.

## Migration Plan

1. Migration: add `payment.recovery_status` (nullable enum) and `payment.recovery_flagged_at` (nullable timestamp) — nullable/no default, so existing `payment` rows are untouched and read as "not applicable."
2. Relax the `COMPLETED`-only guard in `PaymentService.record()` to the condition in decision 1; add the row lock from decision 6.
3. Add the `Payment`-existence branch to the `REJECT` path in `approval-routing.service.ts`.
4. Add `GET /payments/recovery-pending` + a finance list view.
5. Extract and mount the shared Record dialog on `DocumentDetailView.vue` (decision 2).
6. Rollback: the feature is entirely additive and gated by `requires_payment_slip`, which no live workflow step currently uses for early recording (only the demo step does). Reverting step 2's guard relaxation alone fully restores today's behavior; the new columns can stay (unused) without any data cleanup required.

## Open Questions

- Should a document landing on the recovery list also trigger an in-app/email notification to an accounting role, or is a polled list sufficient for v1? Leaning toward list-only for v1, notification as a fast follow if this proves to need faster response than "someone checks the list."
- Is the amount to recover the gross paid amount or net-of-WHT? This is an accounting-policy question, not an engineering one — needs finance sign-off before `tasks.md` implements the recovery-list amount display.
- Who resolves a `PENDING_RECOVERY` flag and unblocks resubmission — is marking it `RESOLVED` itself a `PAYMENT_MANAGE` action, or does it need a distinct permission code so the same person who flags it isn't also the one clearing it? Leaning toward a distinct check (whoever raises the `GL_JV_POST` reversal is accounting; whoever clears the flag should reference that voucher), needs confirmation before `tasks.md` wires the resolve endpoint.
