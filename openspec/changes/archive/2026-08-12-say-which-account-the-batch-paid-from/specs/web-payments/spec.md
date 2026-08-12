# web-payments

## ADDED Requirements

### Requirement: Bank Accounts Are Configurable From The App

The web app SHALL provide a screen for the company's own bank accounts — listing them with the GL
account each one's balance lives in, creating one against an account of the same company, and
deactivating one — gated by `BANK_ACCOUNT_VIEW` for reading and `BANK_ACCOUNT_MANAGE` for the rest.

Deactivation SHALL be offered rather than deletion, because payments point at these rows.

#### Scenario: A reader sees the accounts without the management controls

- **GIVEN** a user holding `BANK_ACCOUNT_VIEW` without `BANK_ACCOUNT_MANAGE`
- **WHEN** the screen renders
- **THEN** the accounts are listed and no create or deactivate control is offered

#### Scenario: An account is created against a GL account

- **GIVEN** a user holding `BANK_ACCOUNT_MANAGE`
- **WHEN** they create a bank account naming a GL account
- **THEN** it is created and listed with that account
