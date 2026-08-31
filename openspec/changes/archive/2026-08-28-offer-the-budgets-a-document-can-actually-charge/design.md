## Context

Two independent questions were being answered by one department filter.

```
┌─ who may act for whom ────────────────┐  ┌─ which budgets are shared ────────────┐
│ a property of the USER                │  │ a property of the BUDGET              │
│ LATTANAPHONE keys spend for the whole │  │ marketing pays its phone bill out of  │
│ company; an ordinary employee does    │  │ 1.406, which ບໍລິຫານ holds            │
│ not                                   │  │                                       │
│ mechanism: Scope — EXISTS, configured │  │ mechanism: none — must be added       │
└───────────────────────────────────────┘  └───────────────────────────────────────┘
                    │                                       │
                    └───────────► listSelectable ◄──────────┘
```

Neither can substitute for the other. Granting an employee `COMPANY` scope so they can charge a
shared budget would also let them charge every department's private money. Marking everything shared
so the budget officer can key history would remove the distinction entirely.

What exists today:

- `Scope` (`OWN` / `DEPARTMENT` / `COMPANY` / `GROUP`) and `ScopeService.scopeWhere`, which returns
  `{ [deptField]: RequestContext.departmentId() }` for `DEPARTMENT` and `{}` for `COMPANY`. Used by
  other reads; not by `listSelectable`.
- `BudgetNode`: `fiscalYear`, `code`, `name`, `parent`. No department, deliberately. Scoped per
  fiscal year.
- The prefix walk `budget-control` already performs for control points — *"whose `budgetNode` is
  that budget's own node or an ancestor of it"* — which is the same tree question this change asks.
- A tree view of the plan on the budget list (`listMode === 'tree'`, fed by `loadTree()`).

## Goals / Non-Goals

**Goals:**

- A requester is offered exactly the budgets their document may charge — no more, and no fewer.
- Who may act across departments is decided by the scope they were granted, in one place.
- Which budgets are shared is stated in the data, not carried in people's heads.
- A requester can tell a shared budget from their department's own before they charge it.

**Non-Goals:**

- Ceilings per department on a shared budget. See the proposal; it needs the control point to gain a
  spender dimension it does not have.
- Deciding whose spend a shared charge is, for reporting.
- Fixing the plan roots that are not departments.
- Carrying the mark across fiscal years automatically. `budget_node` is per year by design, so next
  year's import mints new nodes and the marks do not follow. Stated as an open question below rather
  than solved quietly, because the wrong automatic answer is worse than a known manual step.

## Decisions

### The read asks the caller's scope; it stops taking a department from the client

`listSelectable` resolves `scopeFor('DOC_CREATE')` and narrows accordingly. The client stops sending
`auth.departmentId`.

The department parameter stays on the read, because a `COMPANY`-scope caller filtering the list *to*
a department is a real thing to want and the budget list already offers exactly that. It becomes
what it should always have been: a filter the caller may apply, never the authorization.

*Alternative considered — leave the client sending its own department.* That is the defect. A client
deciding what it may see is not a scope; the server was trusting a value the browser chose.

*Alternative considered — a new permission code for "may charge any department's budget".* Rejected:
`DOC_CREATE @ COMPANY` already says it, is already granted, and a second code would let the two
disagree about the same user.

### Shared is a mark on the NODE, and it is inherited by the subtree

A node may be marked as carrying shared budget. A budget is shared when its node is marked or any
ancestor of its node is marked.

The customer's plan groups shared money already — `1.100 ຄ່າບໍລິຫານ ທົວໄປ` and
`1.400 ລາຍຈ່າຍປະຈຳເດືອນ` between them hold the office supplies, the security guards, the phone bills
and the cleaning contract. Marking two nodes covers all of it. A flag on each budget would mean
ticking those lines one by one and re-ticking every line added later.

Inheritance is the same walk control points already perform, so the tree question has one answer in
the codebase rather than two.

*Alternative considered — `is_shared` on `budget` itself.* Rejected above: same information, far
more places to set it and to forget it.

*Alternative considered — a department→budgets mapping table.* Rejected: it expresses rules the
customer does not have ("marketing may charge budgets X and Y"), at the cost of configuration nobody
will maintain. Shared-versus-own is the distinction they actually draw.

