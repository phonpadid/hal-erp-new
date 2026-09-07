## ADDED Requirements

### Requirement: The Budget Form Says Where The Account Is Used, Not That It Is Required

The budget form SHALL describe `gl_account` as the last step of the account chain a document line
resolves through — used when the line names no item and its document type sets no default — and
SHALL NOT claim that a budget naming no account cannot be charged.

That claim was true for exactly as long as the ledger read `budget.account_id` and nothing else. A
line now carries its own account, so a budget naming none is charged perfectly well whenever the
item or the document type names one. A form that keeps warning about a refusal that no longer
happens teaches the reader to distrust its warnings.

All labels SHALL come from i18n with en/la parity, and the form SHALL use PrimeUI theme tokens so it
renders in light and dark mode.

#### Scenario: The hint places the account in the chain

- **WHEN** a `BUDGET_MANAGE` user opens the create or edit form
- **THEN** the GL account field says it applies to lines that name no item on a type with no
  default, and does not say the budget cannot be charged without it

#### Scenario: A budget still saves without an account

- **GIVEN** a budget whose spending posts to several accounts
- **WHEN** a `BUDGET_MANAGE` user saves it leaving the GL account empty
- **THEN** the form accepts it, and no warning claims documents cannot charge it

## REMOVED Requirements

### Requirement: The Budget List Shows Which Budgets Cannot Be Charged

**Reason**: It marked a condition that is no longer a condition. The mark answered "no document can
charge this budget", which was true only while the ledger read `budget.account_id` alone; a budget
naming no account is now charged whenever its lines resolve one from their item or document type.
A mark that predicts a refusal which will not happen is worse than no mark — it sends a budget
officer to fix something that is not broken.

**Migration**: `namesNoAccount` is dropped from the budget list read and the tag removed. What
replaces it is the submit refusal itself, which names the line that resolves no account and the
three places one can be set — raised at the moment it is true, about the document it is true of.

## MODIFIED Requirements

### Requirement: Budget Create and Edit

The web app SHALL let a user holding `BUDGET_MANAGE` propose a budget by dimension and edit an
existing budget's editable attributes (UX only; the server remains authoritative and
company-scoped). Proposing SHALL capture `fiscal_year`, `department`, the `budget_node` the money sits at,
`budget_name`, an optional `gl_account` and `amount_total`, and on save SHALL create a budget plan
carrying that line rather than a spendable budget. The node MAY be chosen from the existing tree or
created inline; a plan is usually written before its structure exists.

The node SHALL be required and SHALL be presented as the budget's identity — its `code` is what a
requester picks it by and what a department head says out loud — while `gl_account` SHALL remain
optional to save. The form SHALL NOT suggest that the account identifies the budget: several budgets
legitimately share one account.

The form SHALL place `gl_account` in the chain a document line resolves an account through — the
item's account, else the document type's default, else this — rather than stating that a budget
naming none cannot be charged. It MAY advise leaving the field empty when the budget's spending
posts to several accounts, because the lines then name their own.

This paragraph said the opposite until this change, and it was right while it was true: the ledger
read `budget.account_id` and nothing else, so a budget naming none stranded every payment charged to
it. The line now carries its own account, so a budget naming none is charged perfectly well whenever
the item or the document type names one, and a budget whose spending genuinely spans several
accounts no longer has to pick one of them falsely or be split in two.

#### Scenario: The form places the account in the chain rather than warning about a refusal

- **WHEN** a `BUDGET_MANAGE` user opens the create or edit form
- **THEN** the GL account field describes itself as the last step of the chain a line resolves
  through, and does not claim that a budget naming no account cannot be charged
