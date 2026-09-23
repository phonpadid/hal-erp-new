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

