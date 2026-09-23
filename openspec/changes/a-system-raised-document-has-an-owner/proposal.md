## Why

A document the system raises has no owner who can act on it.

When a `CREATE_SUCCESSOR` pairing sends its successor to another department, the sweeper builds a
request context from the obligation: `userId` is the PREDECESSOR's requester, `departmentId` is the
pairing's successor department. `createFrom` then writes a document whose `created_by` is a person in
department A and whose `department` is B. Attributing it to the approver instead would bar that
approver from the successor under invariant 8, so the choice is deliberate — but nothing else was
adjusted around it, and the two halves of "who may act" now point at different people:

- **Withdrawal** is restricted to `created_by` — a person in department A.
- **Visibility** is decided by scope, which reads `department` — department B.

So the only person permitted to withdraw the document usually cannot see it, and the department that
owns the work can see it but has no way to withdraw it. Nobody holds both.

This is not hypothetical. `PO-01-HAL-2026-0023` on the live system was raised this way: Poupay
raised the PR, the sweep created the PO into procurement, and Poupay — at DEPARTMENT scope — cannot
find it. Thidaphet, in procurement, opens it fine and is offered no withdraw button. The same shape
produced six duplicate draft POs against two PRs in eighteen minutes, and clearing them to let a
migration through took two failed deploys and a person from each department.

The visibility half has a second, simpler face: "I raised it" is not among the sources that keep a
document reachable. `typeGateWhere` already carries a `created_by` exemption for exactly this reason
("a budget officer who lost `BUDGET_VIEW` must still see the plans they wrote"); the party rule does
not, so a requester loses their own document the moment its department is not theirs.

## What Changes

- **BREAKING (authorization).** Withdrawal stops being "only the creator" and becomes `DOC_CANCEL`
  applied at the holder's granted scope, the way every other document act is authorized. `OWN` keeps
  today's behaviour exactly — only your own documents. `DEPARTMENT` lets the department that owns the
  document withdraw it. `COMPANY` covers the company. No new column, no new permission code, and no
  way to reach a document the grant does not already cover.
- A document SHALL stay visible to the user recorded as its `created_by`, whatever their scope — a
  third source beside the two the party rule already names.
- The detail screen offers the withdraw button on the same predicate the server enforces, so a
  control the server will refuse is not shown and one it will accept is not hidden.
- The status rule is untouched: `DRAFT`, `SUBMITTED`, `IN_APPROVAL` only. So is everything a
  withdrawal does — the `CANCEL` row, the released holds, the `document.cancelled` event.

Deliberately NOT in scope: marking system-raised documents apart from hand-raised ones. There is no
such marker today (`source_type`/`source_id` are the external-feed pair, and `pending_successor` does
not record the document it created), adding one would need a migration and would still leave every
existing document unmarked — and the scope answer makes the distinction unnecessary, because the
department that owns a document should be able to withdraw it however it got there.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `document-engine`: *Withdrawing A Document Is Recorded As An Act* changes who may withdraw, from
  the creator to the holder of `DOC_CANCEL` within scope. *A Reader Never Loses The Documents They
  Are Party To* gains the creator as a third source.
- `web-documents`: *Submit and Cancel* states that the withdraw affordance follows the server's scope
  rule rather than creator identity.

## Impact

- **Invariants.** Invariant 1 holds: scope is applied within the active company and the document read
  is already company-scoped. Invariant 5 is untouched — withdrawal still releases every budget and
  quota hold, and this changes only who may ask. Invariant 2 is untouched: the `CANCEL` row is still
  appended, now naming whoever acted. Invariant 8 is unaffected; withdrawal is not approval.
- **Backend.** `DocumentSubmitService.cancel` replaces its `created_by` comparison with the scope
  predicate; `DocumentService.visibleWhere` adds `created_by` to the party half.
- **Frontend.** `canCancel` in `DocumentDetailView` stops comparing the creator to the signed-in user
  and reads the server's answer instead.
- **Data.** No migration. No column added, removed or backfilled.
- **Risk.** A `DEPARTMENT`-scope holder of `DOC_CANCEL` can withdraw a colleague's draft, which they
  could not before. That is the point of the change, and it is bounded by the grant: a company that
  wants the old rule grants `DOC_CANCEL` at `OWN`. Worth naming in the release note so the
  administrators who set the scopes know the code now means what it says.
