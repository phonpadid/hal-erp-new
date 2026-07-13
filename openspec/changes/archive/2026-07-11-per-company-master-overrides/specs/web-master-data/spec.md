## MODIFIED Requirements

### Requirement: Enable or Disable for the Active Company

The web app SHALL let a `MASTER_MANAGE` user enable or disable a vendor or item for the active
company, and reflect the new state. Enabling makes the record usable on that company's documents;
disabling removes it from the enabled set. For an enabled item, the user SHALL set the item's GL
account for the active company from that company's postable accounts (a picker labelled
name + code, mirroring the budget picker; validated server-side); the group item form no longer
carries a GL field. For an enabled vendor, the user MAY set a per-company payment-term days that
overrides the group vendor's terms. The UI SHALL show the effective value in use.

#### Scenario: Enabling makes a record usable

- **WHEN** the user enables a vendor for the active company
- **THEN** the vendor appears as enabled and is available to that company's document lines

#### Scenario: Disabling removes it from the enabled set

- **WHEN** the user disables an item for the active company
- **THEN** the item no longer shows as enabled for that company

#### Scenario: Set the per-company item GL from the chart

- **WHEN** the user sets an item's GL for the active company from the postable-account picker
- **THEN** the chosen account's code is saved as `item_company.default_gl_account` and shown as
  the item's GL for that company

#### Scenario: Set a per-company vendor payment term

- **WHEN** the user sets a vendor's payment-term days for the active company
- **THEN** the value is saved as `vendor_company.payment_term_days` and shown as the effective
  terms; clearing it falls back to the group vendor's terms

#### Scenario: The group item form has no GL field

- **WHEN** the user creates or edits a group item
- **THEN** no GL field is shown there; the GL is set only per company on the enablement row
