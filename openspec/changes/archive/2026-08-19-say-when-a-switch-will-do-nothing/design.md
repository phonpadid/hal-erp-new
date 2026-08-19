# Design — Say when a switch will do nothing

## Context

Four settings across two screens are inert given the rest of the configuration, and neither screen
says so:

```
pairing.auto_create           inert unless predecessor.post_action = CREATE_SUCCESSOR
pairing.successor_department  inert unless auto_create  — already unreachable on the screen
step.escalate_to_*            inert unless sla_hours
step.escalate_to_*            inert when approve_mode = PARALLEL_ALL
```

Every one is harmless. That is the whole reason this is a screen change: the two preceding changes
put rules in the service for the configurations that cost something, and drew the line explicitly at
those that do not.

## Goals / Non-Goals

**Goals:**

- Each screen states, at the moment of setting, when a setting cannot take effect and what would
  make it able to.
- The condition is derived from state the screen already holds — no new endpoint, field, or fetch.

**Non-Goals:**

- No refusal, on the screen or the server. Every combination that saves today still saves.
- No disabling of the annotated controls (D3).
- No runtime change to escalation, auto-creation or successor departments.
- No audit of tables the earlier sweep did not cover.

## Decisions

### D1. A hint, because the setting is harmless — the same test the last two changes used

`route-only-what-someone-can-approve` sorted configurations by whether they harm a document, refused
the two that do, and said in as many words that an inert setting *"deserves a hint on the
configuration screen … not a refusal in the service"*. `no-flag-without-its-prerequisite` refused
three more, each of which cost something real.

These four cost nothing. No document strands, no appropriation is held, no entry is missing. So the
line drawn in those changes puts them here, and putting them in the service instead would have
contradicted a decision archived the same day.

The test is worth restating because it will come up again: **refuse what harms a document, annotate
what merely does nothing.**

### D2. Computed on the client, from state the screen already has

| hint | needs | already present as |
| --- | --- | --- |
| auto-create inert | the predecessor's post-action | `props.documentType.postAction` — `DocType` carries it |
| escalation inert (no SLA) | the step's SLA | `slaHours` in the same form state |
| escalation inert (mode) | the step's approve mode | `approveMode`, likewise |

Nothing needs fetching. An alternative — having the server return "this setting is inert" per row —
would put a presentation judgement in an endpoint and still leave the *new*-pairing form, which has
no row to ask about, without an answer.

**The condition is stated once per screen**, not repeated at each place it is rendered, so the rule
and its wording move together.

### D3. Annotated, not disabled

Disabling the control is the tempting shortcut and is a refusal in disguise: it forces the
administrator to set the prerequisite first, in an order the screen invented. Naming an escalation
target and adding the SLA afterwards is a reasonable way to work, and so is pairing two types before
deciding one of them auto-creates.

The hint says what is true now. The control stays live because the setting is legitimate and the
prerequisite is editable.

### D4. The wording names the prerequisite, not the symptom

*"This switch will do nothing"* tells the administrator they have a problem. *"Purchase Order does
not create successors, so auto-create will not run"* tells them what to change. This matches the
refusal messages the service rules already produce, which name the missing flag rather than the
present one — the fix is nearly always to add the prerequisite.

### D5. Both screens in one change, because they are one rule

The pairing editor and the step form are different files with no shared code, and it would be
defensible to split them. They are together because the reason is identical and was decided in one
place: whoever reads this later should find both halves of "annotate what merely does nothing"
under one change rather than discovering the second by accident.

### D6. The successor department needed no hint — the screen already withholds it

Implementation found the picker gated behind auto-create in both places it appears, so the setting
cannot be made inertly at all. Adding a statement about a control nobody can reach would have been
worse than nothing, and showing the control in order to explain it would have been worse still.

The spec scenario was rewritten to record what the screen guarantees, and a test holds the gate
shut so a later "let them set it up front" edit has to argue with something.

## Risks / Trade-offs

- **A hint nobody reads is a hint that did not work.** Placement matters more than wording — beside
  the control, not in a legend or a tooltip only. Worth looking at on the running app in both themes
  rather than declaring it done from a passing test.
- **Four hints on two screens is visual noise** if all are shown at once. In practice a screen shows
  at most one or two, because the conditions are mutually exclusive in the common cases, but the
  layout should be checked with several visible.
- **The conditions restate knowledge that lives in the server.** `auto_create` is read only under
  `CREATE_SUCCESSOR`, and escalation only for overdue non-`PARALLEL_ALL` steps — facts the client now
  encodes a second time. If either changes, the hint becomes a lie, and a lie is worse than the
  silence it replaced. The mitigation is that both are stated in the specification this change
  updates, so the next person to move them has somewhere to notice.
- **This is the weakest of the three sweep changes.** Nothing is broken; the value is entirely in
  telling somebody something. That is worth being honest about rather than dressing it as a defect
  fix.

## Migration Plan

None. Client-only, additive, no schema or data change. Rollback is reverting the commit.

## Open Questions

- **Whether the same treatment is owed elsewhere.** The sweep covered three tables; the pattern
  (a field read only under another field's value) is likely present in others that were not
  examined. Out of scope, and worth a look if a fourth instance turns up.
