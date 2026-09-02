# Design — Route only what someone can approve

## Context

Three ways a workflow can be configured so that a document routed into it never moves:

```
1. a step names no approver        → step opens with zero actors, document sits IN_APPROVAL
2. no step applies to the amount   → routing refuses, document stays SUBMITTED, budget held
3. escalation that cannot fire     → the setting is stored and never read
```

The submit path already refuses an incomplete document **before** it takes any hold — the vendor,
payee, warehouse and employee gates all sit above the transaction, and each says so in a comment:
*"runs before any hold is taken, so a rejected submit leaves the document DRAFT with nothing
reserved."* Routing is the exception. It happens after:

```
inTransaction {  budget.reserve → stock.reserve → quota.reserve → status = SUBMITTED  }  commit
                                        ↓
                     emit('document.submitted') → routing.start() → throws → listener logs
```

That ordering is why the listener's message ends with *"and the budget it reserved stays held"*.

## Goals / Non-Goals

**Goals:**

- No step can be saved that nobody could ever approve.
- No document can strand because its workflow had nowhere to send it — and if it cannot be routed,
  nothing is reserved on its behalf.
- (dropped during design — see D2) escalation coherence is inert rather than harmful, and the
  specification already defines the behaviour of both combinations.

**Non-Goals:**

- No change to who may approve, to delegation, to no-self-approval (invariant 8), or to how
  eligibility resolves.
- No change to escalation behaviour or to what escalation settings may be stored. D2 explains why
  this left the change.
- Not a static proof that every possible document is routable. See D3 — that proof cannot be made
  without either false positives or knowing who will submit.
- No retro-validation of stored workflows.

## Decisions

### D1. "Names an approver" is checkable; "has a live approver" is not, and should not be

A step with neither `approver_role_id` nor `approver_user_id` resolves to an empty principal list,
and `openStep` then writes zero actors and commits happily. Nothing about that configuration can be
repaired by any later act — no amount of staffing gives a step an approver it never named.

A step naming a **role that currently has no holders** is a different thing entirely. It is a
staffing fact, it is true only today, and it is fixed by adding somebody to the role rather than by
editing the workflow. Refusing it at config time would refuse a workflow that is correct.

So the rule is about what the configuration *says*, never about who happens to hold it:

| | refused |
| --- | --- |
| step names no role and no user | yes — unfixable by any later act |
| step names a role nobody holds yet | no — a staffing question, answered elsewhere |

### D2. Escalation coherence is dropped from this change — it is inert, not harmful

The proposal set out to refuse an escalation target on a step with no `sla_hours`, and on a
`PARALLEL_ALL` step. Reading the specification changed the answer.

`SLA and Escalation` already defines what happens in both cases, deliberately:

> *"When the overdue step names NO escalation target, the system SHALL escalate nothing: it SHALL
> notify the overdue approver again and leave the step as it is."*
>
> *"A `PARALLEL_ALL` step SHALL NOT be reassigned by escalation whatever it names… Such a step SHALL
> be notified again like a step with no target."*

The second sentence says *whatever it names* — the combination is a specified state with defined
behaviour, not an accident. Refusing to store it would remove a state the specification describes.

There is also a legitimate reason to store it. `approve_mode` and `sla_hours` are both editable. An
administrator who names an escalation target today and adds the SLA next week, or who switches a
step from `PARALLEL_ALL` to `SEQUENTIAL`, gets a working escalation without having to remember to
go back and re-enter the target. Refusing the write forces exactly that memory.

**The distinction that survives is not "permanent versus fixable" — it is whether the configuration
harms a document.**

| configuration | effect |
| --- | --- |
| step names no approver | a document routes into it and stops, holding budget — **harm** |
| no step applies to the document | the document strands, holding budget — **harm** |
| escalation with no SLA | the step is chased instead of reassigned — **inert** |
| escalation on `PARALLEL_ALL` | same, and the spec says so — **inert** |

Only the first two cost anybody anything. An inert setting deserves a hint on the configuration
screen — *"this step has no SLA, so this target will never be used"* — which is a different change,
about that screen, and not a refusal in the service.

Dropping this narrows the change to the two rules that prevent a document from stranding.

### D3. Routability is checked at submit, before any hold — NOT at configuration time

The proposal first said the bands must cover every amount, checked when the workflow is written.
Writing this document showed that to be both insufficient and wrong-headed.

**Insufficient**, because the band is not the only filter. A step applies when

```
amount within [amount_min, amount_max]   AND   stepEngagesFor(condition_json, requesterLevel)
```

and `condition_json` selects on the requester's job level (`levels` list or `minRank`). A workflow
whose bands tile `[0, ∞)` perfectly still strands a requester whose level no step engages for —
including a requester with no employee record at all, whose rank is absent and who is therefore
skipped by every `minRank` step.