### Shared widens; it never narrows

A budget offered because it is shared is offered IN ADDITION to what scope allows, never instead. So
the read returns: budgets the scope admits, UNION budgets under a marked node. A `COMPANY`-scope
caller sees everything either way; a `DEPARTMENT`-scope caller sees their own plus the shared.

Stated explicitly because the opposite reading — "shared budgets are the only ones a
non-owning department may charge" — is the same sentence heard backwards, and it would silently
remove a department's access to its own money.

### The picker says which is which

Shared budgets are grouped and labelled as shared rather than mixed in. The picker already groups by
the parent category for a reason recorded in the code — ninety budgets whose names differ by one
word — and "this is not your department's money" is a stronger distinction than the category.

### The mark is made on the plan tree

`PATCH /budgets/nodes/:id` exists and is gated on `BUDGET_MANAGE`; it gains the field. The
affordance goes on the budget list's tree view, which already renders the plan hierarchy. Not on the
document form: a requester filling in a document has no business reclassifying the plan, and the
inline node dialog there exists to add a missing line, not to govern one.

## Sequence: what writes `budget_txn`

Nothing in this change writes `budget_txn` or `quota_usage`.

Both halves are reads plus one configuration column. The only write is `PATCH /budgets/nodes/:id`
setting a boolean on a `budget_node` row — configuration, not a ledger, and `budget_node` is
correctly absent from the append-only set the `LedgerGuardSubscriber` enforces.

Reserving still happens where it always did: `BudgetLedgerService.reserve` at submit, inside the
submit transaction, under the existing pessimistic lock. This change alters which budgets a
requester can NAME, never how a named budget is reserved. No transaction boundary moves and no lock
is taken or held differently, so there is no new concurrency surface and no concurrency test is owed.

## Risks / Trade-offs

- **[A `COMPANY`-scope caller is now offered ~496 budgets]** → the volume the department narrowing
  was introduced to tame. Mitigation: the read keeps its department filter and the picker keeps its
  category grouping and its search; and the callers who get the wide list are budget officers, who
  know the plan. If it proves unusable, the answer is a department filter *in the picker*, not a
  narrowing that overrides the grant.

- **[Marking a high node marks more than intended]** → marking `1` rather than `1.100` would make
  the whole of `ບໍລິຫານ` shared. Mitigation: the tree view shows what a mark covers, and the count
  of budgets beneath it is already computed there (`budgetCount`). Making the consequence visible at
  the moment of the decision is worth more than a confirmation dialog.

- **[The marks do not survive the fiscal year]** → next year's plan import mints new nodes and every
  mark is gone, silently, at the worst possible moment. Mitigation: named as an open question, not
  designed around. Whatever is decided must be decided deliberately — carrying by code is plausible
  and wrong if the plan is restructured.

- **[Scope now decides a list a user sees]** → a mis-granted `COMPANY` shows one department's plan
  to another. Mitigation: this is what the grant already means for documents; the read carries no
  amounts, and the company filter is untouched.

## Migration Plan

One additive migration: a boolean on `budget_node`, defaulted so every existing row reads as not
shared. No backfill — which nodes are shared is the customer's statement to make, not a guess this
change should encode. Deploy backend and frontend together. Rollback is a revert plus dropping the
column; no data is lost that was not entered after the deploy.

The DBML gains the column in the same change. Its existing disagreement with the entity over
`department_id` is left as it stands and reported, not silently corrected while adding a field.

## Open Questions

- **How does a mark survive a fiscal year?** Carried by the import when a node with the same code
  existed last year, re-marked by hand each year, or something else. It cannot be answered from the
  code — it depends on how stable the customer's plan codes are between years, and this is the first
  year in the system.
- **Are the six non-department plan roots shared, or do they have owners?** `ລາຍຈ່າຍ ຄ່າຂົນສົ່ງ`,
  `ສ່ວນແບ່ງ ຕ່າງໆ`, `ສິນເຊື່ອ ຕ່າງໆ`, `ຮຸ້ນສ່ວນ`, `ພັດທະນາ HAL PAY`,
  `ໂຄງການຂົນສົ່ງ ຕ່າງແດນຕ່າງໆ`. Marking them shared would work and might be a lie.
