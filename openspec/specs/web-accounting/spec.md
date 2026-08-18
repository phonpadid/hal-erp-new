# web-accounting

## Purpose

Provide the web UI for the accounting capabilities — the chart of accounts, the journal, and the
financial statements — gated in the client by `GL_*` and related permission codes. This is
client-side UX only; the server remains authoritative for permissions, company scope, and every
figure reported. The client SHALL NOT recompute reported totals.
## Requirements
### Requirement: Balance Sheet Distinguishes Retained Earnings Brought Forward from the Current Period

The balance sheet screen SHALL render both retained-earnings figures the server returns — the
brought-forward balance that closed fiscal years rolled into the equity account
(`retainedEarningsBroughtForward`) and the current period's derived result (`retainedEarnings`) —
and SHALL indicate that the brought-forward figure is already included in the equity rows above it,
so that a reader does not add it to the reported total a second time.

The screen SHALL NOT recompute any total; `liabilitiesEquityTotal` and `balanced` are taken from the
server as returned. Amounts SHALL be formatted with the base currency's `decimal_places` and never
carried as a JS number.

#### Scenario: A company that has closed a year sees both halves

- **GIVEN** a company whose prior fiscal year was closed into retained earnings
- **WHEN** the user opens the balance sheet
- **THEN** the brought-forward figure is shown, labelled as brought forward and marked as already
  counted in the equity rows
- **AND** the current period's figure is shown separately

#### Scenario: A company that has never closed a year sees a zero brought forward

- **GIVEN** a company with no closed fiscal year
- **WHEN** the user opens the balance sheet
- **THEN** the brought-forward figure is shown as zero rather than hidden

#### Scenario: The explanatory note does not claim a close has or has not happened

- **WHEN** the user opens the balance sheet
- **THEN** the note distinguishes the two figures and their relationship to the equity total
- **AND** it makes no claim about whether a period or year close has occurred

### Requirement: Accounting Periods Screen

The web app SHALL provide a screen listing the active company's accounting periods, ordered by
start date, showing each period's code, range and status. The route SHALL be gated by `PERIOD_VIEW`.

Controls SHALL be shown by permission code, mirroring the server: declaring by `PERIOD_MANAGE`,
closing by `PERIOD_CLOSE`, reopening by `PERIOD_REOPEN`. The client guard is UX only; the server
remains authoritative.

#### Scenario: Periods are listed in date order

- **WHEN** a user holding `PERIOD_VIEW` opens the screen
- **THEN** the company's periods are listed with code, start, end and status

#### Scenario: Controls absent without their permission

- **GIVEN** a user holding `PERIOD_VIEW` only
- **WHEN** the screen renders
- **THEN** no declare, close or reopen control is offered

### Requirement: A Refused Close Shows the Server's Reason

The screen SHALL surface a refused close using the server's message as returned, and SHALL NOT
offer a control that closes the period regardless.

The server refuses a close when an earlier period is still open, when the company owes undelivered
postings, or when `RETAINED_EARNINGS` is unmapped on a year's final period. Each refusal names its
obstacle, which is why it is shown rather than translated.

#### Scenario: An earlier open period blocks the close

- **GIVEN** an earlier period is still open
- **WHEN** the user closes a later one
- **THEN** the server's refusal, naming the earlier period, is shown
- **AND** the period remains open in the list

#### Scenario: Undelivered postings block the close

- **GIVEN** the company owes undelivered postings
- **WHEN** the user closes the period
- **THEN** the server's refusal, naming the owed postings, is shown

#### Scenario: No control bypasses a refusal

- **WHEN** the close confirmation is shown
- **THEN** it offers only confirm and cancel, with no option to close despite a refusal

### Requirement: Closing a Year's Final Period Is Announced as Closing the Year

The close confirmation SHALL state that the fiscal year closes with the period, and that reopening
the period will not undo it, when — and only when — the period is the last in its fiscal year.

Closing a year's final period also rolls revenue and expense into retained earnings and closes the
year. That entry is keyed by fiscal year, so a reopen-and-reclose does not repost it; the operator
gets two acts from one control, and can only be told beforehand.

#### Scenario: The final period's confirmation names the year close

- **GIVEN** the period being closed is the last in its fiscal year
- **WHEN** the close confirmation is shown
- **THEN** it states that the fiscal year closes with it

