## Context

`DocumentService.visibleWhere` is the one read predicate behind every document read — the list, the
detail, the PDF, attachments, approval history, the 3-way match. It is
`scope half OR created_by = me OR id IN partyDocumentIds()`, where the party ids come from four
sources: `approval_log` rows I wrote, `document_approval_step_actor` rows naming me on a live step,
live steps escalated to me, and live steps whose recorded actor delegated to me.

The approval inbox decides its rows with `ApproverResolverService.eligibleMany` over each
`IN_APPROVAL` document's current step: the step's user, the LIVE holders of its role on the
company's day, their active delegates, and the escalation target. The actor rows the read relies on
are frozen in `DocumentRouteService.openStep` and written only `if (existing === 0)` holders — so a
role granted later, or a role that was empty at open, is eligible in the inbox and invisible on
read. Approving still works (`act` never calls `assertVisible`); only reading 404s.

The inbox speed fix (2026-10-21) made eligibility cheap to resolve in bulk: `currentStepsOf` reads
the current steps of any number of documents in one query and `eligibleMany` resolves them in three.

## Goals / Non-Goals

**Goals:**
- Anything the inbox lists for a user is readable by that user, by construction — the read uses the
  same resolver, not a second implementation of who may approve.
- Every read stays a fixed number of queries, independent of how many documents are pending.
- Delegation and role windows are read on the company day everywhere in the read path.

**Non-Goals:**
- Unfreezing `document_approval_step_actor`, or changing which approvals a PARALLEL_ALL step needs.
- Changing what a user may DO — submit, cancel, edit and the approval actions keep their guards.
- Department-scoped role routing (role steps resolving company-wide is current, deliberate
  behaviour; the owner has their own plan for it).
- Any frontend change: the screens already render what the read returns.

## Decisions

**1. Reuse the resolver, do not re-express eligibility in SQL.**
A raw-SQL mirror of the resolver (role validity, delegation window/type/limit, escalation, company
day) would be a second implementation of invariant 8's neighbour and would drift; the existing
delegation source is already such a mirror and has already drifted (it reads the server's UTC day
where the resolver reads the company's). Instead: pick candidates cheaply in SQL, then ask
`eligibleMany` and keep the documents where the reader is an actor.
*Alternative rejected:* an `EXISTS` subquery reproducing all rules — fastest, but two rule sets.

**2. Candidate set narrowed in SQL first.**
Candidates = active company, `status = IN_APPROVAL`, `created_by <> me`, and current live step
(`document_approval_step` with `step_no = document.current_step_no`, `superseded_at IS NULL`)
whose `approver_user_id = me` OR `approver_role_id IN (roles I hold in this company, any window)`
OR `escalated_to_user_id = me` OR whose principal has an `ACTIVE` `approval_delegation` to me.
This is a superset of the truth (validity windows and delegation limits are checked by the
resolver), and for a typical reader it is a handful of documents. Cost: ~2 queries for candidates +
`currentStepsOf` (1) + `eligibleMany` (3), paid once per read. Measured target: under 50 ms added
on the 2026-10-13 production copy.
*Alternative rejected:* all `IN_APPROVAL` documents of the company as candidates — correct but
~300 ms on every list, detail, PDF and attachment read.

**3. Keep the four existing sources.** They cover what live eligibility cannot: documents already
acted on (log), steps whose recorded actors no longer hold the role, and completed-but-live steps.
The new source is an addition to `partyDocumentIds`, not a replacement.

**4. Fix the delegation source's day.** `delegatedDocumentIds` compares to
`new Date().toISOString()`; switch it to the company day the resolver uses (`localDateIn` with
`company.timezone`), so the two cannot disagree at the day boundary in UTC+7.

## Risks / Trade-offs

- [Wider read than intended] A reader gains visibility of documents they are eligible to approve —
  which is exactly what they can already act on. → Visibility only; every action keeps its guard;
  tests assert no action is granted. Company filter applied in both candidate query and resolver.
- [Cost on every read] The predicate runs on every document read. → Narrow candidate query (Decision
  2), a query-count test that the cost does not grow with the number of pending documents.
- [`IN (...)` literal grows] Party ids become an `IN` list. → A reader is eligible on at most the
  documents their inbox shows (largest today: ~170); acceptable. If it reaches the high hundreds,
  move to an `EXISTS` subquery as the existing comment already notes.
- [Circular dependency] `DocumentService` already holds `ApproverResolverService` and
  `DocumentRouteService`; no new module import is needed.
- No `budget_txn` / `quota_usage` writes, no transaction or lock changes: this change is read-only.

## Migration Plan

No schema change and no data migration. Ship as one commit; rollback is reverting it. After deploy,
verify with the 2026-10-13 copy: every inbox row for every user opens (the check script used for the
speed fix reported 0/730 failures before; it must stay 0, and the regression fixture must now pass).

## Open Questions

- Should the detail screen say *why* a reader can see a document (e.g. "you are an approver of this
  step")? Out of scope here; no current request.
