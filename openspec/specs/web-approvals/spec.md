# web-approvals

## Purpose
The Vue approver inbox for end users: a company-scoped list of the documents pending the
signed-in user's approval (those `IN_APPROVAL` where they are an eligible actor for the
current step and are not the creator), with enough context to triage and a link to each
document. From a document an eligible approver can act with Approve / Reject / Return plus an
optional remark, surfacing server-side rejections. All affordances honor no-self-approval and
are gated by the `DOC_APPROVE` permission code (client-side UX only; the server remains
authoritative).
## Requirements
### Requirement: Approval Inbox

The web app SHALL show a `DOC_APPROVE` user the documents in the active company that are
awaiting their approval — those `IN_APPROVAL` where they are an eligible actor for the
current step and are not the creator — with enough context to triage (document number, type,
requester, base total, current step, age, SLA due time, and overdue/escalation state). The base
total SHALL be formatted using the company base currency's `decimal_places`. Each item links to the
document. Overdue items SHALL be visually distinguished, and items reassigned by escalation SHALL
indicate that they were escalated.

The inbox is paginated, so a search offered on it SHALL resolve against the WHOLE pending set on the
server and SHALL NOT filter only the page already loaded. An approver with more documents than fit
on one page has no other way to find one; a box that filters the current page is worse than none,
because a term that matches nothing on this page is indistinguishable from a term that matches
nothing at all.

A search control SHALL NOT be offered unless it is wired to something that filters. A table rendered
in a mode where its filter bindings are ignored — such as a lazy/server-paged table given
client-side `filters` — SHALL either handle the filter itself or not present the control.

The inbox SHALL offer a filter panel in the documents list's style, holding exactly three filters:
- department;
- a submitted-date range;
- minimum/maximum amount.

Each applied filter SHALL be shown as a removable chip, with a single action that clears them all.
The department filter SHALL be gated by `DEPARTMENT_VIEW`, as on the documents list.

The panel SHALL NOT offer:
- a status filter, because every inbox row is pending approval;
- a document-type or vendor filter;
- an "only mine" filter, because a reader's own documents are never in their inbox.

Like the search, the filters SHALL be answered by the server across the whole pending set, and changing any of them SHALL return the inbox to its
first page. Amount bounds SHALL travel as the strings typed and SHALL never be converted to a JS
number.

#### Scenario: Inbox lists actionable documents

- **WHEN** a `DOC_APPROVE` user opens the approvals inbox
- **THEN** documents awaiting their action are listed, and documents they created are not

#### Scenario: Search finds a document on a later page

- **GIVEN** an approver whose pending queue spans more than one page
- **WHEN** they search for the number of a document that is not on the page currently shown
- **THEN** that document is listed

#### Scenario: A search that matches nothing says so

- **WHEN** the approver searches for a term no pending document matches
- **THEN** the inbox shows an empty result for that search rather than the unfiltered list

#### Scenario: Empty inbox

- **WHEN** the user has nothing awaiting them
- **THEN** the inbox shows an empty state rather than an error

#### Scenario: Overdue item is flagged

- **WHEN** an item in the inbox has passed its working-hour SLA due time
- **THEN** it is shown with an overdue indicator and its due time

#### Scenario: Base total is formatted by decimal places

- **WHEN** the inbox lists an item
- **THEN** its base total is shown formatted to the base currency's `decimal_places`

#### Scenario: Filtering the inbox by department

- **GIVEN** an approver on page 2 of their inbox
- **WHEN** they choose a department in the filter panel
- **THEN** the inbox reloads from page 1 with only that department's documents, and a chip naming
  the department is shown

#### Scenario: Removing a chip removes its filter

- **GIVEN** an inbox filtered by department and by a submitted-date range
- **WHEN** the approver removes the department chip
- **THEN** the inbox is filtered by the date range alone

#### Scenario: The inbox panel offers department, date and amount only

- **WHEN** an approver opens the inbox's filter panel
- **THEN** it offers department, submitted date and amount, and no status, type, vendor or "only
  mine" control

### Requirement: Act on a Document

The web app SHALL let an eligible approver Approve, Reject, or Return a document with an
optional remark, and reflect the resulting status. Server-side rejections (not eligible, not
in approval, self-approval) SHALL be surfaced.

Before the decision, the approver SHALL be shown what the document does. For a document carrying
budget movements that means the movement type, the budget each names, and the amount — in the same
place the amount is already shown, not one navigation away.

An approval is the control this system puts in front of every movement of money, and it is worth
only what the approver can see. Showing an amount and a type without naming the budget asks a person
to sign for twelve million kip going somewhere unstated.

#### Scenario: Approve advances the document

