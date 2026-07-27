## 1. Canonical model first

- [x] 1.1 Add the flag to `Table document_type` in `erp_approval_system.dbml` — a boolean
  defaulting to false, with a note saying the expense is recognised at full approval rather than at
  payment settlement, and that it may not be combined with `requires_payee`.
- [x] 1.2 Add `CLAIM_PAYABLE` to the `account_role_type` enum in the DBML, with a note naming it as
  the liability between an approved compensation and the money leaving — the same shape as `GRNI`,
  for an obligation that arises at approval rather than at receipt.

## 2. Enum, entity, migration

- [x] 2.1 Add `CLAIM_PAYABLE` to `AccountRoleType` in `back/src/common/enums/index.ts`, with the
  same one-line reason the neighbouring roles carry.
- [x] 2.2 Add the flag to the `DocumentType` entity, defaulting to false.
- [x] 2.3 Generate a migration for the boolean and confirm it is additive: a default of false means
  every existing row keeps today's behaviour and nothing is backfilled. Check whether the enum
  value needs a database change at all — if `account_role.role` is stored as a string rather than a
  native enum, it does not.
- [x] 2.4 Run `migration:up` on a scratch database and confirm existing document types read false.

## 3. Reject the impossible configuration

- [x] 3.1 In the document-type service, reject creating or updating a type that carries the flag
  together with `requires_payee = true`, with a message that says why — the expense would be
  recognised twice, once at approval and once at settlement.
- [x] 3.2 Cover both directions: setting the flag on a type that already requires a payee, and
  setting `requires_payee` on a type that already accrues.

## 4. Post the accrual

- [x] 4.1 Add a posting method to `GlPostingService` alongside `postForPayment` and the stock
  posting. Read the document's `budget_txn` ACTUAL rows, aggregate per `txn.budget.account` at the
  locked basis for the debit side, resolve `CLAIM_PAYABLE` through `AccountRoleService` for the
  single credit line, and guard on `findOne(JournalEntry, { company, sourceType: 'APPROVAL_ACCRUAL',
  sourceId: documentId })` before writing — the same idempotency guard the other two use.
- [x] 4.2 Return without writing when the document's type does not carry the flag, and when the
  document has no ACTUAL rows. Neither is an error.
- [x] 4.3 Subscribe in `GlPostingListener` to `approval.outcome`, acting only on
  `status === 'COMPLETED'`, and follow the file's existing shape: catch, log, never propagate — a
  posting failure must not disturb an approval that has already committed.
- [x] 4.4 Confirm no line of `ApprovalRoutingService`, `PostActionService`, or `postForPayment`
  changes. If any of them needs to change, stop and revisit the design.

## 5. Prove it

- [x] 5.1 DB-backed spec: a document of an accruing type, fully approved, produces one entry
  debiting the budget's expense account and crediting the company's `CLAIM_PAYABLE`, balanced.
- [x] 5.2 Spec: two budgets on one document produce one debit line per account plus one credit line
  for the sum.
- [x] 5.3 Spec: a document of a non-accruing type produces no entry at approval.
- [x] 5.4 Spec: with no `CLAIM_PAYABLE` mapped, the document is still approved with its budget cut
  and no entry exists.
- [x] 5.5 Spec: delivering the outcome twice leaves exactly one entry.
- [x] 5.6 Spec: a document with no ACTUAL rows posts nothing.
- [x] 5.7 Spec: the roles are company-scoped — company B's posting never resolves company A's
  mapping.
- [x] 5.8 Spec: configuring the flag together with `requires_payee` is rejected, both directions.
- [x] 5.9 Spec: the ACTUAL rows are readable when the listener runs — assert the accrual finds them
  after a real approval, so a future reordering of the emit breaks a test rather than the books.

## 6. Verify

- [x] 6.1 Run the full `pnpm --filter back test` and confirm no regression, particularly the
  existing payment and stock posting specs.
- [x] 6.2 Run `pnpm --filter back boot:check` — a new listener subscription is exactly the kind of
  wiring the specs do not exercise.
- [x] 6.3 Re-read both delta specs against the implementation, then archive through
  `/opsx:archive` rather than editing the main specs by hand.

## 7. Tell finance before it ships

- [x] 7.1 The payable accumulates until the settlement change lands. Written as
  `docs/claim-payable-note.md`: what posts at approval, that the second leg is not built yet, the
  three setup steps (create the liability account, map `CLAIM_PAYABLE`, check `budget.account_id`),
  and that an unmapped role fails silently into a log. **Still needs a human to hand it to whoever
  closes the books** — writing it is not the same as it having been read.
