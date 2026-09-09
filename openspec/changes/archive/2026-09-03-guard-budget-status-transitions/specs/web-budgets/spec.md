## ADDED Requirements

### Requirement: The Status Picker Offers Only Sanctioned Moves

The budget edit form's status picker SHALL offer only the statuses the budget's CURRENT status may
legally move to, plus the status it already holds. It SHALL NOT present a fixed list independent of
the budget in front of the user, because a control that is offered and then refused reads as a
defect rather than a boundary, and because a status silently rewritten is a figure silently counted
or uncounted.

For a budget that is `ACTIVE` the picker SHALL offer `ACTIVE`, `INACTIVE` and `CLOSED`; for one that
is `INACTIVE`, the same three. For a budget that is `DRAFT`, `REJECTED` or `CLOSED` the picker SHALL
offer no move at all, and the form SHALL say why rather than showing an empty control: a draft is
waiting on its plan, a rejected budget is terminal and the line is proposed again instead, and a
closed budget's year has run.

The status filter on the budget list SHALL offer every declared status, so a status the app can set
is a status the app can find. The client rules here are UX only; the server remains authoritative
and refuses an unsanctioned move whatever the form offers.

#### Scenario: An active budget can be suspended or closed

- **GIVEN** an `ACTIVE` budget open for editing by a `BUDGET_MANAGE` user
- **THEN** the status picker offers `ACTIVE`, `INACTIVE` and `CLOSED`, and nothing else

#### Scenario: A rejected budget offers no status move

- **GIVEN** a `REJECTED` budget open for editing
- **THEN** no status move is offered, and the form states that a refused line is proposed again
  rather than revived

#### Scenario: A draft budget offers no status move

- **GIVEN** a `DRAFT` budget open for editing
- **THEN** no status move is offered, and the form states that the budget's plan is what puts it in
  force

#### Scenario: The list filter offers every declared status

- **WHEN** a user opens the budget list's status filter
- **THEN** `DRAFT`, `ACTIVE`, `INACTIVE`, `REJECTED` and `CLOSED` are all offered
