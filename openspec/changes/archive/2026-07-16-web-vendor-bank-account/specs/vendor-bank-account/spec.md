## ADDED Requirements

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
