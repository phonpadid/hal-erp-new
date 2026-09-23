## 1. Data model

- [x] 1.1 Add `document_intake_log` to `erp_approval_system.dbml` next to the other log tables: `id uuid [pk]`, `company_id uuid [not null]`, `document_id uuid [not null]`, `action varchar [not null]` (`RECEIVE` / `REVERSE`), `actor_id uuid [not null]`, `acted_at timestamp [not null]`, `note varchar`, with indexes on `(document_id, acted_at)` and `(company_id, acted_at)`, and a note that it is append-only (invariant 2) and that received state is derived from the latest row, never stored
- [x] 1.2 Add the `DocumentIntakeLog` MikroORM entity in the document module, company-scoped like the other main tables, with the `Ref`s to `Document`, `Company` and `AppUser`; no updatable fields
- [x] 1.3 Generate the migration from the entity (`migration:create`), check the emitted SQL matches 1.1 exactly, and run `migration:up` against a scratch database to confirm it builds from nothing
- [x] 1.4 Add `DOC_INTAKE_RECEIVE` and `DOC_INTAKE_REVERSE` to `back/src/modules/document/permissions.ts` with comments saying what each is for and why neither is `DOC_RECEIVE` (that code is goods receipt against a PO's lines)

## 2. Receivability — the reached-my-desk rule

- [x] 2.1 Add a `receivableWhere(userId)` predicate to the intake service: an EXISTS over `document_approval_step_actor` joined to `document_approval_step` on `superseded_at IS NULL`, matching the document. One set-based condition, no per-row resolver call
- [x] 2.2 Write its unit tests first, from `specs/document-intake/spec.md`: a document whose step opened naming the user is receivable; one whose later step names them but has not opened is not (no actor rows before `openStep`); a DRAFT is not; an IN_APPROVAL one is; both holders of a role-targeted step qualify; a superseded step is ignored
- [x] 2.3 Add a test asserting the rule reads no `role.code` and no `department.dept_code` — a company whose finance step targets a differently-named role gets the same answer (invariants 5 and 7)

## 3. Intake service

- [x] 3.1 Implement `receive(documentIds)`: settle each document in its OWN `em.transactional(...)` so one refusal cannot roll back a sibling; inside each, take the `Document` row with `LockMode.PESSIMISTIC_WRITE` BEFORE reading its latest `document_intake_log` row, then append one `RECEIVE`
- [x] 3.2 Return a per-document outcome — received, `ALREADY_RECEIVED`, `NOT_REACHED`, `NOT_FOUND` — never a single verdict for the batch. An id outside the active company is `NOT_FOUND` and writes nothing (invariant 1)
- [x] 3.3 Implement `reverse(documentId, note?)`: appends a `REVERSE` row, refuses when the document does not currently read as received, and never touches the `RECEIVE` row it reverses
- [x] 3.4 Implement `stateFor(documentIds)`: the derived state for a set of ids in ONE query — latest row per document — returning received plus receiver name and time. No query per row
- [x] 3.5 Unit tests for 3.1–3.4 from the spec: one row per receive; reversal leaves the receipt and flips the state; receive-after-reverse appends a second `RECEIVE`; a nineteen-of-twenty batch reports the one refusal; rows never cross companies
- [x] 3.6 Concurrency test: two simultaneous `receive` calls on one document leave exactly one `RECEIVE` row and the loser reports `ALREADY_RECEIVED`. Same read-then-decide race the numbering path locks against — this is the test CLAUDE.md asks for wherever that race exists

## 4. Intake endpoints

- [x] 4.1 `POST /documents/intake/receive` behind `@RequirePermissions(DOC_INTAKE_RECEIVE)`, body `{ documentIds: string[] }` validated with class-validator (`@IsArray`, `@IsUUID('4', { each: true })`, non-empty, capped)
- [x] 4.2 `POST /documents/intake/:id/reverse` behind `@RequirePermissions(DOC_INTAKE_REVERSE)`, `ParseUUIDPipe` on the param, optional `note` in the body
- [x] 4.3 Guard tests: the receive endpoint refuses a caller without `DOC_INTAKE_RECEIVE`; the reverse endpoint refuses a caller holding only `DOC_INTAKE_RECEIVE`; a holder of the code who has not been reached is still refused, and nothing is written in any of the three

## 5. List read

- [x] 5.1 Lift the requester-name resolution out of `pending-summary.service.ts` into one shared helper (employee full name in the DOCUMENT's company, else `app_user.username`, department from the same record) and have both call sites use it — resolved once per page from the distinct creator ids, not per row
- [x] 5.2 Extend `DocumentService.list()` rows with `requesterName` and `requesterDepartment` from 5.1, and with the intake state from 3.4
- [x] 5.3 Unskip `back/src/modules/document/who-raised-it.spec.ts` (remove the `describe.skipIf` guard and the "work still owed" header) and make it pass unchanged — it is the contract, not a draft
- [x] 5.4 Add list tests for the intake fields: received names the receiver and time, reversed reads as not received, never-received carries neither
- [x] 5.5 Assert the page cost: a page of documents raised by many people, some received, resolves in a bounded number of queries

## 6. Actionable-rows endpoint

- [x] 6.1 Add `POST /approvals/actionable` taking `{ documentIds: string[] }` and returning the subset the caller may act on, resolved through the SAME `ApprovalInboxService` path `/approvals/pending` uses — no second implementation of eligibility or of the self-approval exclusion
- [x] 6.2 Tests: an eligible approver's document is in the subset; a document on an earlier step is not; a document the caller raised is not, even holding `DOC_APPROVE` (invariant 8); an APPROVED document is not; ids from another company are not

## 7. Frontend — the list

- [x] 7.1 Add the API client calls for receive, reverse, and actionable in `front-end/src/api/`, with types mirroring the DTOs
- [x] 7.2 Replace `canReviewRow` in `MyDocumentsView.vue` with the actionable set fetched once per page, and change the Approve button from `:disabled` to `v-if` so an ineligible row renders NO button. Drop the now-dead `documents.review.disabled` tooltip string if nothing else uses it
- [x] 7.3 Add the requester column: `[data-testid="requester"]` with `[data-testid="requester-department"]` beneath, the muted dash when the server named nobody, `data-priority="secondary"`
- [x] 7.4 Add the intake column: received (with receiver and time) or not, `data-priority="secondary"`, PrimeUI theme tokens only so light and dark both read
- [x] 7.5 Add row selection and the bulk receive action, both hidden unless the user holds `DOC_INTAKE_RECEIVE` or `DOC_INTAKE_REVERSE`; offer reversal only with `DOC_INTAKE_REVERSE`
- [x] 7.6 Report a batch result that names each refused document and its reason, not one toast for the whole batch
- [x] 7.7 Unskip `front-end/src/views/documents/documents-list-requester-column.spec.ts` (both `it.skip` cases and the "work still owed" header) and make them pass unchanged
- [x] 7.8 Add component tests for the Approve-button rule: no button for a row outside the actionable set, no button on a row the user raised, a button on an actionable row
- [x] 7.9 Add component tests for intake: the column renders all three states; selection and the action are absent without either code; a partly refused batch names what it refused

## 8. i18n

- [x] 8.1 Add `en`, `la` and `zh` strings for the intake column, its three states, the bulk action, the reversal action, and each refusal reason. Lao is the working language on this screen — the received state reads ກົດຮັບສຳເລັດ
- [x] 8.2 Add the requester column header in all three locales

## 9. Verification

- [x] 9.1 `pnpm --filter back run test` and `pnpm --filter front-end run ci` both green, with no `.skip` left in either of the two files this change was owed
  - Both owed files carry no `.skip`; typecheck clean; every spec this change touched or added is green.
  - Green only after two failures that predate this change were repaired in their own commits, because each would have failed the deploy's verify job for every push:
    - `back/src/modules/reporting/budget-quarter.spec.ts` — a date-dependent fixture that expired with the calendar. Its Q2 transaction on day 81 is now INSIDE the elapsed window Q3 is compared against (83 days elapsed as of 2026-09-21), so the comparison reads 1,000,000 instead of 100,000. Nothing in this change touches reporting or `budget_txn`. It fails the deploy's verify job for every push until the fixture is made relative to today.
    - `front-end/src/views/budgets/control-points-panel.spec.ts` — times out at the 5s default under full-suite load; passes alone in well under it. The frontend suite sets no `testTimeout`.
- [x] 9.2 `pnpm --filter back permissions:check` passes with the two new codes in the catalog
- [x] 9.3 Run the migrations against an empty database (`migration:up` on a fresh DB) — the deploy's own gate, and the one that catches an entity change a migration forgot
- [x] 9.4 Driven in the real app by the user, on both deployed environments: `DOC_INTAKE_RECEIVE` granted to the finance role, finance signed in again, receiving confirmed working. The Approve button was confirmed absent from rows that are not the reader's turn, and the intake column absent for a department with no intake duty.
