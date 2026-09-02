# web-accounting

## REMOVED Requirements

### Requirement: Declaring a Period Names the Fiscal-Year Permission It Needs

**Reason**: the permission gap it described is closed. Declaring a period no longer needs
`FISCAL_YEAR_MANAGE`, so a screen that explains why the list is unavailable has nothing to explain.
Replaced by *Declaring a Period Offers the Years It Can Be Declared Into*, which covers the case
that remains — a company with no open fiscal year.

## ADDED Requirements

### Requirement: Declaring a Period Offers the Years It Can Be Declared Into

The declare dialog SHALL offer the active company's open fiscal years, read on the period-management
code, and SHALL NOT require the organisation's fiscal-year code to be usable.

When the company has no open fiscal year, the dialog SHALL say so rather than presenting an empty
selector.

#### Scenario: A period manager can declare without the organisation code

- **GIVEN** a user holding `PERIOD_MANAGE` and not `FISCAL_YEAR_MANAGE`
- **WHEN** they open the declare dialog
- **THEN** the open fiscal years are selectable and the period can be declared

#### Scenario: No open fiscal year is stated, not shown as an empty list

- **GIVEN** a company with no open fiscal year
- **WHEN** the declare dialog is opened
- **THEN** it states that there is no open fiscal year, and no empty selector is presented

### Requirement: A Period's History Is Readable From The Screen

The periods screen SHALL offer, for each period, the log of what was done to it — every close and
reopen with its actor, its moment and its reason — to viewers holding `PERIOD_VIEW`.

The log SHALL be fetched when it is opened rather than loaded for every period in the list.

#### Scenario: The reason a period was reopened is visible

- **GIVEN** a period that was reopened with a reason
- **WHEN** a user opens that period's history
- **THEN** the reopen is listed with its reason, its actor and its moment

#### Scenario: History is fetched on open

- **WHEN** the periods list renders
- **THEN** no period's log has been requested
- **AND** opening one period's history requests only that period's log