#### Scenario: An ordinary period's confirmation does not

- **GIVEN** the period being closed is not the last in its fiscal year
- **WHEN** the close confirmation is shown
- **THEN** no year-close statement is shown

### Requirement: Reopening Requires a Reason

Reopening SHALL require a non-empty reason, which the server records in the period log. The confirm
control SHALL stay disabled until one is entered.

#### Scenario: Reopen is blocked without a reason

- **GIVEN** a user holding `PERIOD_REOPEN` opens the reopen dialog
- **WHEN** no reason has been entered
- **THEN** the confirm control is disabled

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

### Requirement: Undelivered Postings Screen

The web app SHALL provide a screen listing the postings this company owes and has not delivered,
gated by `GL_VIEW`, showing each one's source type, source document number where known, status,
attempt count, last error and last attempt time.

The list holds PENDING and FAILED postings — the two states in which the ledger still owes an
entry.

#### Scenario: The undelivered postings are listed

- **WHEN** a user holding `GL_VIEW` opens the screen
- **THEN** each undelivered posting is shown with its status, attempts and last error

#### Scenario: The attempt count is shown against the bound that stopped it

- **GIVEN** a FAILED posting that exhausted the sweeper's attempts
- **WHEN** it is listed
- **THEN** its attempt count is shown against the maximum, not as a bare number

### Requirement: Re-queue Is Offered Only Where It Can Work

The re-queue control SHALL be offered only on FAILED postings, and only to users holding
`GL_POST_RETRY`. The server refuses to re-queue any other status, so a control offered elsewhere
could only fail.

#### Scenario: A failed posting can be re-queued

- **GIVEN** a user holding `GL_VIEW` and `GL_POST_RETRY`
- **WHEN** they view a FAILED posting
- **THEN** a re-queue control is offered

#### Scenario: A pending posting offers no re-queue

- **GIVEN** the same user
- **WHEN** they view a PENDING posting
- **THEN** no re-queue control is offered, because it is queued rather than stalled

#### Scenario: Viewing without the retry code offers nothing to click

- **GIVEN** a user holding `GL_VIEW` without `GL_POST_RETRY`
- **WHEN** they view a FAILED posting
- **THEN** no re-queue control is offered

### Requirement: A Blocked Period Close Leads to the Postings That Block It

When the period close is refused for undelivered postings, the periods screen SHALL offer a link to
the undelivered-postings screen, and SHALL offer it only to viewers holding `GL_VIEW`, which gates
that screen.

#### Scenario: The refusal offers a way forward

- **GIVEN** a user holding `PERIOD_CLOSE` and `GL_VIEW` whose close was refused
- **WHEN** the refusal is shown
- **THEN** a link to the undelivered postings is offered

#### Scenario: No link the viewer could not follow

- **GIVEN** a user holding `PERIOD_CLOSE` without `GL_VIEW`
- **WHEN** the refusal is shown
- **THEN** no link is offered, and the refusal still names the owed postings

### Requirement: Open Payables Screen

The web app SHALL provide a screen listing the payables this company has accrued and not paid,
gated by `GL_VIEW`, showing who is owed, the kind of payable, document number, amount, invoice date
and due date, ordered by due date.

The screen SHALL show every kind of payable the server returns, and SHALL make the kind visible on
the row. A trade payable was agreed with a supplier on terms; a claim is owed to a person now. A list
that renders them identically reports a total nobody can compose.

A row whose payee the server did not name SHALL be shown by its document number rather than as an
empty payee, and SHALL NOT be attributed to whoever raised the document.

Amounts SHALL be formatted with the base currency's `decimal_places` and never carried as a JS
number. The screen SHALL NOT mark rows overdue: the due date is a company-day and the client does
not know the company's timezone.

The endpoint returns every row in one response, so the table SHALL page and sort on the client
rather than requesting pages the server does not honour.

#### Scenario: Open payables are listed by due date

- **WHEN** a user holding `GL_VIEW` opens the screen
- **THEN** the unpaid accruals are listed with who is owed, amount, invoice date and due date,
  ordered by due date

#### Scenario: A claim and a purchase are told apart

- **GIVEN** one open trade payable and one open claim payable
- **WHEN** the screen renders
- **THEN** each row shows which kind it is

