## ADDED Requirements

### Requirement: A Submit Refused For An Unresolvable Account Names The Line And Where To Set One

When a submit is refused because a line resolves no expense account, the screen SHALL name the line
and SHALL say that an account may be set on the item, on the document type, or on the budget.

Naming only the budget sends the reader to one of three places, and usually the wrong one: a line
with an item takes its account from the item and never reads the budget at all. Which of the three
to fill in depends on what the line is, so the refusal has to offer all three rather than choose.

The refusal SHALL be surfaced with the existing refusal treatment, so it stays readable rather than
passing as a toast, and SHALL NOT be reported as a missing form field — no field on the form carries
this value, and sending the requester back into the wizard is a dead end.

Where the requester cannot set any of the three themselves, the refusal SHALL say which permission
can, rather than instructing them to perform an action their permissions forbid.

#### Scenario: The refusal names the line and the three sources

- **GIVEN** a draft whose line 1 resolves no account
- **WHEN** the requester submits it
- **THEN** the screen shows the refusal naming line 1 and the item, document type and budget as the
  places an account can be set

#### Scenario: The refusal outlives a toast

- **GIVEN** the refusal above
- **WHEN** the requester waits and looks back at the screen
- **THEN** the reason is still readable

#### Scenario: The refusal is not dressed as a missing field

- **WHEN** a submit is refused because a line resolves no account
- **THEN** no completeness prompt claims a form field is missing, and no action offers to reopen the
  wizard to fill one in

## REMOVED Requirements

### Requirement: A Submit Refused For An Unmapped Budget Says Which Budget, And Who Can Fix It

Removed because the refusal it specifies is no longer raised. `document-engine` stops refusing a
submit for a budget that names no GL account and refuses a LINE that resolves none, so a screen
specified to name the budget and the `BUDGET_MANAGE` holder who can fix it describes a message the
server never sends. Replaced by `A Submit Refused For An Unresolvable Account Names The Line And
Where To Set One`, which keeps both properties this one was written for — the reason outlives a
toast, and it is never dressed as a missing form field — while naming the line and all three places
an account can come from.
