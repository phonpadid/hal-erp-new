# web-accounting

## ADDED Requirements

### Requirement: Journal Voucher Form

The web app SHALL provide a form for posting a journal voucher by hand, gated by `GL_JV_POST`. It
SHALL take an entry date, a memo, and at least two lines of account code, debit, credit and an
optional line memo, and SHALL allow lines to be added and removed.

Amounts SHALL be carried and summed as decimal strings, never as a JS number.

#### Scenario: The form is unreachable without the permission

- **GIVEN** a user who does not hold `GL_JV_POST`
- **WHEN** they navigate to the voucher route
- **THEN** the route guard refuses it

#### Scenario: Lines can be added and removed down to two

- **WHEN** the user edits the voucher
- **THEN** lines can be added, and removed while more than two remain

### Requirement: The Voucher Submit Waits for a Balanced, Non-Zero Entry

The form SHALL show running debit and credit totals as the user types, and SHALL refuse to submit
while the two differ or while both are zero. Each line SHALL carry exactly one non-zero side.

The client check is UX; the server remains authoritative and asserts the balance independently.

#### Scenario: An unbalanced voucher cannot be submitted

- **GIVEN** the debit total and the credit total differ
- **WHEN** the form renders
- **THEN** the submit control is disabled and the imbalance is shown

#### Scenario: An all-zero voucher cannot be submitted

- **GIVEN** every line's debit and credit are zero
- **WHEN** the form renders
- **THEN** the submit control is disabled, because the totals being equal is not enough

#### Scenario: A balanced voucher can be submitted

- **GIVEN** the debit total equals the credit total and both are non-zero
- **WHEN** the form renders
- **THEN** the submit control is enabled

#### Scenario: A line with two non-zero sides is rejected before posting

- **GIVEN** a line carrying both a debit and a credit
- **WHEN** the form renders
- **THEN** the submit control is disabled and the line is marked

### Requirement: A Resubmitted Voucher Posts Once

The form SHALL send a client-generated voucher id, so that submitting the same voucher twice — a
double-click, or a retry after an uncertain response — resolves to one entry rather than two. A new
id SHALL be generated only after a successful post.

#### Scenario: The same form submitted twice sends one id

- **GIVEN** a filled-in voucher
- **WHEN** it is submitted twice
- **THEN** both requests carry the same id

#### Scenario: A fresh voucher gets a fresh id

- **GIVEN** a voucher was posted successfully
- **WHEN** the operator begins another
- **THEN** it carries a different id

### Requirement: Reversal Is Offered on Journal Entries

The journal SHALL offer a reverse control on its entries to users holding `GL_JV_POST`, taking an
optional date and memo. It SHALL be offered on every entry, not only on manually posted ones, since
a wrong automatic posting is the likelier thing to correct.

#### Scenario: The control is absent without the permission

- **GIVEN** a user holding `GL_VIEW` without `GL_JV_POST`
- **WHEN** the journal renders
- **THEN** no reverse control is offered

#### Scenario: Automatic postings can be reversed too

- **GIVEN** an entry whose source is not a manual voucher
- **WHEN** a user holding `GL_JV_POST` views it
- **THEN** the reverse control is offered

### Requirement: The Reversal Dialog States Its Date and Its Once-Only Rule

The reversal dialog SHALL state that a reversal is dated today by default rather than on the
original entry's date, and that an entry can be reversed at most once. A refusal from the server —
including an entry already reversed — SHALL be shown as returned.

#### Scenario: The default date is explained

- **WHEN** the reversal dialog is opened
- **THEN** it states that the reversal is dated today unless a date is given, and why

#### Scenario: A second reversal is refused by the server and shown

- **GIVEN** an entry that has already been reversed
- **WHEN** the user reverses it again
- **THEN** the server's refusal, naming the existing reversing entry, is shown
