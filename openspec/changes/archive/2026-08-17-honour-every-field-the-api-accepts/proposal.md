# Honour every field the API accepts

## Why

The approval module accepts five things it does not act on. Each one is small. Together they mean
an administrator, an approver and an auditor can all be told something by this system that is not
true.

**A step can be added to another company's workflow.**

```ts
// workflow-config.service.ts:70 — addStep()
const step = this.em.create(WorkflowStep, {
  workflow:     this.em.getReference(Workflow, dto.workflowId),        // never loaded
  approverRole: dto.approverRoleId ? this.em.getReference(Role, dto.approverRoleId) : undefined,
  approverUser: dto.approverUserId ? this.em.getReference(AppUser, dto.approverUserId) : undefined,
```

`getReference` writes a foreign key without reading the row, so no company filter is ever
consulted. A `WORKFLOW_MANAGE` holder in company A who knows company B's workflow id inserts an
approval step into B's routing — and may point it at a role of A, leaving B's document waiting on
an approver B has never heard of. Its two siblings load the *step* and compare `company_id` before
touching it; the operation that creates one checks nothing at all (invariant 1).

The approver half of that hole is not `addStep`'s alone: `updateStep` verifies the step it is
editing and then assigns `approver_role_id` / `approver_user_id` through the same unchecked
`getReference`. Both operations can point a step at a principal from another company.

**The same operation ignores the rule its siblings enforce.** `updateStep` and `deleteStep` refuse
while the workflow has a `SUBMITTED` or `IN_APPROVAL` document, "since routing reads the live step
set" — `assertNoInFlight`. `addStep` does not call it, and routing reads the live step set for
additions exactly as it does for edits:

```
document D is on step 20 of a 10 → 20 → 30 route
  add step 15  →  D never sees it: advance() takes the next step AFTER the current one
  add step 25  →  D must now clear a step that did not exist when it was submitted
```

**An approver can write an SLA breach that never happened.** `ActDto` validates with
`@IsEnum(ApproveAction)`, which admits all five values. `act()` persists the audit row
(`approval-routing.service.ts:235`) *before* it switches on the action (line 253), and the switch
has no `ESCALATE` branch — so the value falls through having already been written. The result is a
row in the append-only trail that reads *Escalated (SLA)*, on a document whose SLA never elapsed,
authored by the approver who did not want to approve it. `approval_log` is the record every other
capability defers to; it is the wrong table to leave writable with a system verb.

**`DELEGATE` does nothing at all.** `case ApproveAction.DELEGATE: break; // recorded; reassignment
is handled by resolution` — but resolution reads `approval_delegation`, and this action writes no
such row. Nothing else in the codebase writes the value. An approver who chooses it sees success,
and the document sits exactly where it was, still waiting on them.

**The workflow's selection condition decides nothing.** `workflow.condition_json` is stored,
editable, and specified in `web-doc-config`: *"The workflow editor SHALL let the user express the
workflow's selection condition by amount band and position level"*, with the detail view showing it
"as a readable summary". Routing binds the workflow through the `dept_doc_type` mapping alone, and
evaluates only `workflow_step.condition_json`. An administrator can author a selection rule, see it
summarised back, and route nothing by it.

Configuration nothing reads is worse than configuration that does not exist, because it is
believed.

## What Changes

**Adding a step obeys the rules its siblings obey.** `addStep` resolves the workflow within the
active company and refuses one belonging to another; resolves `approver_role_id` and
`approver_user_id` in the same company and refuses a target from outside it; and calls
`assertNoInFlight` like `updateStep` and `deleteStep`. Three operations on one resource stop having
three different answers to "may I?".

**The action endpoint accepts only what a person can do.** `ActDto` narrows to `APPROVE`, `REJECT`
and `RETURN`. `ESCALATE` remains in the enum as a value the SLA sweep writes and nobody posts —
system-only, enforced by the DTO rather than by hoping the switch is read carefully.

**`DELEGATE` is removed rather than implemented here.** No caller writes it, no state changes when
it is chosen, and delegation already exists as `approval_delegation` — a record with a date range,
a document-type scope and an amount limit, which this action has none of. The value goes from the
enum, the DBML, the `approval_log` check constraint and the history labels. Per-item forwarding is
a real feature and a different one: it belongs on a materialised route, and is named in
`lock-the-route-at-submit` as the follow-up it enables.

**`workflow.condition_json` is dropped.** The column, the entity field, the DTOs, the config
service, the workflow editor's condition inputs, the detail view's summary and the `web-doc-config`
sentences that promise it. Everything it claimed to express — amount band and position level — is
already expressed by `workflow_step.amount_min` / `amount_max` and `workflow_step.condition_json`,
which routing actually reads and which the step editor already authors in full.

Nothing has launched, so the column is dropped rather than deprecated.

## Who this answers

| party | what they were told | after |
| --- | --- | --- |
| administrator | "this workflow is selected when …" | the only conditions shown are the ones that route |
| administrator | a step may be added at any time | the same in-flight rule as editing one, stated once |
| approver | "Delegate" is one of your choices | the choices offered are the ones that do something |
| auditor | this row says the system escalated it | only the system can write that row |
| a second company | — | its routing cannot be written from outside it |

## What This Change Does NOT Do

- **Does not change escalation.** That a deadline currently removes a required approval is a
  separate defect with a separate fix — `escalate-to-someone-not-past-them`.
- **Does not materialise the route.** The in-flight guard is enforced here rather than removed;
  removing it correctly needs the route snapshot in `lock-the-route-at-submit`, after which
  configuration can be edited freely because it no longer reaches documents already routing.
- **Does not add rule-based workflow selection.** It removes the half of it that was never built.
  If one mapping should ever choose between several workflows, that needs precedence rules, a
  tie-break and a way to see which workflow a document got — its own change, not a revived column.
- **Does not add per-item forwarding.** Removing a verb that moves nothing is not the same as
  deciding never to have one.
