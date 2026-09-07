## ADDED Requirements

### Requirement: A Submit Refused For An Unmapped Budget Says Which Budget, And Who Can Fix It

When a submit is refused because a charged budget names no GL account, the screen SHALL show the
budget by its code and name, and SHALL say that the account is set on the budget by a holder of
`BUDGET_MANAGE`.

The requester is almost never that holder. A message that says only *"set the GL account"* asks
someone to perform an action their permissions forbid, on a screen they cannot open — so the refusal
must name the thing to be fixed **and** the fact that fixing it is somebody else's to do, or the
requester's only remaining move is to guess.

The refusal SHALL be surfaced with the existing refusal treatment, so it stays readable rather than
passing as a toast, and SHALL NOT be reported as a missing form field: no field on the form carries
this value and sending the requester back into the wizard to fill one in is a dead end.

#### Scenario: The refusal names the budget

- **GIVEN** a draft whose line charges a budget on node `1.101` with no GL account
- **WHEN** the requester submits it
- **THEN** the screen shows the refusal naming `1.101` and its name, and says the GL account is set
  on the budget by a `BUDGET_MANAGE` holder

#### Scenario: The refusal outlives a toast

- **GIVEN** the refusal above
- **WHEN** the requester waits and looks back at the screen
- **THEN** the reason is still readable

#### Scenario: The refusal is not dressed as a missing field

- **WHEN** a submit is refused because a charged budget names no GL account
- **THEN** no completeness prompt claims a form field is missing, and no action offers to reopen the
  wizard to fill one in
