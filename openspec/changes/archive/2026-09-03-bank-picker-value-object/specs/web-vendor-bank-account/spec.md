## MODIFIED Requirements

### Requirement: Add and Edit an Account

The web app SHALL let a `VENDOR_BANK_MANAGE` user add an account with a bank, account number, account name, and an optional currency, and edit those fields on an existing account. The bank SHALL be chosen from the app's bank catalog rather than typed, and the account's `bank_code` SHALL be the chosen entry's code — a typed bank defeats the `(vendor_id, bank_code, account_no)` uniqueness that stops the same payee account being entered twice, and `payment_batch_line.bank_code` snapshots this value for the bank to read. The currency SHALL likewise be chosen from the active currencies rather than typed, and SHALL remain optional. The account number SHALL use a text input, never a numeric one. Validation SHALL mirror the backend DTO so the client refuses what the server would refuse, and a duplicate account number at the same bank SHALL surface as a conflict naming the clash rather than a generic failure. The form SHALL NOT offer the primary flag as a field — promoting is its own action, because the server demotes the previous primary atomically and a form field would imply two accounts could be primary between saves.

#### Scenario: A valid account is added

- **WHEN** a `VENDOR_BANK_MANAGE` user submits a complete account
- **THEN** it is created and appears in the list

#### Scenario: The list shows each account's bank logo

- **WHEN** a `MASTER_VIEW` user reads a vendor's accounts
- **THEN** each account whose bank is in the catalog shows that bank's logo beside its bank code and account number, and the account number still reads in full

#### Scenario: The bank cannot be typed

- **WHEN** the user opens the add or edit form
- **THEN** the bank is offered as a picker over the catalog, showing each bank's logo and name, and no free-text bank input is present

#### Scenario: The chosen bank is sent as its code

- **WHEN** the user picks a bank from the catalog and saves
- **THEN** the request carries that entry's code as `bankCode`, a single string, in the same shape the server already accepts

#### Scenario: The currency cannot be typed

- **WHEN** the user opens the add or edit form
- **THEN** the currency is offered as a picker over the active currencies, and no free-text currency input is present

#### Scenario: An account may be saved with no currency

- **WHEN** the user saves an account without choosing a currency
- **THEN** the account is created and no currency is sent

#### Scenario: A required field blocks the save

- **WHEN** the user submits the form with the account number empty
- **THEN** a validation error is shown and nothing is sent to the server

#### Scenario: A duplicate is explained

- **GIVEN** the vendor already has account `0001` at bank `BCEL`
- **WHEN** the user adds `0001` at `BCEL` again
- **THEN** the conflict is reported naming that bank and account, not as a generic error

#### Scenario: The form has no primary field

- **WHEN** the user opens the add or edit form
- **THEN** no primary toggle is shown

## ADDED Requirements

### Requirement: A Stored Bank Outside the Catalog Survives an Edit

The web app SHALL keep an existing account's stored `bank_code` selected and re-savable when no catalog entry matches it, rendering it as its raw text without a logo. Editing such an account SHALL NOT change its bank unless the user picks a different one. Accounts were recorded before the catalog existed, and a picker that renders an unmatched value as blank would silently rewrite the bank of an account opened to correct a digit. The unmatched value SHALL NOT be offered when adding a new account.

#### Scenario: An unmatched bank shows no logo

- **GIVEN** an account whose stored bank code is not in the catalog
- **WHEN** the accounts are listed
- **THEN** the stored text is shown with no logo, so a value outside the catalog reads as one

#### Scenario: An unmatched bank stays selected

- **GIVEN** an account whose stored bank code is not in the catalog
- **WHEN** a `VENDOR_BANK_MANAGE` user opens it for editing
- **THEN** the bank picker shows that stored value rather than an empty selection

#### Scenario: Editing another field leaves the unmatched bank intact

- **GIVEN** an account whose stored bank code is not in the catalog
- **WHEN** the user changes only the account number and saves
- **THEN** the request carries the original bank code unchanged

#### Scenario: The unmatched value is not offered to new accounts

- **WHEN** the user opens the form to add an account
- **THEN** the picker offers only catalog entries
