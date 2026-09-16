## Why

Every user in a company sees every document. A requester in the IT department opens the documents
list and reads the administration department's disbursements, other people's claims, and the
budget office's paperwork. The customer reported it as the obvious problem it is: a requester should
see their own documents, and an approver the ones that reached them.

This is not a missing feature. `rbac`'s **Data Scope Enforcement** already says it:

> Each granted permission SHALL carry a scope of OWN, DEPARTMENT, COMPANY, or GROUP. Every data
> query MUST filter by the active company first, then by scope.
>
> *Scenario:* a user with `DOC_VIEW` at DEPARTMENT scope lists documents → only documents of their
> department in the active company are returned.

`ScopeService.scopeWhere` implements exactly that, and has unit tests. **No service calls it.** A
search of `back/src` finds the function referenced only in its own file and its own unit spec. The
document list applies the company filter and stops:

```ts
list(q) {
  return paginate(this.scope.forActiveCompany(), Document, buildDocumentFilter(q), …);
}
```

So the scenario in the spec has never been true of the running system, and no test noticed, because
the only test of scoping tests the function rather than the list.

## What Changes

- The document list SHALL filter by the scope `DOC_VIEW` was granted at, after the company filter.
- **A document a user is or was an approver on SHALL remain visible to them whatever their scope.**
  Without this the fix breaks approval: a department head granted OWN or DEPARTMENT scope could no
  longer open a disbursement raised in another department — the exact document they exist to
  approve. The approval inbox resolves eligibility independently of `DOC_VIEW` and keeps working,
  but the document it links to would 404.
- The same predicate SHALL govern the single-document read, so anything the list shows can be
  opened, and nothing it hides can be read by guessing an id.
- Role grants are re-scoped to match how the company actually works: ordinary staff to OWN,
  department heads to DEPARTMENT, and the three departments every document passes through —
  budget (`BG`), finance (`FN`) and accounting (`AC`) — left at COMPANY.

Explicitly out of scope: the approval inbox (already correct), and applying scope to reads other
than documents. Other list endpoints have the same gap and deserve the same treatment, but changing
them together would make one release that quietly narrows six screens at once.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: the document list and the single-document read are filtered by the granted
  scope of `DOC_VIEW`, widened by the reader's own approval involvement.
- `rbac`: the scope contract gains the rule that a scope narrows a *default* visibility and does not
  remove access a user has by being party to the document.

## Impact

**Backend** — `document.service.ts` (`list`, `get`/`getWith`, `detail`, and the id-collecting reads
that share the entry point), `ScopeService` (unchanged, finally called), and a read of
`document_approval_step_actor` / `approval_log` to express "I am party to this".

**Configuration** — `role_permission.scope` for `DOC_VIEW` in the live company. 13 of 16 roles are
currently COMPANY, including `IT-STAFF`, which four people hold. Code alone changes nothing for
them; the grants have to move too, and that is a customer decision recorded per role rather than a
default this change invents.

**Performance** — the list gains a subquery over the two approval tables. Both are indexed by
document; the list is already paginated.

**Invariants** — company isolation is untouched and still applied first (invariant 1); scope narrows
within it. Authorization stays on permission codes (invariant 6). Nothing here writes `budget_txn`
or `quota_usage`, and `approval_log` is read, never written.

**Risk** — this narrows what people see. Anyone relying on the accidental company-wide visibility
loses it the moment it ships, which is the point, but it is why the grant table is settled with the
customer before the code lands rather than after.
