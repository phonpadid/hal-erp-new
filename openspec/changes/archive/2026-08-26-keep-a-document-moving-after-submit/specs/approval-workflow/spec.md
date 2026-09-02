## MODIFIED Requirements

### Requirement: Reject Returns and Releases

On rejection the system SHALL set the document to REJECTED, release reserved budget
and quota, and allow the requester to revise and resubmit.

A resubmission SHALL resolve and record a fresh route from the configuration in force at that
moment, and SHALL mark the previous route's rows superseded rather than deleting them, so each
attempt keeps the record of the chain it actually ran.

Marking the previous rows superseded SHALL be durable in the database **before** the replacement
rows are written, within the same transaction. `document_approval_step` carries a partial unique
key on `(document_id, step_no)` where `superseded_at IS NULL`; a replacement row inserted while its
predecessor is still live violates that key, the whole routing transaction rolls back, and the
document is left `SUBMITTED` holding a reservation with no route and no approver. The ordering SHALL
be stated by the code rather than inherited from whatever order the ORM happens to flush a unit of
work in, because "supersede, then replace" is the rule the unique key expresses and an ORM's flush
order is not part of that contract.

A resubmission whose route cannot be written SHALL leave the document `SUBMITTED` and SHALL be
reported at error level, naming the document and the holds it is carrying. It SHALL NOT be
discarded at a log level the application does not enable: a document holding budget in nobody's
queue is invisible to every user of the product, so the server log is the only place its existence
can be known.

When the rejected document is a budget plan (`post_action` `ACTIVATE_BUDGET`), rejection SHALL
additionally set every `budget` referenced by the document's `budget_movement` rows from `DRAFT` to
`REJECTED`, in the same transaction as the terminal transition. Nothing is released for such a
document: a plan's type has `requires_budget` `false`, so it never held a reservation. The rows are
marked rather than deleted — `budget_movement.to_budget_id` references them, and the record of what
was proposed and turned down is the reason budgets are routed through approval at all.

#### Scenario: Rejected document can be resubmitted

- **GIVEN** a rejected document
- **WHEN** the requester edits and resubmits it
- **THEN** it re-enters routing from the first step with a fresh reservation

#### Scenario: A returned document can be resubmitted

- **GIVEN** a document an approver returned, now `DRAFT`, whose first attempt left
  `document_approval_step` rows behind
- **WHEN** the requester resubmits it
- **THEN** it reaches `IN_APPROVAL` at the first applicable step, its previous route's rows are
  marked superseded, and one live row exists per applicable step

#### Scenario: A resubmission is routed by current configuration

- **GIVEN** a returned document whose workflow gained a step while it was in `DRAFT`
- **WHEN** it is resubmitted
- **THEN** its new route includes that step, and the superseded route still shows the chain the
  first attempt ran

#### Scenario: A route that cannot be written is reported, not swallowed

- **GIVEN** a submitted document whose route write fails
- **WHEN** the auto-start listener handles the failure
- **THEN** the failure is logged at error level naming the document, rather than at a level the
  application does not enable

#### Scenario: Rejecting a budget plan marks its proposed budgets REJECTED

- **GIVEN** a submitted budget plan carrying `DRAFT` budgets
- **WHEN** an approver rejects it
- **THEN** every budget the plan references has `status` `REJECTED` in the same transaction that
  marks the document `REJECTED`
- **AND** no budget release row is written

### Requirement: Authorized, Append-Only Actions with Hold Release

Every action taken through the approval endpoint SHALL require `DOC_APPROVE`, be recorded in the
append-only `approval_log` (never modified), and carry actor, action, timestamp, and remark.

`DOC_APPROVE` gates that endpoint, not the table. A withdrawal is also recorded in `approval_log`
and is authorised by `DOC_CANCEL` on the document's own cancel endpoint, because it is the
requester ending their own request rather than a decision about somebody else's. Every writer of
that table SHALL name the permission it was authorised by, so no reader concludes from a row that
its author held `DOC_APPROVE`.

The action endpoint SHALL accept only the actions a person performs: `APPROVE`, `REJECT` and
`RETURN`. `ESCALATE` SHALL be written by the system's SLA sweep alone and SHALL be refused when it
arrives from a caller, because a row in the audit trail that reads as an automated escalation MUST
NOT be authorable by the approver it excuses. `CANCEL` SHALL likewise be refused there: a
withdrawal is not an approval decision and does not arrive through this endpoint. Refusal SHALL
happen at validation, before any `approval_log` row is written. The set of actions the routing
engine handles SHALL be exhaustive over the accepted set, so an action the engine does not act on
cannot become a history row.

