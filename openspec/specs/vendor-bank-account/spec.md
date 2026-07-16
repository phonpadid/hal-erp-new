# vendor-bank-account Specification

## Purpose
Vendor payee bank accounts: the destinations money can be sent to. A group-level vendor may
hold many accounts, each readable group-wide but mutable only under its own
`VENDOR_BANK_MANAGE` permission, with every change attributed so a redirected payee is
detectable after the fact.

## Requirements

### Requirement: Multiple Bank Accounts per Vendor

The system SHALL let a vendor hold many bank accounts in `vendor_bank_account`, each carrying `bank_code`, `account_no`, `account_name`, an optional `currency_id`, `is_primary`, and `is_active`, keyed to the group-level `vendor`. Because `vendor` is group-level, its accounts SHALL be readable by every company in the group (a GROUP-scope read under invariant 1) and SHALL NOT be writable across companies without `VENDOR_BANK_MANAGE`. At most one active account per vendor SHALL carry `is_primary`; setting a new primary SHALL clear the previous one in the same transaction. `account_no` SHALL be unique per `(vendor_id, bank_code)`.

#### Scenario: A vendor holds several accounts

- **GIVEN** a vendor with two active accounts at different banks
- **WHEN** the vendor's accounts are read
- **THEN** both are listed, exactly one marked primary

#### Scenario: Promoting a new primary demotes the old one

- **GIVEN** a vendor whose account A is primary
- **WHEN** account B is set primary
- **THEN** B is primary and A is not, atomically

#### Scenario: Duplicate account number at the same bank is rejected

- **WHEN** an account is added with a `bank_code` and `account_no` the vendor already has
- **THEN** the request is rejected

#### Scenario: Accounts are visible group-wide

- **GIVEN** an account added while company A is active
- **WHEN** a user in company B reads that vendor's accounts
- **THEN** the account is listed

### Requirement: Bank Accounts Are Gated by Their Own Permission

The system SHALL gate every create, update, primary-change, and deactivation of `vendor_bank_account` on the `VENDOR_BANK_MANAGE` permission code, distinct from `MASTER_MANAGE`. Holding `MASTER_MANAGE` alone SHALL NOT permit any mutation of a vendor's bank accounts, because redirecting a payee account requires no approval and leaves no document. Reading accounts SHALL require only `MASTER_VIEW`.

#### Scenario: Vendor editor cannot change bank accounts

- **GIVEN** a user with `MASTER_MANAGE` but not `VENDOR_BANK_MANAGE`
- **WHEN** they attempt to add or edit a vendor bank account
- **THEN** the request is denied

#### Scenario: Bank manager can change accounts

- **GIVEN** a user with `VENDOR_BANK_MANAGE`
- **WHEN** they add a vendor bank account
- **THEN** the account is created

#### Scenario: Reading accounts needs only view permission

- **GIVEN** a user with `MASTER_VIEW` and no manage permission
- **WHEN** they read a vendor's accounts
- **THEN** the accounts are returned

### Requirement: Bank Account Changes Are Recorded

The system SHALL record who changed a vendor bank account and when, capturing the actor, the timestamp, and the before/after values of `bank_code`, `account_no`, and `account_name`. `vendor_bank_account` is not an append-only ledger, so the record is what makes an edit-pay-revert sequence detectable after the fact.

#### Scenario: Editing an account number is attributable

- **WHEN** a `VENDOR_BANK_MANAGE` user changes an account number
- **THEN** the actor, the time, and both the old and new account numbers are recorded

#### Scenario: Deactivation is recorded

- **WHEN** an account is deactivated
- **THEN** the actor and time are recorded

### Requirement: Deactivated Accounts Cannot Be Newly Selected

The system SHALL exclude accounts whose `is_active` is false from selection on new documents, while continuing to expose them for reading so historical documents and batches remain legible. Deactivating an account SHALL NOT alter any document that already references it.

#### Scenario: Inactive accounts are not offered

- **WHEN** a payee account is chosen for a new document
- **THEN** only active accounts of that vendor are selectable

#### Scenario: History survives deactivation

- **GIVEN** an approved document referencing account A
- **WHEN** account A is deactivated
- **THEN** the document still reports account A as its payee

### Requirement: An Account's Change History Is Readable

The system SHALL expose an account's recorded changes — actor, timestamp, action, and the before/after values of `bank_code`, `account_no`, and `account_name` — to a `VENDOR_BANK_MANAGE` user, newest first, for a given `vendor_bank_account`. The rows already exist in `vendor_bank_account_log`; without a read they are written and never seen, which makes the log a deterrent only in theory.

The read SHALL be gated on `VENDOR_BANK_MANAGE` rather than `MASTER_VIEW`: who redirected a payee, and to where, is more sensitive than the account list itself. The history SHALL include changes to accounts that were later deactivated, because a retired account is exactly where a covering edit would hide.

#### Scenario: The history of an edited account

- **GIVEN** an account whose number was changed
- **WHEN** a `VENDOR_BANK_MANAGE` user reads its history
- **THEN** the actor, the time, and the before/after account numbers are returned

#### Scenario: Newest first

- **GIVEN** an account changed twice
- **WHEN** its history is read
- **THEN** the most recent change is first

#### Scenario: A deactivated account still has a history

- **GIVEN** an account that was edited and then deactivated
- **WHEN** its history is read
- **THEN** both the edit and the deactivation are returned

#### Scenario: Reading the history needs the bank permission

- **GIVEN** a user with `MASTER_VIEW` but not `VENDOR_BANK_MANAGE`
- **WHEN** they read an account's history
- **THEN** the request is denied

#### Scenario: An unknown account is not found

- **WHEN** the history of an account that does not exist is read
- **THEN** the request is rejected as not found

### Requirement: The Vendor Registry Says Which Vendors Have No Account

The system SHALL annotate each row of the vendor registry read with whether that vendor has any active bank account. A vendor without one cannot have a `requires_payee` document submitted against it, so the registry — where someone goes looking for the reason — SHALL be able to say so without a further request per row. The annotation SHALL be derived per page in one query and SHALL NOT be persisted.

#### Scenario: A vendor with an active account is marked as having one

- **GIVEN** a vendor with one active bank account
- **WHEN** the vendor registry is read
- **THEN** that row reports it has a bank account

#### Scenario: A vendor whose only account is deactivated is marked as having none

- **GIVEN** a vendor whose single account is inactive
- **WHEN** the vendor registry is read
- **THEN** that row reports it has no bank account, because an inactive account cannot be a payee

#### Scenario: The annotation costs one query per page

- **WHEN** a page of vendors is read
- **THEN** the annotation is resolved for the whole page at once, not per row
