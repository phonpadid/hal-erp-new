## MODIFIED Requirements

### Requirement: Balance Sheet

The system SHALL expose a read-only balance sheet as of a date (`journal_entry.entry_date` ≤ `asOf`):
assets (Σ debit − credit over ASSET), liabilities (Σ credit − debit over LIABILITY), equity (Σ credit
− debit over EQUITY), and retained earnings derived as the net income to that date. The report SHALL
include the balance check `assets = liabilities + equity + retained earnings` and MUST NOT mutate any
ledger; it SHALL be company-scoped and `GL_VIEW`-gated.

The derived figure covers whatever revenue and expense still stand. A fiscal year that has been
closed rolled its result into the `RETAINED_EARNINGS` equity account and left its revenue and expense
at zero (see `accounting-period`'s `Closing The Year's Final Period Closes The Year`), so the derived
figure narrows by itself to the periods still open, and the closed years are carried by the equity
total. **The arithmetic is unchanged by year-end closing; only what it means narrows.**

The report SHALL additionally state the `RETAINED_EARNINGS` account's own balance separately, so a
reader can distinguish profit retained from prior years from profit earned so far in the current
one. A single combined number cannot tell them apart, and that ambiguity is what the report carried
while no close existed.

#### Scenario: Assets equal liabilities plus equity plus retained earnings

- **GIVEN** a company whose ledger to date has assets 104000, liabilities 4000, equity 0, and a
  net income of 100000 in periods that are still open
- **WHEN** the balance sheet is requested as of that date
- **THEN** it reports assets 104000, liabilities 4000, equity 0, retained earnings 100000, and the
  balance check holds (104000 = 4000 + 0 + 100000)

#### Scenario: A closed year's result is carried by equity, not derived

- **GIVEN** a company whose first fiscal year closed with a result of 200000, and whose current year
  has earned 50000 so far
- **WHEN** the balance sheet is requested
- **THEN** the `RETAINED_EARNINGS` account carries 200000 within the equity total, the derived
  retained earnings is 50000, and the balance check still holds

#### Scenario: Brought forward and current period are distinguishable

- **WHEN** the balance sheet is requested for a company with at least one closed year
- **THEN** it reports the retained-earnings account balance brought forward beside the current
  period's derived figure, rather than one number standing for both