#### Scenario: An unnamed payee is not invented

- **GIVEN** an open claim payable the server returned with no payee
- **WHEN** the row renders
- **THEN** it is identified by its document number and names nobody

#### Scenario: Nothing is marked overdue

- **GIVEN** a payable whose due date has passed in the viewer's timezone
- **WHEN** the screen renders
- **THEN** the row is shown without an overdue marking

### Requirement: Chart of Accounts Screen

The web app SHALL provide a chart-of-accounts screen gated by `COA_VIEW`, with create, edit and
deactivate controls gated by `COA_MANAGE`.

#### Scenario: A reader sees the accounts without the management controls

- **GIVEN** a user holding `COA_VIEW` without `COA_MANAGE`
- **WHEN** the screen renders
- **THEN** the accounts are listed and no create, edit or deactivate control is offered

### Requirement: Journal Screen

The web app SHALL provide a read-only journal screen gated by `GL_VIEW`, listing entries with their
date, source, memo and total, expandable to the lines with each line's account, debit and credit.
Journal entries are produced by the posting engine and are never created from this list.

Entry totals SHALL be summed as decimal strings and formatted with the base currency's
`decimal_places`.

#### Scenario: An entry expands to its lines

- **WHEN** a user holding `GL_VIEW` expands an entry
- **THEN** its lines are shown with account, debit and credit

#### Scenario: An entry sourced from a document links to it

- **GIVEN** an entry carrying a source document number
- **WHEN** it is listed
- **THEN** the document number links to that document

### Requirement: Tax Code and VAT Summary Screens

The web app SHALL provide a tax-code administration screen and a VAT summary screen, both gated by
`TAX_VIEW`.

#### Scenario: Both screens are reachable on the tax read code

- **GIVEN** a user holding `TAX_VIEW`
- **WHEN** they open either screen
- **THEN** the route guard admits them

### Requirement: Financial Statement Screens

The web app SHALL provide trial balance, income statement and balance sheet screens, all gated by
`GL_VIEW`, each with a date filter appropriate to it — a range for the trial balance and income
statement, an as-of date for the balance sheet.

Every figure SHALL be taken from the server as returned; these screens compute no totals of their
own.

#### Scenario: The trial balance filters by a date range

- **WHEN** a user holding `GL_VIEW` sets a from and to date
- **THEN** the trial balance is reloaded for that range

#### Scenario: The balance sheet filters by an as-of date

- **WHEN** the user sets an as-of date
- **THEN** the balance sheet is reloaded as at that date

### Requirement: Account Ledger Drill-Down

The web app SHALL provide an account ledger screen for a single account, gated by `GL_VIEW`,
reached from the trial balance and showing the account's code and name with its lines.

#### Scenario: An account on the trial balance opens its ledger

- **WHEN** the user selects an account on the trial balance
- **THEN** the account ledger for that account opens

### Requirement: Accounting Screens Are Covered by the Smoke Registry

Every routed accounting screen SHALL appear in the view smoke registry, so that a screen which
throws on mount fails a test rather than reaching a user.

#### Scenario: Each accounting screen mounts

- **WHEN** the smoke suite runs
- **THEN** the chart of accounts, journal, journal voucher, undelivered postings, open payables,
  accounting periods, tax codes, VAT summary, trial balance, income statement, balance sheet and
  account ledger each mount without throwing

### Requirement: The VAT Summary Formats Its Figures as Money

The VAT summary screen SHALL format both the input VAT and the withheld WHT with the base currency's
`decimal_places`, as every other amount in the app is formatted, and SHALL NOT render the raw string
the server returned.

#### Scenario: Figures carry the base currency's decimal places

- **GIVEN** a summary row whose input VAT is the decimal string `1000`
- **WHEN** the screen renders it in a company whose base currency has two decimal places
- **THEN** it is shown as `1,000.00`

### Requirement: Declaring a Period Offers the Years It Can Be Declared Into

The declare dialog SHALL offer the active company's open fiscal years, read on the period-management
code, and SHALL NOT require the organisation's fiscal-year code to be usable.

When the company has no open fiscal year, the dialog SHALL say so rather than presenting an empty
selector.

#### Scenario: A period manager can declare without the organisation code

