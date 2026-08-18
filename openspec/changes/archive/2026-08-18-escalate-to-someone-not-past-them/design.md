# Design

## D1. Escalation changes WHO, never WHETHER

```ts
// sla.service.ts today
document.currentStepNo = target.stepNo;   // the overdue step is now behind us
```

The approval that the amount band and the job-level condition said this document required is not
performed by anybody. Nobody rejected it, nobody approved it, nobody was reassigned it — the step is
simply gone, and the document is one approval lighter.

The fix is a different verb on the same row:

```
before                                    after
──────                                    ─────
current_step_no = next step               current_step_no unchanged
the step's approval never happens         the step stays open, and someone else may act
```

`document_approval_step` gains `escalated_to_user_id` and `escalated_at`. Resolution treats that
user as an additional eligible actor on that step. The number of approvals the document needs never
drops, and the escalation is a fact about one step rather than a hole in the route.

## D2. Where the target comes from: configuration, per step

`workflow_step` gains `escalate_to_role_id` and `escalate_to_user_id`, the same either-or shape the
approver target already has, resolved in the active company by the same rules
(`honour-every-field-the-api-accepts` D1). Copied onto `document_approval_step` at submit like
everything else the route carries.

**Why not a reporting line.** `employee.manager_id` is the familiar answer and the resolver even has
the seam for it (`superior()`, returning null forever). It is also master data with its own
maintenance, its own cycles to prevent, and its own effect on every capability that could read it —
a bigger change than this one, arriving through the back door. A step-level target answers the same
need with configuration that already has a shape here (invariant 7). If a reporting line is added
later, `escalate_to_*` is where it would resolve from.

**Resolution of the target at escalation time, not at submit.** The role's *holders* are read when
the escalation happens, exactly as the approver target is. Only the target's identity (which role,
which person) is frozen with the route.

## D3. No target means chase, not skip

A step with no escalation target configured is **not** escalated. The sweep keeps notifying its
approver on every pass and the document keeps waiting.

A route that stalls is visible, recoverable and honest; a route that quietly shortens itself is none
of those. The stall is already surfaced — the ageing report shows time-in-step and the overdue flag,
and the inbox marks it — so "stuck" is a state somebody can see and act on, which is more than the
current behaviour offers.

## D4. `PARALLEL_ALL` is chased, never reassigned

A `PARALLEL_ALL` step exists precisely because N named people must each sign off. One escalation
target approving cannot stand in for a committee without destroying the control the mode expresses,
and there is no honest rule for which of the recorded actors their approval discharges.

So escalation on a `PARALLEL_ALL` step notifies and does not reassign, whatever is configured. This
is stated in the spec rather than left as an emergent property, because the alternative — a single
approval completing a step that required four — is exactly the class of defect this change exists to
remove.

## D5. What the log says

The `ESCALATE` row keeps its append-only shape and its `stepNo` (the step is not left, so there is
no ambiguity about which step it belongs to). Its `remark` names both ends:

```
SLA breach on step 2: escalated from <principal> to <target>
SLA breach on step 2: no escalation target configured; approver notified again
```

`approval_log.approver` stays the overdue principal — the SLA's subject — as it is today. The
target is named in the remark rather than in `approver`, because that column means "who acted", and
the escalation target has not acted yet.

**One row per escalation, not per sweep.** `escalated_at` on the step row makes the escalation
idempotent: a step already escalated to somebody is not escalated again, so a sweep every five
minutes does not produce a log row every five minutes. The chase notification still repeats — that
is its job — but it writes nothing.

## D6. Delegation windows are the company's day

```ts
// approver-resolver.service.ts:25
const today = new Date().toISOString().slice(0, 10);   // UTC, wherever the box happens to be
```

`gl-journal` settled this for the ledger: a date is the company's calendar day resolved from
`company.timezone`, never the UTC day of the instant, because a date decides which side of a
boundary a fact falls on. A delegation that runs "to the 31st" for a company in UTC+7 currently
stops working at 07:00 on the 31st, local.

`localDateIn(instant, timezone)` already exists in `common/time/company-clock` and is what the
posting engine uses. The resolver takes the same path. This rides along because it is the same
mistake as D1 in miniature — a rule that quietly stops applying — and it is three lines.

## D7. What this leaves for later

| left out | why |
| --- | --- |
| escalating up a reporting line | needs `employee.manager_id`; see D2 |
| multi-level escalation (after a further N hours, a further target) | one target, then chase; a ladder needs its own timers and its own audit shape |
| reassigning a `PARALLEL_ALL` step | see D4 |
| letting an escalation target delegate onward | delegation is one hop by invariant 8, and the target is already a second hop |

## Risks / trade-offs

- **A stalled document now stays stalled where it used to move.** → That is the change. What moves it
  is a person: the escalation target if one is configured, or the approver being chased. The state is
  visible on the ageing report, the inbox and the document detail, all of which already show overdue.
- **A company that configures no escalation target sees no behaviour change except that documents
  stop skipping steps.** → Correct, and the safer default: a route that requires four approvals
  requires four approvals until somebody configures who else may give one.
- **`escalated_to_user_id` widens who may act on a step, which is an authorisation change.** → It is
  configuration-driven, company-scoped by the same resolution as the approver target, and the
  no-self-approval rule still applies: an escalation target who is the document's creator is not
  offered the step.
- **This change writes no `budget_txn` and no `quota_usage`**, and touches no path that does. The
  escalation transaction is the existing one in `escalateOverdue`, which locks the document row and
  now writes two column updates and one log row instead of moving `current_step_no`.
