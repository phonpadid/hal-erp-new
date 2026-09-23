## 1. Backend — withdrawal authorized by scope

No entity change and no migration: no column is added, removed or backfilled. No flow here writes
`budget_txn` or `quota_usage` beyond the release `cancel` already performs inside its existing
transaction, so no new `em.transactional()` and no pessimistic lock is introduced.

- [x] 1.1 In `DocumentSubmitService.cancel`, replace the `doc.createdBy.id !== userId` refusal with the predicate `ScopeService.scopeWhere('DOC_CANCEL', { ownerField: 'createdBy', deptField: 'department' })` produces, evaluated against the document already locked with `PESSIMISTIC_WRITE`.
- [x] 1.2 Keep the evaluation inside the existing transaction and after the lock, so two concurrent withdrawals cannot both pass the check; keep the already-`CANCELLED` early return ahead of it so a retry stays a no-op.
- [x] 1.3 Keep the status gate (`DRAFT`, `SUBMITTED`, `IN_APPROVAL`) exactly as it is — scope decides who, not what.
- [x] 1.4 Wire `ScopeService` into `DocumentSubmitService`. **Resolved differently than written:** no DI and no `@Optional()` — `DocumentService` already constructs its own `ScopeService` as a field because the service is stateless and reads `RequestContext`. Followed that, which leaves every positional construction in the unit tests untouched and needs no module change.
- [x] 1.5 Confirm the refusal is a `ForbiddenException` (or the coded equivalent the module uses) and that its message names the scope rule rather than "only the creator".

## 2. Backend — the creator is a party

- [x] 2.1 In `DocumentService.visibleWhere`, add `{ createdBy: userId }` to the `$or` beside the party ids, so it applies whether or not `partyDocumentIds` returned anything.
- [x] 2.2 Keep it a `where` fragment rather than another id query — the other party sources each need a lookup and this one does not.
- [x] 2.3 Leave the company filter and the type gate untouched; the rule widens reading only.

## 3. Backend — the detail answers "may I withdraw this"

- [x] 3.1 Add the server's own answer to the document detail read, beside `canAct`, computed from the same predicate `cancel` enforces plus the status gate.
- [x] 3.2 Expose it on the detail DTO so the client has no scope rule of its own to evaluate.

## 4. Backend — tests

- [x] 4.1 `OWN` scope behaves exactly as today: own document withdrawn, someone else's refused.
- [x] 4.2 `DEPARTMENT` scope withdraws a document of the caller's department that they did not raise, and is refused for another department's.
- [x] 4.3 `COMPANY` scope withdraws any document of the active company; a document of another company is not found (invariant 1).
- [x] 4.4 An ungranted `DOC_CANCEL` collapses to `OWN` and refuses someone else's document.
- [x] 4.5 The `CREATE_SUCCESSOR` shape end to end: a successor swept into department B, `created_by` a requester in department A — a department-B holder withdraws it, and the `CANCEL` row names them.
- [x] 4.6 Scope does not widen the status gate: a `COMPLETED` document is refused at `COMPANY` scope.
- [x] 4.7 A non-creator's withdrawal still releases budget and quota holds (invariant 5), and still writes exactly one `CANCEL` row in the same transaction as the status change (invariant 2).
- [x] 4.8 Visibility: the predecessor's requester can read a successor written into a department they do not belong to; a user reassigned between departments keeps the documents they raised in the old one.
- [x] 4.9 Visibility grants no action: a reader who sees a document only through the creator rule is still refused an act their scope does not cover.
- [x] 4.10 Concurrency: two simultaneous withdrawals of one document write one `CANCEL` row, the second returning the no-op path.

## 5. Frontend

- [x] 5.1 Replace `canCancel` in `DocumentDetailView.vue` — drop the `creatorId(doc.createdBy) === auth.userId` comparison and read the server's flag, keeping `auth.can('DOC_CANCEL')` as the affordance-level guard the other buttons use.
- [x] 5.2 Leave the confirmation dialog, the remark field and the `SUBMITTED`/`IN_APPROVAL` wording exactly as they are.
- [x] 5.3 Check every other place that gates on being the creator and decide, per site, whether it is the same defect or a genuinely creator-only affordance; change only what the specs cover here.
  - `DocumentDetailView`: the withdraw gate — fixed here, and the now-unused `creatorId` import dropped.
  - `PendingVouchersView.vue:53` (`isMine`): **the same defect, deliberately left.** It gates a withdraw button the same way, but belongs to a different capability (web-accounting / gl-journal, not the `web-documents` delta this change carries) and is a LIST, so fixing it properly means adding a per-row `canCancel` to the read behind `PendingVoucher`. It under-offers — it hides a button from someone now permitted — and never offers one the server would refuse, so it is safe to leave. Flagged as its own task.
  - `PendingVouchersView.vue:100` (the "yours" tag): NOT the same defect. It labels authorship rather than gating an act, so creator identity is the right question there.

## 6. Frontend — tests

- [x] 6.1 The withdraw button renders for a document the reader did not raise when the server says they may.
- [x] 6.2 It is withheld when the server says they may not, including for a document they did raise but whose status forbids it.
- [x] 6.3 The existing creator-withdraws-own-draft case still passes unchanged.

## 7. Verify

- [ ] 7.1 Run the backend and frontend unit suites; both green before anything else.
- [ ] 7.2 Reproduce the original failure against the real app through the `dev-stack` skill: a PR in department A whose pairing sweeps a PO into department B — confirm the requester can now see the PO and a department-B holder can withdraw it.
- [ ] 7.3 Confirm no `budget_txn` row is written by a withdrawal of a draft, and that one is released by a withdrawal of a submitted document.
- [ ] 7.4 Read the live `DOC_CANCEL` role configuration and record, in the release note, what scope it carries and therefore who gains the right — the change is correct at any scope, but administrators must not learn the new meaning from behaviour.
