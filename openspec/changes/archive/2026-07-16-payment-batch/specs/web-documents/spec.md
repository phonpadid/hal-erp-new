## ADDED Requirements

### Requirement: Payee Account Selector on Types That Require One

The web app SHALL show a payee bank account selector on the document form only when the document type's `requires_payee` is `true`, listing the active accounts of the document's selected vendor and defaulting to the vendor's primary account. The selector SHALL be disabled until a vendor is chosen, SHALL clear its value when the vendor changes, and SHALL mark the field required so the mirrored Zod schema fails the same submit the server would reject. Account numbers SHALL be rendered as text, never as a number, and the selector SHALL be read-only once the document has left `DRAFT`. The client guard is UX only; the server still enforces.

#### Scenario: The selector appears for a disbursement

- **GIVEN** a document type whose `requires_payee` is true
- **WHEN** a requester opens its form and picks a vendor
- **THEN** that vendor's active accounts are selectable, with the primary one preselected

#### Scenario: No selector on a type that needs no payee

- **WHEN** a requester opens the form of a type whose `requires_payee` is false
- **THEN** no payee account selector is shown, whatever its `post_action` is

#### Scenario: Changing the vendor clears the payee

- **GIVEN** a form with vendor A and one of its accounts selected
- **WHEN** the vendor is changed to B
- **THEN** the payee selection is cleared and only B's accounts are offered

#### Scenario: Submitting without a payee is caught client-side

- **GIVEN** a `requires_payee` form with no payee selected
- **WHEN** the requester submits
- **THEN** the form shows a required-field error and does not call the server

#### Scenario: The payee is read-only under approval

- **GIVEN** a disbursement in `IN_APPROVAL`
- **WHEN** an approver opens it
- **THEN** the payee account is shown but cannot be changed

### Requirement: Approvers See Where the Money Lands

The web app SHALL show the payee bank account — bank, account name, and account number — on the document detail of any document that carries one, so an approver can see the destination before approving rather than trusting it implicitly. The payee SHALL be shown to every user who can read the document, gated by no permission code beyond document read.

#### Scenario: The approver sees the destination

- **WHEN** an approver opens a disbursement awaiting their step
- **THEN** the bank, account name, and account number of the payee are shown

#### Scenario: The payee stays visible after the account is deactivated

- **GIVEN** an approved disbursement whose payee account was later deactivated
- **WHEN** the document detail is read
- **THEN** the original payee is still shown
