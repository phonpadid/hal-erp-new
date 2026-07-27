## Context

The GL module posts from three triggers today, and all three share one shape: a listener catches an event post-commit, a service checks whether an entry already exists for that source, and builds a balanced entry or does nothing.

```
   payment.settled  ──▶ GlPostingListener ──▶ postForPayment(documentId)
   stock.moved      ──▶ GlPostingListener ──▶ postForStock(stockTxnId)
                                                    │
                                    findOne(JournalEntry, {company, sourceType, sourceId})
                                                    │  exists → return
                                                    ▼
                                          Dr … / Cr … , balanced
```

`postForPayment` builds its debit side from the document's `budget_txn` ACTUAL rows — `txn.budget.account` per row, summed per account — and credits cash-clearing. That is exactly the debit side an approval-time accrual needs, and those rows already exist by the time approval finishes: `PostActionService.run` writes them inside the approval transaction, and the events are emitted after it commits.

The approval engine already publishes what is needed. On the final approval it pushes `approval.outcome` with `status: 'COMPLETED'` onto `emitAfter`, which is drained after the transaction commits. Two listeners consume it today — `LeaveApprovedListener` and `CorrectionApprovedListener` — each filtering to the documents it owns. A third listener is a well-worn path, not a new mechanism.

Worth recording because planning said otherwise: the terminal status of a fully approved document is `COMPLETED`, not `APPROVED`. `ApprovalRoutingService` sets `APPROVED`, runs the post-action, then sets `COMPLETED` in the same transaction.

## Goals / Non-Goals

**Goals:**
- A claim's expense and the liability it creates appear in the ledger the moment it is approved.
- The trigger is configuration on the document type, not a hardcoded document code.
- Retrying the event cannot post twice.
- Every existing document type behaves exactly as it does today.

**Non-Goals:**
- Clearing the liability. That is the next change, which records payment and posts `Dr payable / Cr cash`. Until it exists the payable accumulates, and finance clears it periodically — a consequence that must be stated to them before this ships, not discovered at close.
- Changing when a *payment* posts. `postForPayment` is untouched.
- Supporting a type that both accrues at approval and settles a payment. See Decisions.
- Compensation in goods rather than cash. The credit account is resolved by role, which is what leaves that door open, but no second role is added here.

## Decisions

**A flag on `document_type`, not an inference.** A type opts in explicitly. Inferring from `post_action = CUT_BUDGET` would catch PR and every other budget-cutting type; inferring from `requires_payee = false` would catch the requisitions that simply do not know their payee yet. Invariant 7 says behaviour comes from configuration, and this is a behaviour.

*Alternative — infer from `requires_payee = false && post_action = 'CUT_BUDGET'`.* Rejected: it reads as a rule but is a coincidence of two flags that answer different questions, and the first type that breaks the coincidence would post an entry nobody asked for.

**A listener on `approval.outcome`, not a change to the approval engine.** The event is already emitted, already post-commit, and already has two consumers that filter to their own documents. Adding a third touches no existing line. It also gives the property the module's comment insists on: *"a GL failure must not roll back a movement already approved"* — a posting failure is logged and the approval stands.

*Alternative — post inside `PostActionService.cutBudget`, in the approval transaction.* Rejected: it would let a chart-of-accounts misconfiguration roll back an approval that approvers had already granted, which is precisely the coupling the existing design avoids for payments and stock.

**Debit side from the document's `budget_txn` ACTUAL rows.** The same source `postForPayment` uses, so the expense hits the accounts the budget actually charged, per account, at the locked basis. It also means the accrual is impossible to post for a document that cut no budget — which is correct: with nothing charged there is no expense to recognise.

**Credit side resolved by role, not by account code.** `CLAIM_PAYABLE` through `AccountRoleService`, per company. This is the mechanism `account_role` exists for — its DBML note says system accounts resolve *"by role, not hardcoded code (invariant 7)"* — and it is also what allows a later settlement in goods to credit a different role without touching this code.

**Idempotent on a source type of its own.** `(company, 'APPROVAL_ACCRUAL', documentId)`, matching how `SOURCE_PAYMENT` and `SOURCE_STOCK` are keyed. A distinct source type matters: a document could in principle carry both an accrual and, later, a payment entry, and they must not collide on the unique key.

**A type that accrues must not also settle a payment.** Both postings debit expense — the accrual from the ACTUAL rows, `postForPayment` from the same rows — so a type doing both would recognise the expense twice. This change does not make `postForPayment` payable-aware; it guards instead: the flag is rejected on a type with `requires_payee = true`, and the guard is a spec scenario rather than a comment. A future type that genuinely needs both would first have to teach `postForPayment` to debit the payable.

**No transaction boundary or lock is added.** This writes `journal_entry` and `journal_line` only. It writes no `budget_txn` and no `quota_usage`, and it takes no pessimistic lock: nothing here reserves budget or issues a number.

## Risks / Trade-offs

**The payable grows with nothing clearing it** until the settlement change lands → say so to finance before this ships; a balance that appears in the trial balance and is not explained is worse than one that is expected. The follow-up change is scoped and next.

**A missing `CLAIM_PAYABLE` role fails the posting after the approval has committed** → the approval stands and the failure is logged, exactly as a missing account fails a payment posting today; the operational answer is to configure the role when the document type is configured, which belongs in the same setup checklist. Worth failing loudly in the log rather than skipping silently, because a skipped accrual is invisible.

**Two postings could debit the same expense twice** if a type were ever configured to accrue and to pay → the guard above rejects that combination at configuration time, which is the earliest point it can be caught.

**The accrual depends on ACTUAL rows existing when the listener runs** → they are written by the post-action inside the approval transaction and the event is drained after commit, so the ordering holds; the spec pins it as a scenario so a future reordering of the emit breaks a test rather than the books.
