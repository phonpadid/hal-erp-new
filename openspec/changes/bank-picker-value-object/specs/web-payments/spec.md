## MODIFIED Requirements

### Requirement: Bank Accounts Are Configurable From The App

The web app SHALL provide a screen for the company's own bank accounts — listing them with the GL
account each one's balance lives in, creating one against an account of the same company, and
deactivating one — gated by `BANK_ACCOUNT_VIEW` for reading and `BANK_ACCOUNT_MANAGE` for the rest.

Deactivation SHALL be offered rather than deletion, because payments point at these rows.

The bank SHALL be chosen from the app's bank catalog rather than typed, and `bank_account.bank_name`
SHALL be the chosen entry's name — the accounts list and the reconciliation screen show this value
as the bank's name, and typed text makes one bank read as several. Both the picker and the accounts list
SHALL show each bank's logo beside its name, since a logo is recognised at a glance where a name
has to be read. A stored `bank_name` that no catalog entry matches SHALL stay selected and
re-savable, rendered as its raw text without a logo, so that an account recorded before the catalog
existed does not silently change bank when it is edited.

#### Scenario: A reader sees the accounts without the management controls

- **GIVEN** a user holding `BANK_ACCOUNT_VIEW` without `BANK_ACCOUNT_MANAGE`
- **WHEN** the screen renders
- **THEN** the accounts are listed and no create or deactivate control is offered

#### Scenario: An account is created against a GL account

- **GIVEN** a user holding `BANK_ACCOUNT_MANAGE`
- **WHEN** they create a bank account naming a GL account
- **THEN** it is created and listed with that account

#### Scenario: The bank cannot be typed

- **WHEN** a `BANK_ACCOUNT_MANAGE` user opens the create form
- **THEN** the bank is offered as a picker over the catalog, showing each bank's logo and name, and no free-text bank input is present

#### Scenario: The list shows each account's bank logo

- **WHEN** a `BANK_ACCOUNT_VIEW` user reads the accounts list
- **THEN** each account whose bank is in the catalog shows that bank's logo beside its name, and one whose bank is not shows the stored text alone

#### Scenario: The chosen bank is sent as its name

- **WHEN** the user picks a bank from the catalog and saves
- **THEN** the request carries that entry's name as `bankName`, a single string, in the same shape the server already accepts

#### Scenario: The form cannot be saved without a bank

- **WHEN** the user submits the create form with no bank chosen
- **THEN** the save is refused and nothing is sent to the server
