## ADDED Requirements

### Requirement: A Step May Allow Its Approver To Re-Code A Line's Account

A `workflow_step` SHALL carry `allows_account_recode` (boolean, NOT NULL, default false), and the
recorded route SHALL carry it as `document_approval_step.allows_account_recode`, copied from the
step at submit like every other step field. While a document is `IN_APPROVAL` on a route step whose
`allows_account_recode` is true, an approver eligible for that step (principal or active delegate)
who holds `DOC_LINE_RECODE` MAY change one `document_line`'s `account_id` — and its display
`gl_account`, which SHALL be set to the new account's `code` — to another account of the active
company that is `is_active` and `is_postable`.

The permission SHALL be read from the route step the document is on, never from `workflow_step`
directly, so turning the flag on reaches documents submitted afterwards and cannot change the terms
a document already in approval was submitted under (invariant 7).

A recode SHALL change only `document_line.account_id` and `document_line.gl_account`. It SHALL NOT
change `budget_id`, `line_amount`, `tax_amount`, `base_line_amount`, `budget_base_line_amount`, any
other column of the line, and SHALL write no `budget_txn` and no `quota_usage` row (invariants 3–4).
It SHALL NOT write `item_company`, `budget`, or `account`.

`DOC_LINE_RECODE` SHALL be a declared permission code, so the catalog reconcile creates its row and
the catalog check reports its absence. A holder of `DOC_LINE_RECODE` SHALL be able to read the
company's selectable accounts (the active, postable code-and-name list the budget form uses) without
holding `COA_VIEW`: an approver allowed to move a line's account must be able to see the accounts
it can move to, and the chart's read code is not what that allowance was granted on.

#### Scenario: An eligible approver re-codes a line on a step that allows it

- **GIVEN** a document `IN_APPROVAL` on a route step whose `allows_account_recode` is true, with
  line 2 stamped account `612.06`
- **WHEN** an eligible approver holding `DOC_LINE_RECODE` re-codes line 2 to `615.01`, a postable
  active account of the same company
- **THEN** line 2's `account_id` is `615.01`'s id and its `gl_account` is `615.01`
- **AND** the line's `budget_id` and every amount are unchanged, and no `budget_txn` row was written

#### Scenario: The step does not allow it

- **GIVEN** a document `IN_APPROVAL` on a route step whose `allows_account_recode` is false
- **WHEN** an eligible approver holding `DOC_LINE_RECODE` re-codes a line
- **THEN** the request is refused naming that this step does not allow re-coding, and nothing is written

#### Scenario: The flag is read from the route, not the workflow

- **GIVEN** a document submitted while its step's `allows_account_recode` was false
- **WHEN** `WORKFLOW_MANAGE` sets the flag true on that `workflow_step` and an eligible approver
  re-codes a line of the already-routing document
- **THEN** the request is refused, and a document submitted afterwards on the same workflow allows it

#### Scenario: An approver not eligible for the current step is refused

- **GIVEN** a document on a step that allows re-coding
- **WHEN** a user holding `DOC_LINE_RECODE` who is neither the step's approver nor an active
  delegate re-codes a line
- **THEN** the request is refused as forbidden, and nothing is written

#### Scenario: An eligible approver without the permission is refused

- **GIVEN** a document on a step that allows re-coding
- **WHEN** an eligible approver who does not hold `DOC_LINE_RECODE` re-codes a line
- **THEN** the request is refused as forbidden, and nothing is written

#### Scenario: The target account must be postable, active and of this company

- **GIVEN** a document on a step that allows re-coding
- **WHEN** an eligible approver re-codes a line to an account that is inactive, or not postable, or
  belongs to another company
- **THEN** the request is refused naming the account, and nothing is written

#### Scenario: A line that posts nothing cannot be re-coded

- **GIVEN** a line whose `line_amount` is zero
- **WHEN** an eligible approver re-codes it
- **THEN** the request is refused naming the line, and nothing is written

#### Scenario: Re-coding to the same account is a no-op refusal

- **GIVEN** a line stamped `612.06`
- **WHEN** an eligible approver re-codes it to `612.06`
- **THEN** the request is refused, and no `approval_log` row is written

#### Scenario: The accountant can list the accounts to move to

- **GIVEN** a user holding `DOC_LINE_RECODE` and not `COA_VIEW`
- **WHEN** the user reads the selectable accounts
- **THEN** the active, postable accounts of the active company are returned

#### Scenario: Master data is untouched

- **GIVEN** a line naming an item whose `item_company.default_gl_account` is `612.06`, charging a
  budget whose `gl_account` is `612.06`