**Wrong-headed**, because making it sufficient means proving coverage over every
(amount × job level) pair including the no-level case. That is finite and decidable — `job_level` is
a company-scoped master — but it would refuse workflows that are perfectly correct in practice: one
used only by a department whose staff are all one level does not need steps for the others, and the
configuration cannot know who will submit.

The alternative is better and smaller. **Resolve the route during submit, before any hold is
taken**, and refuse the submit when no step applies:

| | today | after |
| --- | --- | --- |
| where it is detected | event listener, after commit | submit, above the transaction |
| what the user sees | nothing | a refusal naming the workflow |
| document state | `SUBMITTED`, unroutable | stays `DRAFT` |
| budget | reserved and held | never taken |

This needs no coverage analysis, produces no false positives, and puts the check where every other
completeness gate on that path already is. The listener keeps its log as a net for anything that
still slips past.

**It changes when routing is resolved, not how.** `applicableSteps` runs against the same document
state either way — the amount bands compare the budget base, which is stamped before the holds — so
a route resolved at the gate is the route the listener would have resolved a moment later. The
listener still materialises and starts it; the gate only asks whether it could.

### D3a. The gate makes document-submit depend on the approval module, and that is now true

`Auto-Start Routing on Submit` says routing is event-triggered *"so document handling does not
depend on the approval module."* Asking, during submit, whether a route exists breaks that: the
predicate lives in `WorkflowStepResolver`, and `ApprovalWorkflowModule` already imports
`DocumentEngineModule`, so injecting it back is a cycle.

Three ways out were weighed. Reimplementing the predicate in the document module was rejected
outright — a second answer to "does this step apply" is free to disagree with the router, which is
the defect class this whole run of changes has been closing (task 2.3). Moving the resolver to a
module both could import is clean but has no obvious home and refactors approval's internals for a
caller's convenience. Restructuring submit so the holds are taken after routing avoids the
dependency but reorders a transaction that deliberately keeps the holds and the status change
together (invariant 4), which is a much larger risk for a smaller prize.

So: `forwardRef` and an `@Optional()` injection, the pattern this module already uses for
`GeneralLedgerModule`, whose comment states the test — *"The two capabilities genuinely depend on
each other, and forwardRef is how Nest is told that rather than a smell to be refactored away."*

That test is met. Asking whether a document can be routed IS a question for the approval module;
the previous arrangement avoided the dependency only by not asking until it was too late to act on
the answer. The specification sentence is therefore amended rather than worked around: routing is
still **started** by the event, and the submit path now **asks** whether starting will be possible.
`@Optional()` keeps the unit tests that submit without an approval module working, exactly as it
does for stock, warehouses and matching.

### D4. The rules live where the workflow rules already live

`WorkflowConfigService` already refuses `amount_min > amount_max`, a duplicate step number, and a
role or user from another company. D1 joins them. This is the same placement argument the
document-type rules used: the file that already answers "may this configuration be saved?" should
answer the rest of it too.

D3 goes on the submit path, beside the vendor/payee/warehouse gates, for the same reason — it is a
completeness check on a document about to be submitted, not a fact about a workflow.

## Risks / Trade-offs

- **A workflow saved before this change can still strand a document** → the rules bind on write, so
  an untouched workflow is never re-examined. D3 covers it anyway: the submit is refused whatever
  the workflow's history, which is the argument for putting routability at submit rather than
  relying on config-time rules alone.
- **Resolving the route during submit costs a query on a path that is already long** → it is the
  same read the listener performs moments later, moved rather than added. Worth measuring rather
  than assuming, since submit already does budget, stock and quota work under a lock.
- **The gate and the listener could disagree** if anything between them changed the document's
  amount or the workflow's steps. Nothing on that path does, but the failure mode would be a
  document that passed the gate and then stranded anyway — which is today's behaviour, so the net
  still holds.
- **Refusing a step with no approver may break an existing editing flow** where a step is created
  first and given its approver in a second save. If the config UI does that, this rule turns a
  two-step edit into an error. Worth checking before implementing; the fix would be to require the
  approver only on the completed step rather than at every intermediate save.

## Migration Plan

None. No schema change and no data change. The two configuration rules bind on the next write; the
submit gate applies to the next submit. Rollback is reverting the commit.

## Open Questions

- **Does the workflow-step editor save a step before its approver is chosen?** D-risk above. If it
  does, the rule needs to bind on the finished step rather than on every save, and that is a
  question about the screen rather than the service.
- **Should a workflow with no steps at all be refusable?** It is the degenerate case of D3 and is
  caught at submit. Whether it is also worth refusing at config time depends on whether workflows
  are built incrementally, which is the same question as above.
