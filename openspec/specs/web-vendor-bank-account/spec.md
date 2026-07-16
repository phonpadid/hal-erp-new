# web-vendor-bank-account Specification

## Purpose
The web surface for a vendor's payee bank accounts, reached from the vendor registry: listing
the group-level accounts a vendor can be paid to, adding and editing them, promoting a primary,
retiring one with its consequences stated, and reading who changed an account and to what. Every
mutation and the change history are gated on `VENDOR_BANK_MANAGE` rather than `MASTER_MANAGE`,
because redirecting a payee needs no approval and leaves no document behind.

## Requirements

### Requirement: Vendor Bank Accounts Are Reachable and Readable

The web app SHALL show a `MASTER_VIEW` user a vendor's bank accounts from the vendor registry, listing each account's bank, account number, account name, and whether it is the vendor's primary. Accounts belong to the group-level vendor, so the list SHALL show the same accounts in every company of the group and SHALL NOT imply they are per-company. A retired account SHALL remain listed, visibly inactive, rather than hidden — a document or an exported batch may still name it, and a user who reads one must be able to find the account it names. An account number SHALL be rendered as text, never as a number or a right-aligned quantity, since a leading zero is part of the identifier.

#### Scenario: A vendor's accounts are listed

- **WHEN** a `MASTER_VIEW` user opens a vendor's bank accounts
- **THEN** each account is listed with its bank, account number, account name, and primary state

#### Scenario: A retired account stays visible

- **GIVEN** a vendor with one deactivated account
- **WHEN** the accounts are listed
- **THEN** the deactivated account is shown and marked inactive rather than omitted

#### Scenario: An account number keeps its leading zeros

- **GIVEN** an account numbered `000123`
- **WHEN** it is listed
- **THEN** it reads `000123`, not `123`

#### Scenario: A vendor with no accounts says so

- **WHEN** a vendor with no bank accounts is opened
- **THEN** an empty state is shown, stating that a disbursement for this vendor cannot be submitted until an account exists

### Requirement: Every Mutation Is Gated by VENDOR_BANK_MANAGE

The web app SHALL show the add, edit, make-primary, and deactivate affordances only to a user holding `VENDOR_BANK_MANAGE`, and SHALL NOT show them to a user holding only `MASTER_MANAGE`. The affordances SHALL be absent rather than present-and-disabled, because a control that exists but refuses reads as a defect rather than a boundary. This mirrors the server, which gates the same operations on the same code; the client guard is UX only and the server remains authoritative.

#### Scenario: A vendor editor sees accounts read-only

- **GIVEN** a user with `MASTER_VIEW` and `MASTER_MANAGE` but not `VENDOR_BANK_MANAGE`
- **WHEN** they open a vendor's bank accounts
- **THEN** the accounts are listed and no add, edit, make-primary, or deactivate control is shown

#### Scenario: A bank manager sees the full surface

- **GIVEN** a user with `VENDOR_BANK_MANAGE`
- **WHEN** they open a vendor's bank accounts
- **THEN** add, edit, make-primary, and deactivate are available

### Requirement: Add and Edit an Account

The web app SHALL let a `VENDOR_BANK_MANAGE` user add an account with a bank code, account number, account name, and an optional currency, and edit those fields on an existing account. The account number SHALL use a text input, never a numeric one. Validation SHALL mirror the backend DTO so the client refuses what the server would refuse, and a duplicate account number at the same bank SHALL surface as a conflict naming the clash rather than a generic failure. The form SHALL NOT offer the primary flag as a field — promoting is its own action, because the server demotes the previous primary atomically and a form field would imply two accounts could be primary between saves.

#### Scenario: A valid account is added

- **WHEN** a `VENDOR_BANK_MANAGE` user submits a complete account
- **THEN** it is created and appears in the list

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

### Requirement: Promote a Primary

The web app SHALL let a `VENDOR_BANK_MANAGE` user make an active account the vendor's primary, and SHALL reflect that exactly one account is primary afterwards. The primary SHALL be visually distinguished, because it is the account a disbursement's payee picker preselects and the choice therefore has to be legible here rather than discovered on a document form. An inactive account SHALL NOT be promotable.

#### Scenario: Promoting one demotes the other

- **GIVEN** a vendor whose account A is primary
- **WHEN** the user makes account B primary
- **THEN** B is shown as primary and A is not

#### Scenario: An inactive account cannot be promoted

- **WHEN** the user views a deactivated account
- **THEN** no make-primary action is offered for it

### Requirement: Deactivate an Account and Say What It Costs

The web app SHALL let a `VENDOR_BANK_MANAGE` user deactivate an account, after stating that it cannot be undone from this screen and that documents already naming it are unaffected. There SHALL be no delete. When the account being deactivated is the vendor's primary, the app SHALL warn that the vendor will be left with no primary and the next disbursement for that vendor will preselect nothing — the person who deactivates it is not the person who discovers that.

#### Scenario: Deactivating retires the account

- **WHEN** a `VENDOR_BANK_MANAGE` user deactivates an account
- **THEN** it is shown as inactive and is no longer selectable as a payee

#### Scenario: Deactivating the primary warns first

- **GIVEN** the vendor's primary account
- **WHEN** the user deactivates it
- **THEN** the app warns that the vendor will have no primary and that the next disbursement will preselect no payee

#### Scenario: No delete is offered

- **WHEN** the user views any account
- **THEN** no delete action is shown

### Requirement: The Change History Is Visible Beside the Account

The web app SHALL show a `VENDOR_BANK_MANAGE` user the history of an account — who changed it, when, and the before and after of its bank code, account number, and account name — from the account itself. `vendor_bank_account` is not an append-only ledger, so an account edited to an attacker's number, paid, and edited back looks untouched afterwards; the history is the only thing that shows it, and beside the account it is found while the change is still reversible rather than after the money has gone. The history SHALL be gated on `VENDOR_BANK_MANAGE` rather than `MASTER_VIEW`, since reading who redirected a payee is itself sensitive.

#### Scenario: An edit is attributable

- **GIVEN** an account whose number was changed
- **WHEN** a `VENDOR_BANK_MANAGE` user opens its history
- **THEN** the actor, the time, and both the old and new account numbers are shown

#### Scenario: An edit-pay-revert is legible

- **GIVEN** an account changed to another number and then changed back
- **WHEN** the history is read
- **THEN** both changes are listed in order, so the round trip is visible even though the account now reads as it originally did

#### Scenario: History is hidden without the permission

- **GIVEN** a user with `MASTER_VIEW` but not `VENDOR_BANK_MANAGE`
- **WHEN** they open an account
- **THEN** no history is shown
