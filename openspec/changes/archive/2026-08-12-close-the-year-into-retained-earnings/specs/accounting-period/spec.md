## ADDED Requirements

### Requirement: Closing The Year's Final Period Closes The Year

When the period being closed ends on its fiscal year's last day, the system SHALL additionally close
the year: post one balanced closing entry dated that day, and set `fiscal_year.status` to `CLOSED`.
Both SHALL happen **before** the period's own status is set, and both SHALL be part of the same
operation.

The ordering is not a convenience. A closing entry belongs on the year's last day, which falls inside
the period being closed; posting it after that period is closed would be refused by the guard in
`gl-journal`'s `Every Entry Is Written Through One Balanced Constructor`, correctly, because that is
what the guard exists to prevent. Closing the year while its final period is still open is the only
placement that needs no exception — and it makes a year that is left un-closed while all its months
are closed impossible rather than merely unlikely.

The closing entry SHALL debit every revenue account carrying a credit balance for that balance,
credit every expense account carrying a debit balance for that balance, and post the difference to
`RETAINED_EARNINGS`, so the year's revenue and expense begin the next year at zero and its result
stands in equity as a balance rather than as a derivation. Accounts with no activity in the year
SHALL contribute no line.

The entry SHALL be keyed to the fiscal year, so it cannot be posted twice however often the close is
retried. The closing entry SHALL write no `budget_txn` (invariants 3 and 6): a year's result is
accounting, not budget.

A company that has declared no accounting periods has no final period, and SHALL therefore get no
closing entry and no automatic year close. Its fiscal year keeps whatever status it is given
directly, which posts nothing — the behaviour it has today.

A closed year SHALL NOT be reopened by this capability. Unwinding a closing entry means reversing it
and restating every later year's opening position, which is a deliberate operation and not the
inverse of a period reopen.

#### Scenario: Closing December closes the year

- **GIVEN** a fiscal year whose periods are all closed but the last, which ends on the year's final
  day
- **WHEN** that period is closed
- **THEN** a closing entry dated the year's last day exists, and the fiscal year's status is `CLOSED`

#### Scenario: Revenue and expense start the next year at zero

- **GIVEN** a year holding revenue of 500,000 and expense of 300,000
- **WHEN** its final period is closed
- **THEN** the entry debits revenue 500,000, credits expense 300,000, and credits
  `RETAINED_EARNINGS` 200,000

#### Scenario: A loss is closed the same way

- **GIVEN** a year holding revenue of 100,000 and expense of 180,000
- **WHEN** its final period is closed
- **THEN** the entry debits revenue 100,000, credits expense 180,000, and debits
  `RETAINED_EARNINGS` 80,000

#### Scenario: Closing a period that is not the year's last does not close the year

- **WHEN** a period ending before the fiscal year's last day is closed
- **THEN** no closing entry is written and the fiscal year stays `OPEN`

#### Scenario: A year with no activity closes without an entry

- **GIVEN** a fiscal year whose revenue and expense accounts carry no balance
- **WHEN** its final period is closed
- **THEN** the year is closed and no closing entry is written

#### Scenario: The year is closed once

- **GIVEN** a final period that was closed, reopened and closed again
- **WHEN** the second close runs
- **THEN** exactly one closing entry exists for that fiscal year

#### Scenario: An unmapped RETAINED_EARNINGS refuses the close

- **GIVEN** a company with a year to close and no account mapped to `RETAINED_EARNINGS`
- **THEN** closing the final period is rejected naming the role, and neither the period nor the year
  is closed

#### Scenario: A company with no periods is unaffected

- **GIVEN** a company that has declared no accounting periods
- **WHEN** its fiscal year is closed directly
- **THEN** the status changes and no closing entry is written, exactly as before
