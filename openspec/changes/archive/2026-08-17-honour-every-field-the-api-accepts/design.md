# Design

## D1. The bug is `getReference`, and it is a pattern rather than a line

Every hole in the configuration surface has the same shape:

```ts
em.getReference(Workflow, dto.workflowId)   // a foreign key, written without reading the row
em.getReference(Role,     dto.approverRoleId)
em.getReference(AppUser,  dto.approverUserId)
```

`getReference` produces a proxy carrying only an id. Nothing is loaded, so MikroORM's company
filter — the mechanism invariant 1 relies on — is never consulted, because a filter applies to
queries and this issues none. The insert succeeds against any row that exists anywhere.

The fix is not "add a check to `addStep`". It is a rule with one exception:

> **Any id that arrives in a DTO and becomes a foreign key SHALL be resolved with a query scoped to
> the active company, and SHALL NOT be turned into a reference.** The only ids that may be
> referenced are ones this request already resolved.

Applied to the three call sites:

| site | today | after |
| --- | --- | --- |
| `addStep` → workflow | `getReference` | `findOne(Workflow, { id })`, company compared, else 404 |
| `addStep` / `updateStep` → role | `getReference` | `findOne(Role, { id })`, company compared, else 400 naming the field |
| `addStep` / `updateStep` → user | `getReference` | resolved as a member of this company, else 400 naming the field |

**404 for the workflow, 400 for the targets.** The workflow is the addressed resource: a caller who
names one they cannot see is told it does not exist, matching `updateStep`'s existing behaviour and
leaking nothing about another company's ids. The role and the user are *arguments* to an operation on
a resource the caller does own, so the honest answer is that the argument is wrong — and the message
names which one, the same way `amountMin must not exceed amountMax` names its field.

**Which query decides a user "belongs" here.** A user is company-scoped only through
`user_company_role`, so the check is that the target holds at least one role in the active company.
That is the same relation `ApproverResolverService.principals` reads when it resolves who may act,
so a step can never be configured with a principal the resolver would refuse to produce.

## D2. `addStep` gets the in-flight guard, and the guard is deleted two changes later

`assertNoInFlight` exists because routing reads the live step set. Adding a step changes that set
exactly as editing one does:

```
D is on step 20 of 10 → 20 → 30
  insert 15  →  advance() looks for the next step AFTER 20; 15 is never reached
  insert 25  →  D must clear a step that did not exist when it was submitted
```

So `addStep` calls the same guard as its siblings. Note plainly that this is temporary:
`lock-the-route-at-submit` materialises the route and then **removes the rule entirely** from all
three operations, because a document that no longer reads configuration cannot be disturbed by an
edit to it.

Writing a guard now and deleting it later is deliberate, not waste. Until the route is materialised
the hazard is live, and the alternative — leave the hole open because a bigger change is coming —
bets that the bigger change lands before someone adds a step. The deletion is three call sites and
one private method.

## D3. The audit row is written before the action is understood

```
approval-routing.service.ts:235   persist(ApprovalLog {...})
                          :247   flush()                       ← the row is in the database
                          :253   switch (dto.action) { ... }   ← only now is it interpreted
```

Narrowing the DTO removes today's instance of the problem. It does not remove the problem: any value
the switch does not handle still becomes a history row, so the next value added to `ApproveAction`
inherits the defect silently.

Two layers, both cheap:

1. **The DTO admits only human actions.** A `HumanAction` union — `APPROVE | REJECT | RETURN` —
   validated with `@IsIn`, so the transport layer refuses `ESCALATE` (and anything else) before the
   service is entered. `ESCALATE` stays in `ApproveAction` because `SlaService` writes it.
2. **The switch becomes total.** `act()` switches over the narrowed type with an exhaustive
   `default: assertNever(action)`. A value added to the union without a branch fails the build
   rather than reaching production as an unexplained log row.

Moving the `persist` below the switch would be a third layer and is deliberately **not** taken: the
row must exist before `stepComplete` counts approvals (`flush()` at 247 is what makes the current
approval visible to that count), and reordering that is a routing change inside a change about
refusing bad input. The two layers above close the hole without touching the sequence.

## D4. `DELEGATE` is deleted, not deprecated

Grep says the value is written by nothing:

```
enums/index.ts:89                        the declaration
approval-routing.service.ts:264          case DELEGATE: break;      ← the only consumer, a no-op
Migration20260629000000.ts               the check constraint listing it
front-end .../documents.ts:194           a history label for rows that cannot exist
```

