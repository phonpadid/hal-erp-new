## Context

`PaymentAttachment` is anchored to `Payment` by a NOT NULL `@ManyToOne`. `Payment` rows are written
only by `PaymentService.recordPayment`, which runs after a document is fully approved. So on the
current model the earliest possible moment for a slip to exist is strictly after the last approval —
which makes "attach evidence before step 4 is approved" not a missing feature but an impossible
state.

The controller surface already reads better than the model does. Every slip route is keyed by
`documentId` (`POST /payments/:documentId/slips/upload`, and the list, download and delete beside
it), and `payment-attachment.service.ts` immediately converts that id to a payment through a private
`requirePayment`, which throws `NotFoundException` when none exists. The document is already the
identifier callers use; only the storage anchor disagrees.

The approve path is `approval-routing.service.ts`. It runs inside `em.transactional` holding
`LockMode.PESSIMISTIC_WRITE` on the document row, and already contains the precedent for the gate
this change needs:

```ts
if (dto.action === ApproveAction.APPROVE) {
  await this.postAction.assertApprovable(document, tem);
}
```

placed after eligibility and self-approval checks and before the `ApprovalLog` row is persisted.

The database is live: 42 documents, 6 `payment_attachment` rows, 29 `workflow_step` rows, 5 budgets
and 31 `budget_txn`. Every existing `payment_attachment` reaches a document through
`payment.document_id`, which is NOT NULL, so no current row is ambiguous.

## Goals / Non-Goals

**Goals:**

- A workflow step can declare that it requires payment evidence, and an APPROVE on that step is
  refused while the document carries none.
- A slip can be attached to a document that has no payment yet, through the routes that already
  exist, without changing their URLs.
- The refusal is indistinguishable from any other pre-commit refusal: no `approval_log` row, no step
  movement, no hold release.
- Every existing slip keeps its meaning and its payment.

**Non-Goals:**

- Changing when a payment may be recorded, or relaxing the existing rule that a hand-recorded
  payment supplies its evidence in the same request. That rule governs a different actor at a
  different moment and stays exactly as specified.
- Inferring the requirement from a document type, an amount, or a step number. The flag is
  configuration, per invariant 7.
- Any budget or quota effect. Evidence settles nothing.

## Decisions

### The document becomes the anchor; the payment becomes optional

`payment_attachment` gains a NOT NULL `document_id` and its `payment_id` becomes nullable. A slip
names the document it evidences always, and the payment when one exists.

*Why:* it matches what a slip is. A transfer slip evidences money moving for a document; the
`payment` row is the system's later record of that same event, not the thing the slip is about. It
also makes the backfill total — `payment.document_id` is NOT NULL, so every existing row already
knows its document — and leaves the public routes unchanged, because they were keyed by document all
along.

*Alternatives considered:*

- **A separate `document_slip` table for mid-approval evidence.** Rejected: two tables holding the
  same kind of evidence means every reader — `slipStatus`, the document detail panel, the payment
  screen, any future audit export — has to union them and decide which one wins when both exist.
  The prior branch's own migration reached the same conclusion.
- **Write a placeholder `Payment` at approval time.** Rejected outright: `payment` means money left
  the company, and it carries a locked rate, an actual rate, an FX delta and a WHT computation. A
  placeholder would be a payment that has not happened, visible to the ready-to-pay list, the GL
  posting engine and the accounting period close.
- **Keep `payment_id` NOT NULL and make `document_id` nullable instead.** Rejected: it inverts which
  fact is guaranteed. A slip with neither would then be possible, and the gate needs a guaranteed
  path from a document to its evidence.

### The gate is a read under the document's existing lock

`assertSlipAttached(document, step, tem)` runs inside the same `em.transactional` and under the same
`LockMode.PESSIMISTIC_WRITE` on the document row, immediately after the existing `assertApprovable`
call and before the `ApprovalLog` is created. It applies only when `dto.action === APPROVE` and the
resolved step's `requiresPaymentSlip` is true.

*Why here:* the transaction and lock already exist, and it is the point at which a refusal costs
nothing. Refusing later — after the log row, or after the step moved — would either write an audit
row for an action that did not happen or roll back an approval the previous approver did commit.
`approval_log` is append-only (invariant 2); the only safe way to refuse is before the insert.

*Rejected:* a guard or interceptor on the controller. It would run outside the transaction and
outside the lock, so its answer could be stale by the time the approval commits, and it would have
to re-resolve the current step to know whether the flag even applies.

### Slip delete takes the same document lock

Deleting a slip acquires `LockMode.PESSIMISTIC_WRITE` on its document before removing the row.

*Why:* without it, a delete committing between the gate's read and the approval's commit would leave
a step approved under a requirement it no longer satisfies. Taking the same lock makes the two
serialize: either the delete lands first and the approval is refused, or the approval commits and
the delete follows it. Upload needs no such lock — an upload can only ever add evidence, so a race
resolves to "approved with a slip" or "refused, then a slip arrives", both of which are correct.

