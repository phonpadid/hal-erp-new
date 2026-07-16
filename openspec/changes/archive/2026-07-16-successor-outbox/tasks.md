## 1. Data model

- [x] 1.1 Add `pending_successor` to `erp_approval_system.dbml` — `company_id`, `source_document_id`, `successor_type_id`, `status` (`PENDING`/`DONE`/`FAILED`), `attempts` int default 0, `last_error` text null, `created_at`, `updated_at`
- [x] 1.2 Add the `PendingSuccessor` entity as a `CompanyScopedEntity` under `back/src/modules/approval/`, with an index on `(status, created_at)` so the sweep's claim query does not scan the table as `DONE` rows accumulate
- [x] 1.3 Write the additive migration; no backfill — a `PROC` that already completed without its PO stays as it is and is created manually
- [x] 1.4 Add nullable `document_type_ref.successor_department_id` to the DBML, the `DocumentTypeRef` entity, and the migration (FK to `department`)
- [x] 1.5 Validate on write that `successor_department_id` belongs to the pairing's company (`ref-chain.service.ts`), and expose it on the pairing read surface
- [x] 1.6 Return the pairing rows (not bare `DocumentType[]`) from `autoCreateSuccessorsFor` — the outbox needs each pairing's successor department, which the current signature drops

## 2. Record the intent

- [x] 2.1 Replace `PostActionService`'s `CREATE_SUCCESSOR` early return (`post-action.service.ts:52`) with a real case that inserts one `PENDING` row per `autoCreateSuccessorsFor` pairing, using the transaction's `em` so it commits with the terminal transition
- [x] 2.2 Keep the logged no-op when no pairing is `auto_create`, and decide inactive-successor handling per the design's open question — record the choice in a comment either way
- [x] 2.3 Delete `createSuccessorIfConfigured` and its post-commit call at `approval-routing.service.ts:284`
- [x] 2.4 Drop the now-unused `@Optional() DocumentService` injection from `PostActionService` (`post-action.service.ts:41`) — the sweeper owns `createFrom` now
- [x] 2.5 Unit tests: two pairings write two `PENDING` rows in the approval transaction with no successor document yet; a rolled-back approval leaves no row; no `budget_txn`/`quota_usage` written; no `auto_create` pairing writes nothing
- [x] 2.6 Unit test: a failure to *write* the obligation exhausts the bounded retry and rolls the terminal transition back, leaving the document not `COMPLETED`

## 3. Drain the outbox

- [x] 3.1 Add `SuccessorSweeper` beside the `NotificationScheduler` pattern — `@Interval` backstop calling a separately unit-testable `scanPending()`
- [x] 3.2 Claim each row with `LockMode.PESSIMISTIC_WRITE` + `SKIP LOCKED`, then `createFrom`, then mark `DONE` — **all three in one `em.transactional`**, so a crash cannot leave a created successor beside a `PENDING` row
- [x] 3.3 On failure: increment `attempts`, store `last_error`, leave `PENDING`; at the bound, move to `FAILED` and stop retrying
- [x] 3.4 Trigger the sweep from the existing `approval.outcome` event when status is `COMPLETED` (there is no `document.approved` event) so the timer is only a backstop
- [x] 3.5 Build the sweep's identity explicitly — no ambient request: `RequestContext.run` with the source document's company, `successor_department_id ?? sourceDocument.department`, and the source document's `created_by`, then call `createFrom` inside it
- [x] 3.6 Confirm every `createFrom` runs in the source document's company and cannot create across companies
- [x] 3.7 **Concurrency test:** two sweepers racing one `PENDING` row create exactly one successor — do not rely on the numbering lock, which only makes two successors get different numbers
- [x] 3.8 Concurrency test: a row locked by a slow sweeper does not block a second sweeper from taking the next row (`SKIP LOCKED`)
- [x] 3.9 Unit tests: sweep creates the DRAFT and marks `DONE`; a creation failure leaves the source `COMPLETED` with the error recorded; a transient failure retries; the bound yields `FAILED` and no further retry; `FAILED` rows are queryable with source, successor type, and error

## 4. Successor identity

- [x] 4.1 **Regression test with the requester and the approver in different departments** — the whole point of choosing configuration over inheritance, and the case today's single-department fixtures cannot see
- [x] 4.2 Test: a pairing with `successor_department_id` set lands the successor in that department with that department's form template and workflow
- [x] 4.3 Test: a null `successor_department_id` keeps the successor in the source document's department
- [x] 4.4 Test: the successor's `created_by` is the source requester, not the approver — **and the `PROC`'s final approver is still eligible to approve the `PO`** (the invariant 8 collision today's behaviour creates)
- [x] 4.5 Test: the successor is identical whether the event or the timer backstop triggered the sweep

## 5. Repoint existing tests

- [x] 5.1 Re-point `approval-workflow.service.spec.ts:585` (`CREATE_SUCCESSOR creates a DRAFT for each auto_create pairing…`) at the sweep — it calls `createSuccessorIfConfigured` directly today, so it needs the new entry point, not a rewrite around a delay
- [x] 5.2 Update `procurement-chain.spec.ts` — it runs everything in one department (`:29`), so it passes under any identity rule; make it assert the new one
- [x] 5.3 Grep the suite for anything approving and then asserting the successor exists; make it await the sweep
- [x] 5.4 Run the full backend suite; **verify failures against pristine HEAD before blaming this diff** — profile, approval-inbox, multi-company, and `seedDatabase` specs are known to fail on HEAD

## 6. Config surface

- [x] 6.1 Accept `successorDepartmentId` in the ref-chain pairing DTOs and return it on reads
- [x] 6.2 Add the successor-department picker to `RefChainEditor`, shown only when auto-create is on, offering active departments of the active company, empty = source document's department
- [x] 6.3 Set `successorDepartmentId` on the seeded `PROC → PO` pairing so the demo data exercises the configured path rather than the null fallback
- [x] 6.4 Component tests: picker visibility follows auto-create and `DOC_CONFIG_MANAGE`; empty persists null

## 7. Ship

- [x] 7.1 Ship sections 2 and 3 **together** — the write alone queues intents nothing drains, the removal alone drops them
- [x] 7.2 Backstop interval is 1 minute and the retry bound is 5 attempts (≈5 minutes to `FAILED`); the `approval.outcome` event remains the normal path
- [x] 7.3 Before any rollback, drain `PENDING` rows or create their successors by hand — reverting leaves them unclaimed, the one step of this change that is not cleanly reversible
- [x] 7.4 Deploying into a multi-department company: set `successor_department_id` on every auto-create pairing **before** the sweep goes live, or an obligation whose source department cannot create the successor type lands in `FAILED`