Nothing has launched and `approval_log` holds no rows, so there is no history to keep readable. The
value goes from the enum, the DBML, the check constraint (a new migration re-states
`approval_log_action_check` without it) and the three locale files.

Delegation as a *capability* is untouched: `approval_delegation` keeps its date range, document-type
scope and amount limit, and `ApproverResolverService` keeps resolving delegates one hop. What is
removed is a verb that claimed to do the same job and moved nothing.

**Why not implement per-item forwarding here instead?** Because it needs somewhere to record "this
document's step 2 now belongs to Y" — and while the route is read live from `workflow_step`, the only
places to put that are the document row or a new table. The new table is
`document_approval_step`, one change away. Implementing forwarding now means building it twice.

## D5. `workflow.condition_json` is dropped, and what it would take to bring it back

The column is read nowhere. `DeptDocTypeService.resolve(departmentId, documentTypeId)` returns the
single mapped workflow, and only `workflow_step.condition_json` reaches `stepEngagesFor`. Removal
therefore touches surface, not behaviour:

```
erp_approval_system.dbml            the column on Table workflow
approval.entities.ts:19             the entity field
dto/workflow.dto.ts                 Create/UpdateWorkflowDto
workflow-config.service.ts:33,44,97 create, list projection, update
front-end                           the workflow editor inputs + detail-view summary
openspec/specs/web-doc-config       the two sentences promising it
migration                           drop column
```

A real workflow-selection rule is a bigger thing than a column, and naming what it needs is the
argument for not resurrecting this one casually: several workflows mapped to one
(department, document type); a precedence order when two conditions both match; a defined answer
when none matches; and a way for a reader to see *which* workflow a given document was bound to and
why. None of that exists, and `workflow_step`'s amount bands and level conditions already express
every rule the dead column advertised — inside the single workflow that routing actually binds.

## D6. Transactions, locking, and the race this change accepts

**This change writes no `budget_txn` and no `quota_usage` row, and touches no path that does.** It
edits `workflow` / `workflow_step` configuration and narrows one DTO; budget and quota are reached
only by submit, approve, reject and cancel, none of which are modified here. There is consequently
no reserve/actual/release sequence to state and no `SELECT FOR UPDATE` to place for them.

The one concurrency question that is real: `addStep` must do its checks and its insert in **one**
`em.transactional(...)`, as `updateStep` and `deleteStep` already do — resolve the workflow in the
active company, resolve the targets, `assertNoInFlight`, then create.

That still leaves a narrow race: a document may be submitted between the count and the commit, so a
step can land on a workflow that acquired an in-flight document microseconds earlier. Closing it
would mean locking every candidate document, or locking the workflow row and having submit take the
same lock — pushing a configuration concern into the hot path of every submit.

We accept the race, for a reason that is temporary and stated: the window is milliseconds, the
consequence is one document routing through one unexpected step, and `lock-the-route-at-submit`
removes the guard and with it the race — a materialised route makes a concurrent submit and a
concurrent edit genuinely independent. Buying a lock for a rule that is about to be deleted would be
the wrong trade.

## D7. What this leaves for later

| left out | why | where it goes |
| --- | --- | --- |
| removing `assertNoInFlight` | needs the route snapshot first | `lock-the-route-at-submit` |
| per-item forwarding / reassign | needs a row per step to record the assignee | after `lock-the-route-at-submit` |
| escalation that does not skip a step | separate defect, separate argument | `escalate-to-someone-not-past-them` |
| a `CANCEL` action in the log | separate defect | `say-who-withdrew-the-document` |
| rule-based workflow selection | needs precedence, tie-break and visibility | its own change, if ever wanted |

## Risks / trade-offs

- **A tightened `addStep` breaks a caller that was relying on the looseness.** → Nothing has
  launched; the only client is the workflow editor, which always posts ids from the active company's
  own lists. The frontend needs no change, and the new 400s surface through the same error path the
  editor already renders for `amountMin must not exceed amountMax`.
- **`addStep` starts refusing while documents are in flight, which will surprise an administrator.**
  → It is the same refusal `updateStep` already gives, with the same message shape, and it is short
  lived: the next change removes the rule for all three operations rather than extending it.
- **Dropping `workflow.condition_json` loses whatever an administrator typed there.** → It decided
  nothing, so nothing behavioural is lost; and no instance has launched, so no administrator has
  typed anything. The step-level conditions that do route are untouched.
- **Narrowing the DTO could reject a legitimate future action.** → The union is the extension point:
  adding an action means adding it to `HumanAction` *and* to the switch, which the exhaustiveness
  check enforces. That is the intended cost.
