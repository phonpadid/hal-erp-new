# Escalate to someone, not past them

## Why

When a step misses its SLA, this system removes the step.

```ts
// sla.service.ts — escalateOverdue()
const steps = await this.steps.applicableSteps(document, tem);
const idx = steps.findIndex((s) => s.stepNo === fromStepNo);
for (let i = idx + 1; i < steps.length; i++) { ... target = steps[i]; break; }
document.currentStepNo = target.stepNo;          // the overdue step is now behind us
```

The approval that the amount band and the job-level condition said this document required is not
performed by anybody. No one rejected it, no one approved it, no one was reassigned it. The
`approval_log` records `ESCALATE` against the approver who did nothing, and the document moves on
one step lighter.

**This makes the deadline an approver.** A requester who would rather not be seen by their
department head submits, waits out `sla_hours`, and the sweep removes that head from the route. The
control that the delegation-of-authority matrix expresses — *this amount needs this level of
sign-off* — is discharged by the passage of time. It is the one thing an approval workflow exists to
prevent.

No standard system does this. SAP, Oracle AME, Coupa and ServiceNow all treat a timeout as a
question of **who**, never of **whether**: forward to a deputy, to a superior, to an
administrator's queue, or simply keep asking. The number of approvals a document needs is not a
function of how fast people read their mail.

The spec explains the current behaviour by pointing at the schema — *"the schema carries no
reporting/superior relationship, so superior-based escalation is out of scope"* — and the seam is
even left in the code (`approver-resolver.service.ts:42`, `superior()` returning null forever). That
argument justifies not escalating *upward*. It does not justify escalating *past*. Between "send it
to their manager" and "delete the step" there was a third option nobody wrote down: **say who else
may act, and if nobody was named, keep waiting and keep asking.**

A second, smaller thing rides along, because it is the same mistake in miniature:

**A delegation's date window is evaluated on the server's day.**

```ts
// approver-resolver.service.ts:25
const today = new Date().toISOString().slice(0, 10);   // UTC, wherever the box happens to be
```

`gl-journal` settled this argument for the ledger: a date is the *company's* calendar day, resolved
from `company.timezone`, never the UTC day of the instant — because a date decides which side of a
boundary a fact falls on. A delegation that runs "to the 31st" for a company in UTC+7 stops working
at 07:00 on the 31st, local. The helper the ledger uses (`localDateIn`) is already shared.

## What Changes

**A step names where it escalates.** `workflow_step` gains `escalate_to_role_id` and
`escalate_to_user_id`, the same either-or shape the approver target already has, and the resolved
value is copied onto the step instance at submit like everything else in
`lock-the-route-at-submit`. Configuration decides the escalation path, not code (invariant 7).

**Escalation reassigns within the step. It never advances past it.**

```
before                                   after
──────                                   ─────
overdue → current_step_no = next step    overdue → the same step, now also actionable by
          the step's approval is gone              its escalation target; ESCALATE logged
                                                   with who it moved from and to
```

The step stays open, its approval still has to happen, and the escalation target may now act on it.
The no-self-approval rule survives reassignment as it does today: an escalation target who is the
document's creator is not offered the step.

**A step with no escalation target is not escalated — it is chased.** The sweep keeps notifying the
overdue approver on every pass, and the document keeps waiting. A route that stalls is visible,
recoverable and honest; a route that quietly shortens itself is none of those. The existing
suppression when an active delegate exists stays as it is: someone can already act.

**Escalation is recorded as a reassignment.** The `ESCALATE` row keeps its append-only shape and its
`remark` states both ends — from whom, to whom — so the history reads as a transfer of duty rather
than as a step that evaporated. `ESCALATE` remains system-only (`honour-every-field-the-api-accepts`
takes it off the public DTO).

**Delegation windows are read on the company's day.** `startDate`/`endDate` are compared against
`localDateIn(now, company.timezone)`, the same rule the ledger uses for `entry_date`, so a
delegation covers the days the person who wrote it meant.

Nothing has launched, so the two columns are added outright.

## Who this answers

| party | what happened before | after |
| --- | --- | --- |
| CFO / control owner | an approval the DoA required could be skipped by waiting | the number of approvals never drops |
| requester wanting to avoid a reviewer | could wait out the SLA | waiting produces a chased reviewer, not a removed one |
| deputy / escalation target | had no way to be given a stuck item | named on the step, may act as soon as it is overdue |
| overdue approver | lost the item without being told | keeps it, and keeps hearing about it |
| auditor | `ESCALATE` meant "a step vanished here" | it means "this step changed hands, from X to Y" |
| delegate near a period edge | window closed early or late by the server's day | the window is the company's own days |

## What This Change Does NOT Do

- **Does not add a reporting line.** `employee.manager_id` would let escalation climb an org chart,
  and it is the more familiar answer — but it is master data with its own maintenance, its own
  cycles to prevent and its own effect on every other capability that could read it. A step-level
  escalation target answers the same need with configuration that already has a shape here. If a
  reporting line is added later, `escalate_to_*` is where it would resolve from.
- **Does not add multi-level escalation timers** (escalate again after a further N hours to a
  further target). One target, then chase.
- **Does not change `sla_hours` or the working-hour calculation.** The clock itself — measured per
  step from when the step opened — is fixed in `lock-the-route-at-submit`, which this change
  depends on.
- **Does not let escalation approve anything.** The target is given the ability to act, never the
  approval itself.