- **GIVEN** a user holding `PERIOD_MANAGE` and not `FISCAL_YEAR_MANAGE`
- **WHEN** they open the declare dialog
- **THEN** the open fiscal years are selectable and the period can be declared

#### Scenario: No open fiscal year is stated, not shown as an empty list

- **GIVEN** a company with no open fiscal year
- **WHEN** the declare dialog is opened
- **THEN** it states that there is no open fiscal year, and no empty selector is presented

### Requirement: A Period's History Is Readable From The Screen

The periods screen SHALL offer, for each period, the log of what was done to it — every declare,
close and reopen with its actor, its moment and its reason — to viewers holding `PERIOD_VIEW`.

The log SHALL be fetched when it is opened rather than loaded for every period in the list.

#### Scenario: The reason a period was reopened is visible

- **GIVEN** a period that was reopened with a reason
- **WHEN** a user opens that period's history
- **THEN** the reopen is listed with its reason, its actor and its moment

#### Scenario: A declare is shown with the range it set

- **GIVEN** a period declared after declares began to be recorded
- **WHEN** a user opens its history
- **THEN** the declare is listed with the range it set

#### Scenario: History is fetched on open

- **WHEN** the periods list renders
- **THEN** no period's log has been requested
- **AND** opening one period's history requests only that period's log

### Requirement: The Open Payables Screen Shows The Ageing

The open payables screen SHALL show the ageing buckets and their totals above the list, and each
row's bucket alongside its due date, both taken from the server as returned.

The screen SHALL also show the total owed per kind of payable, as the server reported it, so a
reader can see what the overall figure is composed of without opening a second screen or adding two
numbers themselves.

The screen SHALL NOT compute a bucket, a days-overdue figure, or a per-kind total of its own: it does
not know the company's day, and a total recomputed in the browser is a second opinion about a figure
the server already derived.

#### Scenario: The buckets are shown with their totals

- **WHEN** a user holding `GL_VIEW` opens the screen
- **THEN** the five buckets are shown with the amount in each

#### Scenario: The composition is shown beside the total

- **GIVEN** the server reported open payables of both kinds
- **WHEN** the screen renders
- **THEN** the total owed per kind is shown as returned

#### Scenario: A row shows the bucket the server put it in

- **GIVEN** an overdue payable
- **WHEN** the row renders
- **THEN** it shows the bucket the server reported, not one derived in the browser

### Requirement: The Voucher Screen Submits For Approval

The journal voucher form SHALL submit a voucher for approval rather than posting it, and SHALL say
so — a form whose button reads "post" when it does not post is worse than one that asks for a second
person. On success it SHALL name the document number the voucher was given, so the author can follow
it through the approval route.

A pending-vouchers screen SHALL list what is awaiting approval, gated by `GL_VIEW`, with approve and
reject controls shown only to holders of `GL_JV_APPROVE`, and rejection SHALL require a reason before
its control is enabled.

The screen SHALL show, for each voucher, the step it is waiting on. A voucher can require more than
one approval, so "pending" alone no longer tells an approver whether they are the one being waited
for.

The screen SHALL NOT hide the approve control on a viewer's own voucher; the server refuses
self-approval and its refusal is the one that matters. It MAY mark it.

#### Scenario: The form says it is submitting, not posting

- **WHEN** a `GL_JV_POST` holder completes a balanced voucher
- **THEN** the control offers to submit it for approval

#### Scenario: A submitted voucher reports its document number

- **WHEN** a voucher is submitted successfully
- **THEN** the confirmation names the document number it was given

#### Scenario: Approval controls appear only with the approval code

- **GIVEN** a user holding `GL_VIEW` without `GL_JV_APPROVE`
- **WHEN** the pending vouchers render
- **THEN** no approve or reject control is offered

#### Scenario: The waiting step is shown

- **GIVEN** a voucher waiting at the second step of its route
- **WHEN** the pending vouchers render
- **THEN** that step is shown on its row

#### Scenario: Rejecting needs a reason

- **GIVEN** a user holding `GL_JV_APPROVE` opening the reject dialog
- **WHEN** no reason has been entered
- **THEN** the confirm control is disabled

### Requirement: The VAT Summary Shows Whether a Month Has Been Filed

The VAT summary screen SHALL show, on each period's row, whether a return has been filed for it and
— when it has — the date and the amount that was claimed. A figure without its filed state invites
the same month being claimed twice on paper while the ledger says it was claimed once.

