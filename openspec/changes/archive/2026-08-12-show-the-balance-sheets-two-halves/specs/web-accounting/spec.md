# web-accounting

## ADDED Requirements

### Requirement: Balance Sheet Distinguishes Retained Earnings Brought Forward from the Current Period

The balance sheet screen SHALL render both retained-earnings figures the server returns — the
brought-forward balance that closed fiscal years rolled into the equity account
(`retainedEarningsBroughtForward`) and the current period's derived result (`retainedEarnings`) —
and SHALL indicate that the brought-forward figure is already included in the equity rows above it,
so that a reader does not add it to the reported total a second time.

The screen SHALL NOT recompute any total; `liabilitiesEquityTotal` and `balanced` are taken from the
server as returned. Amounts SHALL be formatted with the base currency's `decimal_places` and never
carried as a JS number.

#### Scenario: A company that has closed a year sees both halves

- **GIVEN** a company whose prior fiscal year was closed into retained earnings
- **WHEN** the user opens the balance sheet
- **THEN** the brought-forward figure is shown, labelled as brought forward and marked as already
  counted in the equity rows
- **AND** the current period's figure is shown separately

#### Scenario: A company that has never closed a year sees a zero brought forward

- **GIVEN** a company with no closed fiscal year
- **WHEN** the user opens the balance sheet
- **THEN** the brought-forward figure is shown as zero rather than hidden

#### Scenario: The explanatory note does not claim a close has or has not happened

- **WHEN** the user opens the balance sheet
- **THEN** the note distinguishes the two figures and their relationship to the equity total
- **AND** it makes no claim about whether a period or year close has occurred