### `SlipStatus` answers "is there evidence", not "is there a payment with evidence"

Today `UPLOADED` requires a payment *and* an attachment; everything else is `PENDING`. It becomes:
`UPLOADED` when the document has at least one slip, `PENDING` otherwise.

*Why:* under the old rule a document evidenced mid-approval reports `PENDING` while its slip is
sitting in storage — the column would state the opposite of the truth for exactly the documents this
change exists to serve. The column's own header asks whether the transfer is evidenced.

*Trade-off:* a reader who used `UPLOADED` to mean "paid and evidenced" loses that reading. Nothing
does — the ready-to-pay list decides on payment state directly, not through this map.

### The flag restore is an operational step, not part of the migration

The migration adds `requires_payment_slip` with `default false` and nothing else. Turning it on for
HAL step 4 is a separate, idempotent statement recorded in tasks.md.

*Why:* a migration runs on every environment. A migration that writes a specific company's row id
would be wrong everywhere that row does not exist, and it would make a configuration decision that
belongs to the company, not to the schema.

## Risks / Trade-offs

- **The gate can strand a document.** A step requiring a slip, on a document whose payment cannot yet
  be made, is unapprovable until someone uploads evidence. → This is the intent, and the escape
  hatches already exist: reject and return are untouched, so the document can always be sent back or
  refused. The approval screen states the requirement rather than failing an approval with an opaque
  error.
- **A misconfigured flag blocks a live workflow.** Setting it on a step whose approver holds no
  `PAYMENT_MANAGE` produces a step nobody can pass. → The admin form warns when the configured
  approver role cannot upload, following the existing "A Configuration Screen Says When A Setting
  Cannot Take Effect" requirement in `web-doc-config`.
- **`down` loses mid-approval slips.** Rows with a null `payment_id` cannot survive the constraint
  coming back. → `down` deletes exactly those rows and says so, matching the prior branch's
  migration. Their bytes remain in object storage rather than being destroyed by a schema rollback.
- **Backfill correctness rests on `payment.document_id` being NOT NULL.** → It is, and the migration
  sets `document_id` NOT NULL only after the backfill, so a row that somehow had no document would
  fail the migration loudly rather than being silently given one.

## Migration Plan

Single migration, ordered so that no statement can half-apply:

1. `alter table "workflow_step" add column "requires_payment_slip" boolean not null default false;`
   — additive with a default, so existing rows are valid immediately and no reader changes meaning.
2. `alter table "payment_attachment" add column "document_id" uuid null;`
3. `update "payment_attachment" pa set "document_id" = p."document_id" from "payment" p where p."id" = pa."payment_id";`
4. `alter table "payment_attachment" alter column "document_id" set not null;` — fails loudly if step
   3 left any row unmatched.
5. FK to `document` and an index on `document_id`.
6. `alter table "payment_attachment" alter column "payment_id" drop not null;` — last, so the
   nullable payment only becomes possible once every row already names its document.

`down` reverses it, deleting `payment_attachment` rows with a null `payment_id` first because they
cannot satisfy the restored NOT NULL. The deletion is data loss confined to slips that only this
change made possible.

Deploy order: migration, then backend, then frontend. The gate reads a column that defaults to
false, so a backend deployed before any step is configured changes no behaviour.

Post-deploy, once: turn the flag on for HAL step 4, keyed by workflow name and step number rather
than by row id so it is safe to re-run.

## Sequence and transaction notes

**This change writes no `budget_txn` and no `quota_usage`.** Evidence is not settlement: the budget
settled to `ACTUAL` when the document completed, and no path added here touches a ledger. The only
ledger interaction is negative — a refused approval must not write `approval_log`.

Approve, one transaction:

```
em.transactional:
  SELECT document FOR UPDATE          (existing)
  assert status = IN_APPROVAL         (existing)
  resolve current step                (existing)
  assert eligibility, not self         (existing)
  if APPROVE: assertApprovable         (existing)
  if APPROVE and step.requiresPaymentSlip:
      count payment_attachment where document = doc
      throw if 0                       ← new, still before any write
  INSERT approval_log                  (existing, first write)
  ... step close / open, post-actions  (existing)
```

Slip delete, one transaction:

```
em.transactional:
  SELECT document FOR UPDATE          ← new, serialises against approve
  load attachment, assert company
  DELETE payment_attachment
  delete stored object after commit
```

Slip upload takes no document lock, deliberately: it can only add evidence, so neither interleaving
with an approval can produce a wrong outcome.

## Open Questions

- Should a step requiring a slip also require it before **escalation** hands the step to a different
  approver? The SLA sweeper moves the step without an APPROVE, so the gate does not apply. Leaving
  it unapplied is the smaller change and keeps escalation's meaning ("this step is late") intact.
- Should the requirement be visible on the document PDF, alongside the approval history? Out of scope
  here; raise separately if auditors ask for it.