The screen SHALL offer a control to file a period, and SHALL offer it only for periods not yet filed,
only to a holder of the filing permission, and SHALL disable it for a period with nothing to claim.

The period sent SHALL be the whole calendar month the row reports, with its own last day.

Amounts SHALL be formatted with the base currency's decimal places.

#### Scenario: A filed month is marked as filed

- **GIVEN** a summary in which one period has a return and another does not
- **WHEN** the screen is shown
- **THEN** the period with a return shows its filed date and claimed amount, and the other shows that
  it is not filed

#### Scenario: The file control is offered only where filing is possible

- **GIVEN** a viewer holding the filing permission
- **WHEN** the screen is shown
- **THEN** the control appears only on periods not yet filed

#### Scenario: A reader is offered no file control

- **GIVEN** a viewer who may read the summary but not file
- **WHEN** the screen is shown
- **THEN** no file control appears

#### Scenario: A period with nothing to claim cannot be filed from the screen

- **GIVEN** a period whose input VAT is zero
- **WHEN** the screen is shown
- **THEN** its file control is disabled

#### Scenario: Filing sends the whole calendar month

- **GIVEN** a period row for a month whose last day is not the 30th
- **WHEN** it is filed
- **THEN** the request names that month's first and last day

### Requirement: A Screen Reconciles the Budget Against the Ledger

The web app SHALL provide a budget-to-ledger reconciliation screen for a chosen fiscal year, gated
by the reporting permission, showing per account what the budget says was appropriated, committed and
consumed, what the ledger says moved, and the difference.

Each account's difference SHALL be expandable into the causes the server named, and the
**unexplained** remainder SHALL be shown on the row itself rather than only inside the expansion —
it is the one figure the screen exists to surface, and a number that has to be opened to be seen is
a number nobody sees.

Where the server named the documents behind a cause, the expansion SHALL name them too. The
outside-the-year cause SHALL list each crossing with its document number, the day the consumption
was dated, and its amount, because "how much crossed the boundary" is answered by the figure and
"which ones" is the question the figure provokes, and a reader who cannot see the second has to go
looking for it in a ledger.

Where such a list is capped, the screen SHALL state how many it did not show. A truncated list that
does not admit to being truncated reports a smaller problem than the one that exists, and the reader
has no way to tell the difference between ten crossings and a hundred.

An account whose unexplained remainder is non-zero SHALL be marked. A screen that reports a
reconciliation and a discrepancy in the same neutral typeface asks the reader to do the report's job.

The screen SHALL show the vouchers-on-budgeted-accounts figure, and SHALL show the expenses skipped
for want of a budget, so that the case the reconciliation is blind to is visible beside it rather
than on a screen somebody has to know to look for.

Amounts SHALL be formatted with the base currency's decimal places and SHALL never be carried as a
JS number.

#### Scenario: The unexplained remainder is visible without expanding a row

- **GIVEN** a reconciliation in which one account has an unexplained remainder
- **WHEN** the screen renders
- **THEN** that figure appears on the account's own row

#### Scenario: An unexplained difference is marked

- **GIVEN** one account whose unexplained remainder is zero and one whose is not
- **WHEN** the screen renders
- **THEN** only the second is marked

#### Scenario: The causes are readable

- **GIVEN** an account whose difference the server decomposed into named causes
- **WHEN** its row is expanded
- **THEN** each cause is listed with its amount

#### Scenario: The documents behind a crossing are named

- **GIVEN** an account whose consumption was dated outside the year of the appropriation it drew on
- **WHEN** its row is expanded
- **THEN** each crossing document is listed with its number, the date its consumption was dated, and
  its amount

#### Scenario: A capped list says how many it did not show

- **GIVEN** an account with more crossings than the screen lists
- **WHEN** its row is expanded
- **THEN** the number not shown is stated beside the list

#### Scenario: The blind spot is shown beside the reconciliation

- **GIVEN** a company with expenses skipped for want of a budget
- **WHEN** the screen renders
- **THEN** those documents are shown on it, with their totals

#### Scenario: A viewer without the reporting permission is kept out

- **WHEN** a user without the reporting permission opens the route
- **THEN** they are redirected away from it
