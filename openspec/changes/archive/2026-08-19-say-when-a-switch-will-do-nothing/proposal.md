# Say when a switch will do nothing

## Why

Two configuration screens offer settings that, given the rest of the configuration, are already
inert. The switch moves, the value saves, nothing happens, and nothing says so.

**A reference pairing may be marked auto-create on a type that never creates successors.**
`auto_create` is read in exactly one place — `autoCreateSuccessorsFor`, called only from
`recordSuccessorObligations`, reachable only from `case 'CREATE_SUCCESSOR'` in the post-action
dispatcher. If the predecessor's `post_action` is anything else, or absent, the dispatcher never
arrives at the line that reads the flag.

`successor_department` sits one level further down: it is read only inside that same auto-create
loop, so it means nothing unless `auto_create` is on, which means nothing unless the predecessor
creates successors. Three levels, each silently inert when the one above it is not set:

```
document_type.post_action = CREATE_SUCCESSOR
        └─ pairing.auto_create
                └─ pairing.successor_department
```

The reference configuration happens to be correct — `PROC → PO` is the only auto-create pairing and
`PROC` is the only `CREATE_SUCCESSOR` type — so nothing has gone wrong yet. What is missing is any
signal to whoever configures the next one.

**A workflow step may name an escalation target that can never fire.** `escalate_to_role_id` /
`escalate_to_user_id` are read only by `escalateOverdue`, which the sweep calls only for overdue
steps — and a step with no `sla_hours` is never overdue. Separately, a `PARALLEL_ALL` step declines
escalation by design, because one target cannot stand in for a committee.

**These were deliberately left out of the change that would otherwise have refused them.**
`route-only-what-someone-can-approve` drew the line at whether a configuration *harms a document*:

> Only the first two cost anybody anything. An inert setting deserves a hint on the configuration
> screen — *"this step has no SLA, so this target will never be used"* — which is a different
> change, about that screen, and not a refusal in the service.

`no-flag-without-its-prerequisite` refused three `document_type` combinations by the same test, and
each of those did cost somebody something: a required field that could never be filled, a 500 at
submit, an approved expense recorded nowhere.

Nothing here costs anybody anything. No document strands, no budget is held, no book is wrong. The
only injury is to the person who set the switch and believed it, and the fix for that is to tell
them — which is this change, and which is why refusing the write would have been the wrong shape.

**Both hints are computable from what the screen already has.** The pairing editor receives the
predecessor as `props.documentType`, and `DocType` already carries `postAction`. The step form holds
`approveMode` and `slaHours` in the same form state as the escalation fields. Neither hint needs a
new endpoint, a new field, or a server round-trip.

## What Changes

**The pairing editor says when auto-create cannot fire.** Where a type's successors are listed and
the auto-create switch offered, a predecessor whose post-action does not create successors is
stated as such, next to the switch it disables in effect. The successor department needs nothing said: the
picker is not offered at all unless auto-create is on, which settles the question before it is
asked. A test now holds that shut.

**The step form says when an escalation target cannot fire.** A step with no SLA, or in an approve
mode that declines escalation, says so beside the escalation fields.

**Both remain settable.** The prerequisite is editable and the natural order of work is often to
name the target first and enable the mechanism after. A hint tells the administrator what is true
now; a refusal would tell them to do things in an order the screen invented.

**Nothing on the server changes.** No validation is added, no write refused, no behaviour altered.
Every combination that saves today still saves.

## Who this answers

| party | today | after |
| --- | --- | --- |
| whoever ticks auto-create on a type that never creates successors | the switch moves, the value saves, nothing ever happens | the screen says the predecessor does not create successors |
| whoever sets a successor department without auto-create | same | the screen says it applies only to auto-created successors |
| whoever names an escalation target on a step with no SLA | the target is stored and never used | the screen says the step needs an SLA before escalation can fire |
| whoever names one on a `PARALLEL_ALL` step | same | the screen says this mode is chased rather than reassigned |
| whoever inherits the configuration later | must read the post-action dispatcher to know which switches are live | the screen tells them |

## What This Change Does NOT Do

- **Does not refuse any configuration.** Everything that saves today still saves, on the server and
  on the screen. The hint is advisory because the underlying setting is harmless.
- **Does not change escalation, auto-creation, or successor departments at runtime.** Each behaves
  exactly as it does now, including the deliberate refusal to escalate a `PARALLEL_ALL` step.
- **Does not add server validation.** Where a configuration genuinely costs something, the rule
  belongs in the service and two changes have already put three there. This is the other half of
  that line, not a softer version of it.
- **Does not disable the controls it annotates.** A disabled switch would be a refusal wearing a
  different hat, and would break naming a target before enabling the mechanism.
- **Does not audit the remaining configuration surface.** The sweep that found these covered
  `document_type`, `document_type_ref` and `workflow_step`. Other tables have not been examined the
  same way.
