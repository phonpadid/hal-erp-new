# approval-workflow

## MODIFIED Requirements

### Requirement: Approver by Role or Person

A step SHALL target either a company role (`approver_role_id`) or a specific user
(`approver_user_id`), and the system SHALL refuse to save a step of an active workflow that targets
neither.

The requirement was already stated and was never enforced. A step naming nobody resolves to an empty
principal list, and nothing downstream objects: the step still matches on its amount band and the
requester's level, routing opens it, zero actors are written, and the document becomes
`IN_APPROVAL`. It then sits in no one's queue, holding whatever it reserved at submit, with no error
raised and no notification sent — indistinguishable from a document that is merely waiting.

Refusal SHALL turn on what the configuration names, never on who currently holds it. A step naming a
role with no holders today SHALL be accepted: that is a staffing fact, true only today, and answered
by adding somebody to the role rather than by editing the workflow. A step naming nothing at all
cannot be answered that way, because there is nothing for a later act to fill.

#### Scenario: Role-based step resolves current holder

- GIVEN a step targeting the "Department Head" role
- WHEN routing reaches that step
- THEN the current holder of that role in the document's department is assigned

#### Scenario: A step naming nobody is refused

- **WHEN** a `WORKFLOW_MANAGE` user saves a step of an active workflow with neither an approver role
  nor an approver user
- **THEN** the save is rejected, naming the step

#### Scenario: A role with no holders is still a valid target

- **GIVEN** a company role that nobody currently holds
- **WHEN** a step is saved targeting that role
- **THEN** the save succeeds, because who holds the role is not a property of the workflow

### Requirement: Auto-Start Routing on Submit

When a document is submitted and its mapped workflow has applicable steps, the system SHALL begin
approval routing automatically (transition `SUBMITTED` → `IN_APPROVAL` at the first applicable step)
so it appears in the relevant approvers' inboxes without a manual start. Starting the route SHALL
remain triggered by the submit event.

Deciding whether a route EXISTS is a different question from starting it, and the submit path SHALL
ask it. That makes document submission depend on the approval module's step resolution, which the
event trigger previously avoided — deliberately, and at the cost of only discovering an unroutable
document after it had been submitted and its holds taken. The dependency SHALL be expressed rather
than worked around: the submit path SHALL use the same resolution routing uses, never a second copy
of it, because two answers to "does this step apply" are free to disagree.

**A document whose workflow has no applicable step SHALL be refused at submit**, before any budget,
stock or quota hold is taken, and SHALL remain `DRAFT`. Such a document can never be approved: no
step engages it, so no approver will ever see it. Allowing the submit to succeed and discovering the
problem afterwards leaves the document stranded in a state that looks like progress while holding
appropriations nobody can release, since a reservation is only given back by a settlement or a
rejection and neither can happen to a document no one can act on.

The check SHALL sit with the other completeness gates on the submit path, which run above the
transaction so that a refused submit reserves nothing. It SHALL resolve applicability the same way
routing does — the amount band and the requester's level together — rather than by any separate
rule, so a document the gate accepts is one routing can start.

Applicability SHALL NOT be required to be provable when the workflow is configured. A step engages
on its amount band **and** on the requester's job level, so coverage depends on who submits, which
the configuration cannot know; a rule proved over every amount and level would refuse workflows that
are correct for the people who use them.

#### Scenario: Submit routes into approval

- **WHEN** a document with a mapped, applicable workflow is submitted
- **THEN** it transitions to `IN_APPROVAL` at the first step and its approvers can see it

#### Scenario: A document with nowhere to route is refused

- **GIVEN** a document whose mapped workflow has no step applicable to its amount and requester
- **WHEN** it is submitted
- **THEN** the submit is rejected and the document remains `DRAFT`

#### Scenario: A refused submit reserves nothing

- **GIVEN** such a document, of a type that reserves budget
- **WHEN** the submit is rejected for having no applicable step
- **THEN** no `budget_txn` row was written for it, and no stock or quota hold was taken
