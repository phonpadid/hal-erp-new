# web-budgets

## MODIFIED Requirements

### Requirement: Budget Ledger View

The web app SHALL show a budget's append-only ledger entries (transaction type, amount, source
document, remark, timestamp), most recent first, as a read-only history. Entries linked to a
source document SHALL link through to it. Amounts SHALL be formatted to the company base
currency's `decimal_places` and never carried as a JS number.

Each entry SHALL be presented in the direction it moves the available balance, and there SHALL be
three such directions, because the balance formula sorts the transaction types three ways: those
that add to the balance, those that subtract from it, and the settlement that changes it by nothing
at all. A settlement converts money an earlier reservation already removed from the available
balance into money recorded as spent; presenting it as a withdrawal charges the budget twice for one
document, which is the arithmetic invariant 3 forbids.

A settlement entry SHALL therefore carry no positive or negative sign and SHALL NOT reuse the visual
treatment given to entries that reduce the balance. It SHALL remain distinguishable from an entry
whose amount is absent or unknown: showing nothing where the other rows show a direction states that
the value is missing, when what is true is that the balance did not move.

The direction of each transaction type SHALL be derived from the same definition the balance
computation uses, rather than restated for display. A classification kept in two places is free to
disagree with itself, and the reader has no way to tell which copy is authoritative.

**The rendered ledger SHALL reconcile to the balance it explains.** Summing the entries in the
direction each is shown, over a budget's complete ledger, SHALL equal that budget's available
balance minus its appropriated total. This is the arithmetic a reader performs when checking a
history against a summary, and stating it makes the two halves of the screen answerable to each
other.

#### Scenario: Ledger shows the transactions behind the balance

- **WHEN** the user views a budget that has had a reservation settled
- **THEN** the RESERVE / ACTUAL / RELEASE entries are listed with their amounts

#### Scenario: A settled document is deducted once, not twice

- **GIVEN** a budget with one document that reserved an amount and was then settled for it in full
- **WHEN** the ledger is shown
- **THEN** the reservation is shown as reducing the balance and the settlement is not, so the two
  entries together account for the amount once

#### Scenario: The ledger reconciles to the available balance

- **GIVEN** a budget with reservations, settlements and releases in its history
- **WHEN** the entries are summed in the directions the ledger shows them
- **THEN** the total equals the available balance minus the appropriated total

#### Scenario: A settlement is legible as a settlement

- **WHEN** a settlement entry is shown
- **THEN** it carries no `+` or `−`, is not styled as an entry that reduces the balance, and remains
  distinguishable from an entry with no amount

#### Scenario: Ledger amounts honor the currency decimal places

- **WHEN** the ledger is shown for a budget whose base currency has 0 decimal places
- **THEN** each entry amount is formatted with 0 decimal places