- **WHEN** an eligible approver approves a document on its final step
- **THEN** the document becomes COMPLETED and the action appears in its approval log

#### Scenario: Reject releases and stops routing

- **WHEN** an eligible approver rejects a document
- **THEN** the document becomes REJECTED and the detail reflects it

#### Scenario: The approver sees which budget an amount lands on

- **GIVEN** a budget plan proposing 12,000,000 for one budget
- **WHEN** the approver opens it to act
- **THEN** the budget's code and name are shown beside the amount, before Approve is available

#### Scenario: A document with no movements shows none

- **WHEN** the approver opens a disbursement whose content is document lines
- **THEN** no movement section is shown, and the existing amount and type are unchanged

### Requirement: No Self-Approval in the UI

The approval action affordances SHALL be hidden when the signed-in user is the document's
creator, even if they hold `DOC_APPROVE` (UX mirror of invariant 8; the server still
enforces).

#### Scenario: Creator sees no approve action

- **WHEN** a user who created a document views it while it is IN_APPROVAL
- **THEN** the Approve / Reject / Return actions are not shown to them

### Requirement: Permission-Gated Approval Affordances

The approvals inbox and the act buttons SHALL be shown only to users holding `DOC_APPROVE`
(UX only; the server enforces on every action).

#### Scenario: Inbox hidden without permission

- **WHEN** a user without `DOC_APPROVE` is signed in
- **THEN** the Approvals navigation entry and inbox are not shown

### Requirement: SLA and Escalation in Document Detail

The web app SHALL surface, on the document detail, the current step's SLA due time and overdue
state, and SHALL render escalation entries from `approval_log` in the approval history timeline
(who it was escalated from, to whom, and when) alongside approve / reject / return entries.

#### Scenario: Timeline shows an escalation

- **WHEN** a document has been escalated for SLA breach
- **THEN** its approval history timeline shows the escalation entry with actor and timestamp

#### Scenario: Detail shows the current step due time

- **WHEN** an eligible approver opens an `IN_APPROVAL` document
- **THEN** the current step's SLA due time is shown, marked overdue when the due time has passed

### Requirement: An Approver Sees And Satisfies A Step's Evidence Requirement

Where the step a document is on requires a bank-transfer slip, the approval surface SHALL state the requirement and whether it is currently met, before the approver acts. The approve affordance SHALL be disabled while no slip is attached, and the reason SHALL be stated next to it rather than left to a failed request — a disabled control that does not say why is a defect report waiting to be filed.

A `PAYMENT_MANAGE` approver SHALL be able to attach the slip from the approval surface itself, without navigating to a payment screen, because the document is not payable yet and no payment screen applies to it. Once a slip is attached the approve affordance SHALL become available without the approver reloading the page.

An approver lacking `PAYMENT_MANAGE` SHALL be shown the requirement and its state but no upload control, mirroring the server's rules; the client guard is UX only and the server still enforces.

The reject and return affordances SHALL remain enabled regardless of the requirement, so a document that cannot be evidenced can still be sent back or refused.

The server SHALL remain the authority: an approval submitted while the requirement is unmet SHALL be refused with the reason, and the surface SHALL show that reason rather than a generic failure.

#### Scenario: The requirement is stated before the approver acts

- **GIVEN** a document at a step requiring payment evidence, carrying no slip
- **WHEN** an eligible approver opens it
- **THEN** the surface states that a transfer slip is required and that none is attached
- **AND** the approve affordance is disabled with that reason shown

#### Scenario: The approver attaches the slip in place

- **GIVEN** the same document opened by an approver holding `PAYMENT_MANAGE`
- **WHEN** the approver uploads a slip from the approval surface
- **THEN** the slip is attached to the document and the approve affordance becomes available

#### Scenario: An approver without the upload permission

- **GIVEN** an eligible approver holding neither `PAYMENT_MANAGE` nor an attached slip
- **WHEN** the approver opens the document
- **THEN** the requirement and its unmet state are shown with no upload control

#### Scenario: Rejecting stays available

- **GIVEN** a document at a step requiring evidence, carrying no slip
- **WHEN** an eligible approver opens it
- **THEN** the reject and return affordances are enabled

#### Scenario: A refusal from the server is explained

- **GIVEN** a slip deleted by another user after the approval surface was rendered
- **WHEN** the approver approves
- **THEN** the request is refused and the surface states that the required evidence is missing

### Requirement: Approve Waits for a Signature While Reject and Return Do Not

