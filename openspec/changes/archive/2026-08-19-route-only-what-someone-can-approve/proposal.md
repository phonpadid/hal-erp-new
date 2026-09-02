# Route only what someone can approve

## Why

A workflow step can be configured so that no document routed to it can ever be approved. The
configuration is accepted without comment, the document submits normally, and it stops.

**A step may name no approver at all.** `workflow_step` carries `approver_role_id` and
`approver_user_id`, both nullable, and nothing requires either. A step with neither resolves to an
empty approver list:

```
principals(step)  →  if (step.approverUser) return [id]
                     if (!step.approverRole) return []      ← nobody
```

What happens next is the part that matters. The step still **matches** — `stepMatches` filters on
the amount band and the requester's level and never asks who could act — so routing succeeds. The
step opens, `openStep` iterates an empty principal list and writes zero actors, `flush` succeeds,
and the document becomes `IN_APPROVAL`. The `approval.step-assigned` event fires with an empty
recipient list, so nobody is notified.

The result is a document that looks exactly like every other in-flight document. It is in an
approval queue that belongs to no one, holding whatever budget it reserved at submit, and there is
no error, no log line, and no queue it appears in. The only way to discover it is for somebody to
wonder why it never moved.

**A step's amount bands may leave a gap.** `amount_min` / `amount_max` decide which steps engage; a
document whose amount falls outside every band matches nothing. The codebase already knows about
this one and says so, at the moment it is too late:

> *"Document is stranded: its workflow has no step that applies to this amount, so no approver will
> ever see it and the budget it reserved stays held. **Fix the workflow bands** — the lowest band
> must start at zero."*

That message is exact, and it is written into an event listener that runs after the document has
been submitted, the budget reserved, and the routing refused. It names the cause, the consequence
and the fix — to a log file, at the moment nothing can be done from there. The person who
configured the bands is not present and was never told.

**Two of these are worse than the third.** A band gap at least raises an error and leaves the
document `SUBMITTED`. A step with no approver produces no error at all and leaves the document
`IN_APPROVAL`, which is indistinguishable from working.

**A third case was investigated and deliberately left out.** A step may carry an escalation target
that can never fire — `escalate_to_*` is reached only for **overdue** steps, and a step with no
`sla_hours` is never overdue; separately, escalation on a `PARALLEL_ALL` step is declined by design.
Both are inert rather than harmful: no document is worse off, the step is simply chased instead of
reassigned. `SLA and Escalation` already specifies exactly that, for a `PARALLEL_ALL` step
*"whatever it names"* — so the combination is a described state, not an accident, and an
administrator may reasonably set a target before adding the SLA. Refusing it would remove a
specified state and a legitimate order of work. The reasoning is in the design; the scope here is
the two cases that strand a document.

**None of this is caught where it is made.** `WorkflowConfigService` already validates four things —
`amount_min` ≤ `amount_max`, step numbers unique within a workflow, and both the role and the user
belonging to the active company. So the idea that a step's configuration should be checked when it
is written is established here; the set of things checked is just smaller than the set of things
that can go wrong.

**This is the same defect this codebase has been closing all week, one layer further in.** A
document type that could not be carried to a working document; a card routing to a screen the user
could not open; a picker reading an endpoint the role could not call; a type reserving budget with
nothing able to settle it. Each time the system offered something it would not honour. A workflow
step nobody can approve is that shape applied to the approval chain itself.

## What Changes

**A step SHALL name someone who could approve it.** Creating or updating a step of an active
workflow without either an approver role or an approver user is refused. A step that names a role
is enough — who holds that role is a question for the moment the step opens, and a role standing
empty today may be filled tomorrow. What is refused is a step that names nobody at all, which cannot
become approvable by any later act.

**A document SHALL NOT be submitted into a workflow that has nowhere to send it.** The route is
resolved during submit, above the transaction and before any budget, stock or quota hold is taken,
and a document with no applicable step is refused while it is still `DRAFT` with nothing reserved.

This is deliberately a submit-time gate rather than a rule about the bands, and writing the design
is what settled it. A step applies on its amount band **and** on `condition_json`, which selects by
the requester's job level — so bands that tile every amount still strand a requester no step engages
for, including one with no employee record whose rank is absent. Proving coverage at configuration
time would mean proving it over every (amount × job level) pair, which is decidable but would refuse
workflows that are correct: one used only by a department whose staff share a level does not need
steps for the others, and the configuration cannot know who will submit. Refusing the submit needs
no such proof and cannot produce that false positive.

The existing listener keeps its log as the net for anything already stored.

**Nothing about routing or escalation behaviour changes.** Every rule above describes a
configuration that is already inert or already broken at runtime; this refuses to store it. The
`PARALLEL_ALL` decision, the overdue-driven escalation, the band matching and the approver
resolution all behave exactly as they do now.

## Who this answers

| party | today | after |
| --- | --- | --- |
| whoever submits into a stepless band | document stranded in `SUBMITTED`, budget held, one line in a log they cannot see | the submit is refused, the document stays `DRAFT`, nothing is reserved |
| whoever submits into an approverless step | document sits `IN_APPROVAL` in nobody's queue, indistinguishable from working | cannot happen |
| whoever waits for that approval | no queue entry, no notification, no error — only the eventual question of why nothing moved | the document reaches a queue with someone in it |
| whoever configures a workflow | may save a step nobody can act on and hear nothing | told at the moment of saving, naming what is missing |
| whoever configures the bands | learns nothing; the gap surfaces as somebody else's stuck document | still learns nothing at save time — but no document is harmed by it |
| whoever debugs it later | reads a listener log after the fact, if they find it | the case does not arise |

## What This Change Does NOT Do

- **Does not change who may approve anything.** Role membership, delegation, the no-self-approval
  rule (invariant 8) and the eligibility resolution are untouched.
- **Does not require a step's role to have holders.** A role with nobody in it today is a staffing
  question and can be answered tomorrow without touching the workflow; a step naming nobody cannot
  be answered at all. The rule is about the configuration, not about the org chart.
- **Does not restrict escalation settings.** An escalation target may still be stored on a step with
  no SLA or a `PARALLEL_ALL` mode. Both are inert rather than harmful, the specification already
  describes the behaviour, and refusing them would break configuring a target before enabling the
  SLA. A hint on the configuration screen would serve better and belongs to that screen.
- **Does not retro-validate stored workflows.** The rules bind on write. A workflow already saved
  with a gap or an approverless step stays as it is until someone edits it, and the existing
  listener log remains the safety net for anything already out there.
- **Does not touch the other configuration surfaces found alongside this one.**
  `document_type` (`requires_payee` without a vendor, a stock post-action without
  `requires_warehouse`, `accrues_on_approval` with no budget) and `document_type_ref`
  (`auto_create` on a predecessor that never creates successors, `successor_department` without
  `auto_create`) are the same class of defect and belong in their own changes, in their own modules.
- **Does not make MikroORM's `ValidationError` answer 400 instead of 500.** That escape is real and
  now has two known instances, but it is a fault-handling question rather than a configuration one.
