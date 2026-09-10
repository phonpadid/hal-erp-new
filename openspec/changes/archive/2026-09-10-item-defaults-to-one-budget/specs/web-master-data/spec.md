## MODIFIED Requirements

### Requirement: Enable or Disable for the Active Company

The web app SHALL let a `MASTER_MANAGE` user enable or disable a vendor or item for the active
company, and reflect the new state. Enabling makes the record usable on that company's documents;
disabling removes it from the enabled set.

For an enabled item, the user SHALL set the **budget** the item defaults to in the active company,
choosing ONE budget from a flat list of the open fiscal year's budgets — one row per budget, showing
the budget's name, the department that holds it and its plan code. Budgets that share a GL account
SHALL each be offered separately and SHALL each be recorded separately: the list SHALL NOT collapse,
group or summarize several budgets into one option, because the admin binds the budget they
recognise, not the account behind it. The GL account SHALL NOT be asked for; it follows from the
chosen budget and is shown beside it. The group item form carries no GL field.

The chosen budget SHALL be shown by its own name. A binding whose plan code the open fiscal year does
not carry SHALL remain visible and re-selectable, marked as outside the open year, so a set row never
reads as unset. An item carrying only a GL account and no binding SHALL show that account.

For an enabled vendor, the user MAY set a per-company payment-term days that overrides the group
vendor's terms. The UI SHALL show the effective value in use.

#### Scenario: Enabling makes a record usable

- **WHEN** the user enables a vendor for the active company
- **THEN** the vendor appears as enabled and is available to that company's document lines

#### Scenario: Disabling removes it from the enabled set

- **WHEN** the user disables an item for the active company
- **THEN** the item no longer shows as enabled for that company

#### Scenario: Budgets sharing an account are offered one by one

- **GIVEN** four budgets of the open fiscal year whose account is all `612.06`
- **WHEN** the user opens an item's budget picker
- **THEN** four separate rows are offered, each showing its budget name, department and plan code,
  and none of them is a group header or a summary of the others

#### Scenario: Set the per-company item budget

- **WHEN** the user picks the budget `6.107 Mail Express` for an item
- **THEN** that budget is saved as the item's per-company binding and the row then reads
  `Mail Express`, not the name of another budget on the same account

#### Scenario: A binding the open year does not carry stays visible

- **GIVEN** an item bound to a plan code no budget of the open fiscal year carries
- **WHEN** the user views that item's row
- **THEN** the binding is shown, marked as outside the open year, and can be replaced

#### Scenario: Set a per-company vendor payment term

- **WHEN** the user sets a vendor's payment-term days for the active company
- **THEN** the value is saved as `vendor_company.payment_term_days` and shown as the effective
  terms; clearing it falls back to the group vendor's terms

#### Scenario: The group item form has no GL field

- **WHEN** the user creates or edits a group item
- **THEN** no GL field is shown there; the budget is set only per company on the enablement row