The web app SHALL disable the Approve action on the document detail when the eligibility check
for the document reports `SIGNATURE_REQUIRED` or the session context says `hasSignature: false`,
and SHALL show a message that a signature must be uploaded first, with a link to the profile
page (`/new/profile`). Reject and Return SHALL remain enabled: they stamp no signature. When the
server refuses an APPROVE with `SIGNATURE_REQUIRED`, the same message and link SHALL be shown and
the document SHALL be left where it was. Approving from the approvals inbox row SHALL follow the
same rule. This is a UX mirror; the server enforces.

#### Scenario: Approve is disabled for an approver without a signature

- **GIVEN** an eligible approver whose context says `hasSignature: false`
- **WHEN** they open a document waiting on them
- **THEN** Approve is disabled with the message and profile link, while Reject and Return are
  enabled

#### Scenario: Approve is enabled once a signature is on file

- **GIVEN** the same approver uploads a signature on the profile page
- **WHEN** they open the document again without reloading the app
- **THEN** Approve is enabled and the message is gone

#### Scenario: The server's refusal is shown in place

- **WHEN** an APPROVE is refused by the server with `SIGNATURE_REQUIRED`
- **THEN** the message with the profile link is shown and the detail still shows the document on
  the same step

### Requirement: Pending Summary Tab With Weekly Filters And Export

The approvals page SHALL offer, beside the inbox, a **pending summary** tab (route
`/approvals/summary`) available to any `DOC_VIEW` user, showing the documents still in approval
that the reader may see (`GET /approvals/pending-summary`) with roll-up cards (by department, by
step, by approver, and totals per currency) above a detail table (document number linking to the
document, type, requester, department, submitted date, days waiting, current step, waiting on,
amount in its own currency, SLA state).

