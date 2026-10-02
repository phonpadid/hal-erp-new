## Context

Two rules decide what a person can do with a document, and they were written against different
fields.

`DocumentSubmitService.cancel` compares `doc.createdBy.id` with the acting user and refuses anything
else. `DOC_CANCEL` gates the route, but its scope has never narrowed anything — the creator check did
all the narrowing, so a grant at `OWN`, `DEPARTMENT` or `COMPANY` behaved identically.

`DocumentService.visibleWhere` is the other rule: `scopeWhere(DOC_VIEW, { ownerField: 'createdBy',
deptField: 'department' })` ANDed with the type gate, ORed with a list of party ids. The party list
has four sources — acted, named on a live step, escalated to, delegated to. Being the creator is not
one of them; `createdBy` only reaches the query through `scopeWhere`, and only when the grant is
`OWN`.

For a hand-raised document those two rules agree by accident: the creator is in the document's own
department, so scope and creator point at the same person. For a document the `CREATE_SUCCESSOR`
sweep raises they do not. `SuccessorSweeperService` runs with no ambient request and builds one from
the obligation:

    const store = {
      userId: row.sourceDocument.createdBy?.id,   // the PREDECESSOR's requester
      companyId: row.company.id,
      departmentId: row.department.id,            // the pairing's successor department
      grants: [],
    };

`createFrom` → `createDraft` writes `created_by` from `userId` and `department` from `departmentId`,
so the document is owned, on paper, by someone in a department it does not belong to. The comment
explains why the approver was not used — invariant 8 would then bar them from approving the successor
— and that reasoning holds. What was missed is that every rule keyed on `created_by` now points at
the wrong person.

This design writes no `budget_txn` and no `quota_usage` row and adds no lock. Withdrawal already
releases holds through `releaseDocumentHolds`, inside the transaction boundary it has today; this
change alters only who is permitted to ask for it, never what happens once they do.

## Goals / Non-Goals

**Goals:**

- The department that owns a document can withdraw it, however the document came to exist.
- A person can always see the documents they are recorded as having raised.
- The withdraw button appears exactly when the server would accept the withdrawal.
- `DOC_CANCEL`'s scope means what the same scope means everywhere else in the system.

**Non-Goals:**

- Distinguishing system-raised from hand-raised documents. No marker exists, adding one needs a
  migration, and every document already written would be unmarked.
- Changing which statuses may be withdrawn, or anything a withdrawal does once accepted.
- Changing who the sweeper attributes a successor to. `created_by` stays the predecessor's requester;
  this change makes that attribution harmless rather than replacing it.
- Letting an approver stop a document. Reject and return are their instruments and are untouched.

## Decisions

### Withdrawal is authorized by scope, not by identity

`cancel` replaces `doc.createdBy.id !== userId` with the predicate `scopeWhere` already builds for
`DOC_CANCEL`, evaluated against the document it just locked:

- `OWN` → `created_by` is me. **Identical to today's behaviour.**
- `DEPARTMENT` → the document's `department` is one of mine.
- `COMPANY` / `GROUP` → any document in the company (the read is already company-scoped, so `GROUP`
  cannot cross the boundary here).

*Why scope rather than "creator OR the document's department":* the second is a special case bolted
beside the first, and it answers "who may act on this document" in a way nothing else in the system
does. Scope is the answer the rest of the system already gives, it is configurable per company
without code, and it makes the `DOC_CANCEL` grant's scope column stop being decorative. A company
that wants today's exact rule sets `OWN` — the migration path is a configuration choice, not a code
branch.

*Company isolation becomes this method's own job.* `cancel` reads its row with the company filter
OFF — it needs the lock and the not-found message — and that was safe only because the creator check
confined it: a creator is in their own document's company. `COMPANY` scope answers yes
unconditionally, so without an explicit check a holder in company A could withdraw company B's
document. `cancel` therefore compares the loaded document's company with the active one and answers
not-found, never forbidden, so a cross-company id is not confirmed to exist. This was found by the
test written for it, not by reading the diff — the design as first written assumed the read was
already company-scoped, and it was not.

*Consequence worth stating plainly:* a `DEPARTMENT`-scope holder can now withdraw a colleague's
draft. That is a real widening, and it is the point — it is what lets procurement withdraw the PO the
sweep put in their queue. It is bounded by the grant, and the fail-safe direction is preserved:
`scopeFor` collapses an ungranted code to `OWN`, which is the narrowest rule, not the widest.

*Alternative considered:* leaving withdrawal alone and having the sweeper attribute successors to a
service account. Rejected — it makes the document withdrawable by nobody rather than by the wrong
person, and a service account cannot sign in to use the screen.

### The creator is a third party source

`visibleWhere` gains `{ createdBy: userId }` to the OR beside the party ids. It is a `where`
fragment rather than another id list: the party sources each need a query to resolve, and this one
does not.

*Why it belongs in the party half and not in scope:* scope answers "which documents may I browse",
and widening it would change list results for everyone. The party half exists precisely for
documents a reader must reach despite their scope, which is this case exactly. It widens reading
only — it grants no action, and the company filter still applies.

This also fixes a case that has nothing to do with the sweeper: a requester moved between departments
loses every document they raised in the old one.

### The client asks the server rather than recomputing the rule

`canCancel` in `DocumentDetailView` compares `creatorId(doc.createdBy)` with `auth.userId` today —
a rule the client can only evaluate correctly while the rule is about identity. Scope lives on the
server, so the client stops deriving it and reads a flag the detail already has a place for, beside
`canAct`.

*Why not evaluate scope client-side:* the client would need the grant's scope and the user's
department set, and would have to re-implement `scopeWhere`'s fail-safe. Two implementations of an
authorization rule drift, and the one that drifts silently is the client's — it shows a button that
404s, or hides one that would have worked. The server already computes this to decide whether to
accept the call; returning it costs nothing.

## Risks / Trade-offs

- **A wider withdrawal right lands without anyone asking for it.** → It follows the `DOC_CANCEL`
  grants that already exist, and most are likely `DEPARTMENT` because that is the column default.
  Administrators must be told, in the release note, that the scope they set now governs withdrawal;
  `OWN` restores the previous rule exactly.
- **Someone withdraws a document they did not raise and the author is surprised.** → The `CANCEL`
  row names who acted and carries their remark, and `document.cancelled` already notifies. The audit
  answer was in place before this change; what changes is that the row can now name someone other
  than the author.
- **The creator-visibility rule widens reads.** → Only to documents that already record that person
  as their creator. It cannot reach another company, and it grants no action — stated in the
  requirement so a later reader does not mistake it for authority.
- **A client that has not been redeployed keeps the old button rule.** → It under-offers rather than
  over-offers: the old rule is strictly narrower than the new one, so the stale client hides a button
  that would have worked and shows none that would fail. Safe in the deployment order this repo uses
  (backend and frontend ship together).

## Migration Plan

No migration and no data change. Backend and frontend ship together, as they always do here.

Rollback is a revert of both sides: withdrawal narrows back to the creator and the creator-visibility
source disappears. Nothing written while the change was live becomes invalid — a `CANCEL` row naming
a non-creator stays a valid, readable record of who withdrew the document.

Before release, check what scope `DOC_CANCEL` actually carries in the live role configuration, and
say so in the release note. That is a read, not a step: the change is correct at any scope, but
administrators should not discover the new meaning from behaviour.

## Open Questions

- Should the pairing configuration also record WHO a system-raised successor is attributed to, rather
  than always the predecessor's requester? Scope makes the question non-urgent, but "the person who
  raised the PR" is still a fiction on a PO they never touched. Out of scope here.
