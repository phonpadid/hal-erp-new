# web-accounting

## MODIFIED Requirements

### Requirement: A Period's History Is Readable From The Screen

The periods screen SHALL offer, for each period, the log of what was done to it — every declare,
close and reopen with its actor, its moment and its reason — to viewers holding `PERIOD_VIEW`.

The log SHALL be fetched when it is opened rather than loaded for every period in the list.

#### Scenario: The reason a period was reopened is visible

- **GIVEN** a period that was reopened with a reason
- **WHEN** a user opens that period's history
- **THEN** the reopen is listed with its reason, its actor and its moment

#### Scenario: A declare is shown with the range it set

- **GIVEN** a period declared after declares began to be recorded
- **WHEN** a user opens its history
- **THEN** the declare is listed with the range it set

#### Scenario: History is fetched on open

- **WHEN** the periods list renders
- **THEN** no period's log has been requested
- **AND** opening one period's history requests only that period's log