The tab SHALL provide a filter bar with a department select and a document-type select whose
options come from the response's `facets` (not from a permission-gated master list), a
submitted-date range with **this week** / **last week** / **all** presets (weeks run Monday to
Sunday in the company's timezone), and an overdue-only toggle. Changing a filter SHALL re-request
the summary with the corresponding query parameters. The filter bar SHALL show active-filter chips
that can be removed individually.

An **Export to Excel** button SHALL download `GET /approvals/pending-summary.xlsx` with the filter
bar's current values, be disabled with a loading state while in flight, and report a failure
through the toast layer. Money SHALL be formatted using the row's currency `decimal_places` and
never handled as a JS number. Labels SHALL be rendered through i18n in `en`, `la` and `zh`.

#### Scenario: Last week's submissions for one department

- **GIVEN** the reader picks department A and the "last week" preset
- **WHEN** the summary loads
- **THEN** the app requests `pending-summary` with `departmentId` = A, `submittedFrom` = last
  Monday and `submittedTo` = last Sunday, and the cards and table show that set

#### Scenario: Export carries the filters on screen

- **WHEN** the reader clicks Export to Excel with those filters applied
- **THEN** the app requests `pending-summary.xlsx` with the same query parameters and saves the
  response as an `.xlsx`

#### Scenario: A reader without DOC_VIEW is not offered the tab

- **WHEN** a user holding `DOC_APPROVE` but not `DOC_VIEW` opens the approvals page
- **THEN** the summary tab is not shown

#### Scenario: The department options are the ones present

- **GIVEN** the reader's pending set spans departments A and B only
- **WHEN** the filter bar renders
- **THEN** the department select offers A and B with their counts, and nothing else

### Requirement: The Inbox Exports Its Pending Documents To Excel

The approvals inbox SHALL offer an Excel export to every user who can see the inbox. The export
SHALL download the payables workbook of the whole pending set under the filters and search
currently on screen — including a filter chosen a moment ago that the debounced reload has not
applied yet — and SHALL NOT be limited to the page shown. While the file is being prepared the
action SHALL show that it is busy and SHALL NOT start a second export. A failed export SHALL
explain itself in a toast and leave the action usable.

#### Scenario: Export follows the filters on screen

- **GIVEN** an inbox filtered to one department and a submitted-date range
- **WHEN** the approver exports
- **THEN** the downloaded workbook holds that department's pending documents in that range from
  every page, and no other

#### Scenario: A failed export is reported and recoverable

- **WHEN** the export request fails
- **THEN** a toast explains the failure and the export action is enabled again

### Requirement: Finance Registers Arrivals From The Inbox

The approvals inbox SHALL offer the documents list's intake affordances, gated identically, to
users holding `DOC_INTAKE_RECEIVE` or `DOC_INTAKE_REVERSE`:
- an intake column stating whether each document has been received and, when it has, by whom and
  when;
- row selection with a bulk receive action;
- a receive action on the row itself;
- a reverse action offered only with `DOC_INTAKE_REVERSE`.

A user holding neither code SHALL see the inbox without the column, the selection or the actions.

Whether a row may be received SHALL be the server's per-row `canReceive`, never a guess made by the
client. The bulk action SHALL count only the selected rows that may be received. After a batch, the
inbox SHALL report how many were received and SHALL name each refused document with its reason. The
selection SHALL be cleared whenever the rows shown change, so an action is never applied to a row
the user did not tick. Intake SHALL go through the same receive and reverse endpoints as the
documents list, so the two screens can never disagree about a document's intake state.

#### Scenario: Finance receives the week's arrivals from the inbox

- **GIVEN** a finance approver holding `DOC_INTAKE_RECEIVE`, with the inbox filtered to this week
- **WHEN** they tick several unreceived rows and register receipt
- **THEN** each of those rows reads as received, naming them and the time

#### Scenario: A received document stays in the inbox until it is acted on

- **GIVEN** a document finance has received but not yet approved
- **WHEN** finance views the inbox
- **THEN** the document is still listed, reads as received, and offers no receive action

#### Scenario: An approver with no intake duty sees the inbox unchanged

- **WHEN** a `DOC_APPROVE` user holding neither intake code opens the inbox
- **THEN** there is no intake column, no row selection and no receive action

#### Scenario: A partly refused batch names what it refused

- **GIVEN** a selection in which a colleague received one document a moment earlier
- **WHEN** the user registers receipt of the selection
- **THEN** the others read as received and the inbox names the refused document and why

#### Scenario: Paging clears the selection

- **GIVEN** a user who has ticked rows on page 1
- **WHEN** they move to page 2
- **THEN** no rows are selected and the bulk action counts zero

### Requirement: An Approver Re-Codes A Line's Account Where They Act

The document detail SHALL let an approver re-code a line's account where they act. Where the route
step a document is on allows account re-coding, the detail — the surface on which the approver acts
— SHALL let an approver who can act on the current step and holds `DOC_LINE_RECODE` change the
account of one line in place, from a picker limited to active,
postable accounts of the active company showing each account's code and name. The line's current
account SHALL be shown before the change, and the lines and the approval history SHALL refresh
after it without the approver reloading the page.

Whether the control is offered SHALL come from the document detail read, which SHALL report
whether the current route step allows re-coding and whether this viewer may re-code now — the
same gates the recode itself applies: document in approval, step allows it, viewer eligible — so
the surface mirrors the server's rule rather than re-implementing it; the client guard is UX only and the
server still enforces. Where the control is not offered the surface SHALL say why when the reason
is the step or the document's state, and SHALL say nothing when the reason is that the viewer is
not this step's approver — a requester does not need to be told what the accountant may do.

An approver lacking `DOC_LINE_RECODE` SHALL see the line's account but no control, mirroring the
server.

The approve, reject and return affordances SHALL be unaffected by whether any line was re-coded.

The approval history SHALL render a `RECODE_ACCOUNT` row in the approver's terms — which line,
from which account to which, by whom, when — in the same row shape as every other action,
localised.

The server SHALL remain the authority: a recode refused by the server SHALL show the server's
reason rather than a generic failure, and SHALL leave the line as it was.

#### Scenario: The control is offered to the eligible accountant

- **GIVEN** a document `IN_APPROVAL` on a step allowing re-coding, opened by an eligible approver
  holding `DOC_LINE_RECODE`
- **WHEN** the approver opens the document
- **THEN** each priced line's account is shown with a control to change it

#### Scenario: The approver re-codes a line in place

- **GIVEN** the same document, line 2 on `612.06`
- **WHEN** the approver picks `615.01` for line 2 and confirms
- **THEN** line 2 shows `615.01`, and the approval history shows a re-code row naming line 2,
  `612.06`, `615.01` and the approver

#### Scenario: An eligible approver without the permission

- **GIVEN** the same document opened by an eligible approver who does not hold `DOC_LINE_RECODE`
- **WHEN** the approver opens the document
- **THEN** the lines show their accounts and no control is offered

#### Scenario: A step that does not allow it

- **GIVEN** a document on a step whose allowance is off, opened by an eligible approver holding
  `DOC_LINE_RECODE`
- **WHEN** the approver opens the document
- **THEN** no control is offered and the surface says this step does not allow re-coding

#### Scenario: The server refuses

- **GIVEN** the control offered, and the document completed by another approver in the meantime
- **WHEN** the approver confirms a re-code
- **THEN** the surface shows the server's reason — the document is no longer in approval — and the
  line is shown as it was

#### Scenario: The history shows the move

- **GIVEN** a document whose line 2 was re-coded from `612.06` to `615.01` by an accountant
- **WHEN** any user who can read the document opens its approval history
- **THEN** a row between the surrounding approvals reads that line 2 was re-coded from `612.06` to
  `615.01`, naming the accountant and the time

