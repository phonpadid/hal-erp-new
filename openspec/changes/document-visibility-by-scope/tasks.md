## 1. The visibility predicate

- [x] 1.1 Add a `visibleDocumentWhere()` to `DocumentService` (or a small collaborator) returning the union: `{ $or: [ scope.scopeWhere('DOC_VIEW', { ownerField: 'createdBy', deptField: 'department' }), { id: { $in: <party ids> } } ] }`
- [x] 1.2 Collect the "party to" ids in one pass: document ids from `approval_log` where `approver = me`, plus document ids from live `document_approval_step` (`supersededAt: null`) whose `document_approval_step_actor.user = me`. Company-scoped, deduped
- [x] 1.3 Short-circuit for COMPANY/GROUP: `scopeWhere` returns `{}` there, so skip the party query entirely rather than building a union that changes nothing — the largest result sets pay nothing
- [x] 1.4 Unit-test the predicate shape per scope (OWN / DEPARTMENT / COMPANY / ungranted → OWN), the way `rbac-unit.spec.ts` tests `scopeWhere`

## 2. Apply it to the reads

- [x] 2.1 `list()`: combine the visibility predicate with `buildDocumentFilter(q)` conjunctively, inside `forActiveCompany()` so the company filter stays first
- [x] 2.2 `getWith()` / `get()`: apply the same predicate, so an out-of-scope id answers not-found
- [x] 2.3 `detail()`: same predicate — it resolves the document itself, and must not be a way around the list
- [x] 2.4 Audit the other reads that share this entry point (the id-collecting read behind the list, `canAct`, the SLA and pending-approver reads) and either apply the predicate or record in a comment why that read is deliberately wider
- [x] 2.5 Leave submit / cancel / edit / approve resolution untouched — confirm by reading each path that none of them resolves through the narrowed read

## 3. Backend tests

- [x] 3.1 List at OWN: sees own, not a colleague's; at DEPARTMENT: sees the department, not another's; at COMPANY: sees all of the company and nothing from a second company
- [x] 3.2 Party-to: a recorded actor on the open step sees the document; an approver who already acted still sees it; someone who REJECTED or RETURNED still sees it
- [x] 3.3 Party-to does not leak forward: a user named only on a step the route has not reached does not see the document
- [x] 3.4 Party-to never crosses companies: an approval history in company A adds nothing to a list read in company B
- [x] 3.5 Read/detail agree: every id the list returns is readable, and an id it omits answers not-found
- [x] 3.6 Actions are unaffected: an OWN-scope eligible approver can still approve; a party-to reader without `DOC_CANCEL` still cannot cancel
- [x] 3.7 The approval inbox is unchanged — a pending count taken before and after the scoping is identical for the same user

## 4. The "only mine" filter

- [x] 4.1 Add `mine?: boolean` to `DocumentListQueryDto` with `@IsOptional() @IsBoolean()` and the transform the other boolean query params use, and apply it in `buildDocumentFilter` as `createdBy = me`
- [x] 4.2 Confirm by test that it composes INSIDE the visibility predicate — a `mine` request never returns a document the predicate hides
- [x] 4.3 Add the toggle to the documents list filter panel, defaulted off, labelled in `la` / `en` / `zh`
- [x] 4.4 Tests: narrows for a DEPARTMENT reader and for a COMPANY reader; combines with `status`; unset changes nothing

## 5. Front-end

- [x] 5.1 Check whether any screen assumed company-wide document reads (the documents list filters, the reports links, "create from predecessor") and make the narrowed result read as intentional rather than as an empty page
- [x] 5.2 Tests for whichever of those changed

## 6. Grants

- [x] 6.1 Apply the confirmed scope per role in one transaction, keyed by role code + company code so it is re-runnable: `IT-STAFF` → DEPARTMENT, `DEPT_HEAD` → DEPARTMENT; `ADM-STAFF`, `HEAD-IT`, `REQUESTER` stay DEPARTMENT; `BG-STAFF`, `BUDGET_OFFICER`, `FN-STAFF`, `FINANCE_HEAD`, `AC-STAFF`, `ACCOUNTING_HEAD`, `PRESIDENT`, `ADMIN` stay COMPANY
- [x] 6.2 Record the previous values first, so the change is reversible with the same statement
- [x] 6.3 Verify per role against the live data: for one holder of each role, count what the list returns before and after and check it against the table in design.md

## 7. Verify

- [ ] 7.1 `pnpm --filter back test`, `typecheck:scripts`, `boot:check`, `pnpm --filter front-end run ci` — all green (with `nvm use`; backend suite against the test database)
- [ ] 7.2 Confirm on the live data with a real user of each shape: an `IT-STAFF` requester sees the IT department and not ADM's; `mine` narrows them to their own; `FN-STAFF` still sees everything; `finance_head` can still open and approve a disbursement from another department

## 8. Risks found by reviewing the finished change

- [x] 8.1 Cover the approvers the first predicate missed. `ApproverResolverService.eligible` returns THREE kinds — recorded principals, the escalation target (`step.escalatedToUser`, deliberately not an actor row so a PARALLEL_ALL step gains no required approval), and a live delegate (resolved on the fly, stored nowhere). Only the first was covered, so a stand-in got the document in their inbox and a 404 when they opened it — broken exactly when somebody is away, which is when a stand-in is the point
- [x] 8.2 Narrow the delegation half to what the delegation actually covers (`documentType`, `amountLimit`, active window). A read filter wider than the authority it mirrors is a second, quieter permission rule
- [x] 8.3 **Property test tying the two halves together**: every user `eligible()` returns must pass `assertVisible()`, asserted over all three kinds at once so a FOURTH kind added later fails here rather than in front of whoever is covering for a colleague. This is the test that would have caught 8.1
- [x] 8.4 Test the inverse too — a delegation capped below the document's amount does NOT open it, and removing the cap does, so the assertion is about the limit rather than the delegation being ignored
- [x] 8.5 `boot:check` reports documents that are IN_APPROVAL with no live route. The five frozen by `Migration20260828000000` were silent for six weeks; this runs on every deploy. A warning, not a failure — a frozen document is a data repair, not a reason to refuse a deploy that may be carrying the fix. Verified by superseding one route row on the live data, seeing the warning, and restoring it
- [x] 8.6 Left deliberately undone, with the reasons recorded in design.md: `EXISTS` instead of `IN` (the largest party list on live data is ten; a note in the code names the threshold), scoping the report reads (a separate change, so one release does not narrow six screens at once), and multi-department readers (nobody holds two departments today)