Every path that decides a document's `status` SHALL re-read `document` under a pessimistic write
lock and SHALL make its decision and its write against that locked row. This covers withdrawal and
the opening of a route as well as the approval actions that already take the lock. Routing begins
from the submit event, after the submit transaction commits, so there is a window in which a
document is `SUBMITTED` and no route has opened; a withdrawal accepted in that window and a route
opening that read `SUBMITTED` a moment earlier will otherwise both commit, and the later write
wins. A withdrawal the server accepted SHALL be the document's final state: no later write SHALL
move it out of `CANCELLED`, and a route SHALL NOT open on a document that is no longer `SUBMITTED`
when the route is written.

On an APPROVE action the system SHALL additionally stamp `approval_log.signature_id` with the
acting user's `app_user.current_signature_id` as it stands at the moment of approval, so
the recorded signature is locked to the approval event and is unaffected by any later
signature change; when the acting user has no current signature the action SHALL still
succeed and `signature_id` SHALL be null. REJECT, RETURN and CANCEL actions SHALL NOT
stamp a signature. REJECT SHALL set the document `REJECTED` and release its reserved
budget and quota; RETURN SHALL set it `DRAFT` and release holds so the requester can revise
and resubmit.

#### Scenario: Reject releases holds

- **GIVEN** a document holding budget/quota reservations
- **WHEN** an approver rejects it
- **THEN** it becomes `REJECTED` and all reservations are released

#### Scenario: A withdrawal taken before the route opens is final

- **GIVEN** a document whose submit has just committed and whose route has not yet opened
- **WHEN** its creator withdraws it
- **THEN** it is `CANCELLED`, its `approval_log` carries the `CANCEL` row, its budget hold is
  released, and the route never opens on it

#### Scenario: The audit trail is immutable

- **WHEN** an attempt is made to update an existing `approval_log` row
- **THEN** it is rejected (append-only)

#### Scenario: An approver cannot post an escalation

- **GIVEN** an eligible approver on a document's current step
- **WHEN** they submit the action `ESCALATE`
- **THEN** the request is refused at validation, no `approval_log` row is written, and the
  document's current step is unchanged

#### Scenario: A withdrawal cannot be posted to the approval endpoint

- **WHEN** a caller submits the action `CANCEL` to the approval endpoint
- **THEN** it is refused at validation, and the withdrawal remains reachable only through the
  document's cancel endpoint under `DOC_CANCEL`

#### Scenario: An unhandled action never becomes history

- **WHEN** an action outside the accepted set reaches the action endpoint
- **THEN** it is refused before any row is written, rather than recorded and ignored

#### Scenario: Approve stamps the approver's current signature

- **GIVEN** an approver whose `app_user.current_signature_id` references signature S1
- **WHEN** they approve the current step
- **THEN** the new `approval_log` row has `signature_id` = S1, set at insert and never updated

#### Scenario: Approve without a signature still records the action

- **GIVEN** an approver with no current signature
- **WHEN** they approve the current step
- **THEN** the approval succeeds and the `approval_log` row's `signature_id` is null

#### Scenario: Non-approve actions do not stamp a signature

- **WHEN** an approver rejects or returns, or a requester withdraws
- **THEN** the recorded `approval_log` row has a null `signature_id`

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

Using the same resolver is not sufficient on its own: it SHALL be given the same INPUT. A step's
amount band is compared against the document's base amount, which submit computes and stamps onto
`document.budget_base_total_amount` inside its write transaction — after the gate has already run.
The gate SHALL therefore be given the base amount this submission computed, rather than reading a
column the submission has not written yet. Reading the column instead means a first submission is
judged as if the document were worth zero, so a workflow whose lowest step carries an `amount_min`
above zero refuses every document it receives however large; and a resubmission is judged on the
previous attempt's figure, which the document may no longer carry. A workflow's lowest band SHALL
NOT be required to start at zero.

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

#### Scenario: A workflow whose lowest band starts above zero still accepts a document inside it

- **GIVEN** a workflow whose only step engages at or above 10,000,000
- **WHEN** a 20,000,000 document is submitted for the first time
- **THEN** the submit is accepted and the document reaches `IN_APPROVAL` at that step

#### Scenario: A document with nowhere to route is refused

- **GIVEN** a document whose mapped workflow has no step applicable to its amount and requester
- **WHEN** it is submitted
- **THEN** the submit is rejected and the document remains `DRAFT`

#### Scenario: A refused submit reserves nothing

- **GIVEN** such a document, of a type that reserves budget
- **WHEN** the submit is rejected for having no applicable step
- **THEN** no `budget_txn` row was written for it, and no stock or quota hold was taken

#### Scenario: A resubmission is judged on the amount it now carries

- **GIVEN** a returned document whose lines were edited so its base amount falls below the only
  step's band
- **WHEN** it is resubmitted
- **THEN** the submit is refused for having no applicable step, rather than accepted on the figure
  its previous attempt stamped
