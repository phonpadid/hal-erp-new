## Context

`ScopeService.scopeWhere(code, { ownerField, deptField })` already returns the row filter for a
granted scope: `{ createdBy: me }` for OWN, `{ department: myDept }` for DEPARTMENT, `{}` for
COMPANY and GROUP. It is complete, unit-tested, and unused.

`DocumentService.list` paginates `Document` through `this.scope.forActiveCompany()`, which applies
the company filter, plus `buildDocumentFilter(q)` for the user's own search terms. Nothing else
narrows it. `get`/`getWith` and `detail` resolve a document the same way — company only.

The approval inbox does NOT go through `DOC_VIEW`. `ApprovalInboxService.pending` reads
`IN_APPROVAL` documents in the company and keeps the ones the caller is eligible to act on, decided
per-document by `ApproverResolverService`. So narrowing `DOC_VIEW` cannot empty an approver's queue
— but it can, and would, make the document that queue links to unreadable.

Live grants: 13 of 16 roles hold `DOC_VIEW` at COMPANY, including `IT-STAFF` (4 holders) and
`ADM-STAFF` (2, at DEPARTMENT). The three departments the customer says every document passes
through are `BG`, `FN`, `AC`.

## Goals / Non-Goals

**Goals:**

- The document list obeys the scope its permission was granted at, as `rbac` already requires.
- A user never loses sight of a document they are party to — one they raised, or one that reached
  them for approval.
- The list and the single-document read agree, so nothing is visible in one and not the other in
  either direction.

**Non-Goals:**

- Changing the approval inbox. It resolves eligibility on its own and is already right.
- Scoping other list endpoints in this change. The same gap exists elsewhere and deserves the same
  fix, separately, so one release does not silently narrow six screens at once.
- Inventing the per-role grant table. Which role sees how much is the customer's decision; this
  change carries the values they confirmed and nothing more.

## Decisions

### Visibility is a union: granted scope OR party to the document

```
visible(doc) = scopeWhere('DOC_VIEW', { ownerField: 'createdBy', deptField: 'department' })
             OR  doc has an approval_log row by me
             OR  doc has a live approval step whose recorded actors include me
```

*Why the union rather than scope alone:* an approver's business is documents raised by other people
in other departments — that is what approving IS. A pure scope filter makes the correct
configuration (a department head at DEPARTMENT scope) unable to open the disbursement they are
being asked to sign. The alternative, granting every approver COMPANY scope, hands them the whole
company to fix a problem about five documents, which is the state being repaired.

*Why those two tables:* `approval_log` records what a person actually did — it is append-only, so a
document I approved stays visible forever, which is what "documents I approved" has to mean.
`document_approval_step_actor` records the principals captured when a step opened, so a document
sitting in my queue right now is visible before I have acted on it. Together they cover "reached me"
and "was acted on by me" without needing to re-resolve role membership at read time.

*Alternatives considered:*

- **Re-resolve eligibility per row, as the inbox does.** Rejected for the list: the inbox can afford
  a per-document resolve because it reads only `IN_APPROVAL` documents, and it already costs a query
  per row. The document list spans every status and is paginated over the whole history.
- **A denormalised `document_participant` table.** Rejected as premature: it would need maintaining
  from three write paths and the two existing tables already carry the fact.
- **Scope the list but leave the detail read company-wide.** Rejected: it makes the list a
  suggestion. Anyone could read any document by id, and the id is in every URL they have ever been
  sent.

### The same predicate governs the single read

`get`, `getWith` and `detail` apply the union too. A document the list shows can always be opened,
and one it hides answers not-found rather than existing quietly behind a guessable id.

*Consequence, accepted deliberately:* a not-found for an out-of-scope document is indistinguishable
from a not-found for a document that does not exist. That is the correct answer to give — telling
the caller "this exists but is not yours" is itself a disclosure.

### Mutations keep their existing guards

Submit, cancel, edit and the approve path are unchanged. They already resolve documents their own
way — `ApprovalRoutingService.act` reads with the company filter off and decides on eligibility —
and this change is about who may READ. Narrowing a read must not become an accidental second
authorization rule on writes.

### The unit of separation is the department, not the person

Every role that raises documents — staff and department head alike — is granted DEPARTMENT. The
customer's words for it: a department's documents must not be mixed with another department's,
because that is what makes the list confusing. Within a department, colleagues seeing each other's
work is normal and useful; across departments it is noise at best.