- **WHEN** the line is re-coded to `615.01`
- **THEN** `item_company.default_gl_account` and `budget.gl_account` / `budget.account_id` are still
  `612.06`

### Requirement: A Line Is Re-Coded Only While The Document Can Still Be Refused

Re-coding SHALL be refused unless the document is `IN_APPROVAL`, and SHALL be refused once any
`journal_entry` whose `source_id` is the document exists. A refusal SHALL name the reason — the
document's status, or the posted entry — rather than failing generically. An entry already posted
is corrected through a reversing voucher, never by moving the line beneath it.

The recode SHALL run inside one transaction under a `PESSIMISTIC_WRITE` lock on the `document` row
— the same lock the approve path takes — so a recode and the final APPROVE serialise: whichever is
second sees the first's result. A recode that lands after the final approval SHALL be refused by
the status gate; an approval that lands after a recode SHALL post from the recoded lines.

REJECT, RETURN and APPROVE SHALL NOT be gated by whether a line was or could be re-coded.

#### Scenario: A completed document is refused

- **GIVEN** a `COMPLETED` document
- **WHEN** a line is re-coded
- **THEN** the request is refused naming the status, and nothing is written

#### Scenario: A recode racing the final approval

- **GIVEN** a document on its last step, which allows re-coding
- **WHEN** the final APPROVE and a recode of line 1 are submitted concurrently
- **THEN** either the recode commits first and the entry posted for the approval debits the recoded
  account, or the approval commits first and the recode is refused as not in approval — never an
  entry posted on lines that then change

#### Scenario: Two recodes of one line serialise

- **GIVEN** a line stamped `612.06`
- **WHEN** two eligible approvers re-code it concurrently to `615.01` and `615.02`
- **THEN** both commit in some order, the line carries the second's account, and two
  `approval_log` rows record the two moves in that order

#### Scenario: Returning the document is unaffected

- **GIVEN** a document on a step that allows re-coding, with one line already re-coded
- **WHEN** an eligible approver returns the document
- **THEN** the document goes back to DRAFT and its holds are released, as for any return

### Requirement: Every Recode Is Attributed

The system SHALL write one `approval_log` row per recode, in the same transaction as the line
change, with `action` `RECODE_ACCOUNT`, `step_no` the document's current step, `approver_id` the
acting user, `delegated_from` the delegator when acting under delegation, and `remark` naming the
line, the account code before and the account code after. `approve_action` SHALL admit
`RECODE_ACCOUNT`. `approval_log` remains append-only (invariant 2): a recode that must be refused is
refused before its row is written.

The approval history read SHALL return the row in the same shape as every other action, so a
reader can see that an account moved, who moved it and when, and the approvals on either side of
it read against the account they were given on.

#### Scenario: The change is attributable afterwards

- **WHEN** an eligible approver re-codes line 2 from `612.06` to `615.01`
- **THEN** the approval log carries a `RECODE_ACCOUNT` row for the current step naming the user,
  line 2, `612.06` and `615.01`, and the time

#### Scenario: A refused recode leaves no row

- **WHEN** a recode is refused for any reason
- **THEN** no `approval_log` row is written

### Requirement: The Account-Recode Allowance Is Configured On The Step

Creating or updating a `workflow_step` SHALL accept `allowsAccountRecode` as a boolean and SHALL
persist it to `workflow_step.allows_account_recode`, under the same `WORKFLOW_MANAGE` permission,
the same active-company scoping and the same single transaction as every other step field. Omitting
the field on create SHALL store false. The step read surface SHALL return the flag. Submit SHALL
copy the flag onto `document_approval_step.allows_account_recode`.

#### Scenario: The flag is authored on a step

- **GIVEN** a `WORKFLOW_MANAGE` user in the active company
- **WHEN** the user updates a step with `allowsAccountRecode` true
- **THEN** `workflow_step.allows_account_recode` is stored true for that step

#### Scenario: Omitting the field stores false

- **WHEN** a step is created without `allowsAccountRecode`
- **THEN** the stored value is false

#### Scenario: Submit records the flag on the route

- **GIVEN** a workflow whose step 5 has `allows_account_recode` true
- **WHEN** a document is submitted on that workflow
- **THEN** its `document_approval_step` row for step 5 carries `allows_account_recode` true and the
  others false

#### Scenario: Another company's workflow is refused

- **GIVEN** a step belonging to a workflow of another company
- **WHEN** a user sets `allowsAccountRecode` on it
- **THEN** the request is refused as not-found, as for any other step mutation
