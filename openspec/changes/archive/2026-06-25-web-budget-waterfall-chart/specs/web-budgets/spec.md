## ADDED Requirements

### Requirement: Budget Balance Waterfall Chart

The web app SHALL present the derived budget balance breakdown — the same
components as the Budget Balance Breakdown (total, adjustments in/out, transfers
in/out, reserved, actual, released, and the resulting available) — as a
floating-bars waterfall chart on the budget detail screen, in addition to the
numeric breakdown. The chart SHALL be a presentational view of the already-derived
figures: it MUST NOT read or display any stored usage value on the budget, MUST
derive each floating bar from the breakdown figures in the order total +
adjustIncrease − adjustDecrease + transferIn − transferOut − reserved − actual +
released, and MUST reconcile to the same available balance as the numeric
breakdown. Each bar SHALL float between the prior running balance and the new
running balance; the final available bar SHALL be grounded at zero as the result.
Increasing and decreasing movements SHALL be visually distinguished using PrimeUI
theme tokens (no hardcoded colors, so light and dark mode both render correctly).
All amounts in axis ticks and tooltips SHALL be formatted to the company base
currency's `decimal_places`, and SHALL NOT be carried as a JS number on the wire;
numeric values are parsed from the DECIMAL strings only to compute chart geometry.
The chart SHALL be gated by the `BUDGET_VIEW` permission and the active-company
context (client-side UX only; the server remains authoritative and
company-scoped).

#### Scenario: Waterfall shows how the budget travelled to available

- **GIVEN** a budget with amountTotal 1,000,000 and no movements
- **WHEN** a `BUDGET_VIEW` user opens the budget detail
- **THEN** the waterfall renders a starting bar at the total and a final available bar equal to 1,000,000
- **AND** the final available bar equals the numeric breakdown's available balance

#### Scenario: Each movement is a floating step that reconciles to available

- **GIVEN** a budget with amountTotal 1,000,000, reserved 100,000, and released 40,000
- **WHEN** the waterfall is shown
- **THEN** the reserved step floats downward by 100,000 from the running balance and the released step floats upward by 40,000
- **AND** the final available bar equals 940,000, matching the numeric breakdown

#### Scenario: Increases and decreases are visually distinguished

- **GIVEN** a budget with both an adjustIncrease and a reserved amount
- **WHEN** the waterfall is shown
- **THEN** the increasing step and the decreasing step use distinct PrimeUI theme tokens
- **AND** no hardcoded color is used, so the chart is legible in both light and dark mode

#### Scenario: Chart amounts honor the currency decimal places

- **GIVEN** the company base currency has 0 decimal places
- **WHEN** the waterfall axis ticks and a step tooltip are shown
- **THEN** each amount is formatted with 0 decimal places, not a hardcoded 2
- **AND** no amount is carried as a JS number on the wire

#### Scenario: Chart is hidden without the view permission

- **GIVEN** a user without the `BUDGET_VIEW` permission for the active company
- **WHEN** the budget detail screen is requested
- **THEN** the waterfall chart is not shown (and the server still does not return the budget)