That leaves OWN granted to nobody today. It stays in the scope model and in these specs because it
is part of the contract and a company may want it, but the visibility a person actually needs
day-to-day — "just the ones I raised" — is better served by a FILTER than by a grant. A filter is
the reader's choice, reversible in one click; a scope is an administrator's decision that the reader
cannot undo when they need the wider view.

### "Only mine" is a filter, not a scope

The document list gains a `mine` filter that narrows to documents the caller created, combining
conjunctively with every other filter and applied INSIDE the visibility predicate.

*Why a filter:* the two questions are different. "What am I allowed to see" is settled by an
administrator and must not be bypassable. "What do I want to look at right now" belongs to the
person reading, changes several times an hour, and must be. Implementing the second as a scope grant
would answer the first question wrongly — a requester would lose the department view they need to
avoid raising a duplicate request.

*Why inside the predicate rather than replacing it:* a filter narrows; it never widens. `mine=true`
for a reader who may see the whole company still returns only their own documents, and `mine=false`
never shows them anything the predicate would have hidden.

### Grants are data, and they are the customer's

The scope values below are what the customer confirmed, applied as a one-off configuration step and
recorded here so the intent is auditable rather than buried in a UPDATE:

| Role | Holders | Now | After | Why |
|---|---|---|---|---|
| `IT-STAFF` | 4 | COMPANY | **DEPARTMENT** | a department's work is the department's |
| `ADM-STAFF` | 2 | DEPARTMENT | DEPARTMENT | already right |
| `HEAD-IT` | 1 | DEPARTMENT | DEPARTMENT | department head |
| `DEPT_HEAD` | 1 | COMPANY | **DEPARTMENT** | department head |
| `BG-STAFF`, `BUDGET_OFFICER` | 1, 1 | COMPANY | COMPANY | every document passes budget |
| `FN-STAFF`, `FINANCE_HEAD` | 1, 1 | COMPANY | COMPANY | every document passes finance |
| `AC-STAFF`, `ACCOUNTING_HEAD` | 1, 1 | COMPANY | COMPANY | every document passes accounting |
| `PRESIDENT`, `ADMIN` | 1, 1 | COMPANY | COMPANY | company-wide by office |
| `REQUESTER` | 0 | DEPARTMENT | DEPARTMENT | the template for a requester |
| `APPROVER`, `ACCOUNTING`, `FINANCE` | 0 | COMPANY | COMPANY | unheld; left as they are |

## Risks / Trade-offs

- **People lose visibility the moment it ships.** That is the intent, but somebody who has been
  using the documents list as a company-wide search will experience it as a regression. → The grant
  table above is settled with the customer first, and the three departments that genuinely need
  everything keep it.
- **A subquery on every list page.** → Both approval tables are indexed by document, the list is
  paginated, and COMPANY-scope readers — who have the largest result sets — skip the union entirely
  because their scope filter is already empty.
- **`document_approval_step_actor` is only populated when a step opens.** A document whose route has
  not yet reached me is not visible to me, which is correct, and a document approved before
  `Migration20260828000000` has no actor rows at all — but it does have `approval_log` rows, which
  is why the union reads both.
- **Reports and exports read documents by other paths.** → Out of scope here and listed as such;
  they are a separate pass, and leaving them company-wide is no worse than today.

## Migration Plan

No schema change. Deploy backend, then apply the grant updates as one transaction, keyed by role
code and company code so it is safe to re-run. Reverting is the same statement with the previous
values, which are recorded in the table above.

Order matters only in that applying the grants BEFORE the code changes nothing, and applying the
code before the grants narrows nobody — `IT-STAFF` stays COMPANY until its row is updated. Either
order is safe; grants last is the one that lets the change be verified per role.

## Sequence and transaction notes

This change writes no `budget_txn` and no `quota_usage`, and reads `approval_log` without writing to
it. There is no transaction boundary to define: every path added here is a read.

## Open Questions

- Should a document a user only ever *rejected* or *returned* stay visible to them? It does under
  this design, because `approval_log` records the action whatever it was. That seems right — you
  should be able to find the thing you refused — but it is worth confirming with the customer.
- The same gap exists on other list endpoints. Which ones matter enough to narrow next is a
  question for the customer, not a default this change should pick.
