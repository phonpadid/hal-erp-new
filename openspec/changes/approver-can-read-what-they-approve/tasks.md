## 1. Tests first (reproduce the 404)

- [x] 1.1 DB-backed spec: a role granted AFTER the step opened — the new holder is listed by the inbox but `isVisible` answers false (red on current code)
- [x] 1.2 DB-backed spec: a role with no holders when the step opened, granted later to a DEPARTMENT-scope user in another department — same red case
- [x] 1.3 Invariant spec: for every user in the fixture, every document `ApprovalInboxService.pending` lists is readable via `DocumentService.isVisible` and `get`
- [x] 1.4 Negative specs: later-step role holder stays hidden; expired `valid_to` hides; another company's same-named role adds nothing; the creator path is unchanged
- [x] 1.5 Delegation day spec: UTC+7 company, delegation ending the 31st, read at 23:00 UTC on the 31st → not visible through delegation

## 2. Implementation

- [x] 2.1 In `DocumentService`, add `eligibleDocumentIds(em, userId)`: candidate query (active company, `IN_APPROVAL`, not created by me, current live step targeting me / a role I hold / an escalation to me / a principal delegating to me)
- [x] 2.2 Resolve candidates with `route.currentStepsOf` + `resolver.eligibleMany`, keep documents where the reader is an actor
- [x] 2.3 Add the result to `partyDocumentIds` as source 5, with a comment pointing to this change
- [x] 2.4 Switch `delegatedDocumentIds` to the company day (`localDateIn` + `company.timezone`)
- [x] 2.5 Confirm no action path (`act`, cancel, edit, submit) consults the widened predicate

## 3. Cost guard

- [x] 3.1 Query-count spec: a document read costs the same number of queries with 2 or 20 pending documents
- [x] 3.2 Measure list + detail on the 2026-10-13 production copy (`erp_perf`) before/after; record in the PR

## 4. Verification and ship

- [ ] 4.1 Re-run the inbox-vs-read check over all users on the production copy: 0 rows that 404
- [ ] 4.2 Build shared/back/back-scripts/front-end; full backend and frontend suites green
- [ ] 4.3 Update `openspec/specs/document-engine/spec.md` on archive
