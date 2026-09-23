## Why

Finance receives the paper. A document travels down its approval route and, at the step the
company routes to the finance department, it lands on a finance officer's desk — but the system
has no record that it arrived. Finance currently reconciles the week's intake off-screen, and
nothing on the documents list distinguishes a document they have in hand from one still in
transit.

Two defects on the same screen block that work and are fixed here rather than around it:

- The list offers an Approve button on every in-approval row to anyone holding `DOC_APPROVE`,
  regardless of whether the route has reached them, and regardless of whether they raised the
  document themselves. **This is a live breach of invariant 8** (no self-approval) in the UI: the
  server still refuses, so nothing invalid is recorded, but the screen invites an action it will
  reject and tells a user they may approve their own request.
- The list never says who raised a document, so finance cannot tell whose request they are
  receiving without opening each one. The requirement was specified on both sides and never
  implemented — `back/src/modules/document/who-raised-it.spec.ts` and
  `front-end/src/views/documents/documents-list-requester-column.spec.ts` are committed, skipped,
  and annotated as "the specification of work still owed".

## What Changes

**Finance registers what arrived (new).**

- A document becomes *receivable* by a user when its recorded route (`document_approval_step`)
  contains a step that user is an eligible actor on, **and** the document has reached that step.
  Status is deliberately not consulted: documents reach finance while still in approval, and the
  user asked for exactly those.
- Two new permission codes: `DOC_INTAKE_RECEIVE` to register receipt, `DOC_INTAKE_REVERSE` to undo
  one. Separate codes because reversal is the privileged correction, not part of ordinary intake.
  Neither is `DOC_RECEIVE` — that code already means goods receipt against a PO's lines.
- Receipt is recorded in a **new append-only table `document_intake_log`** (invariant 2). Received
  state is *derived* from the latest row, never stored as a mutable flag — the same shape as
  `budget_txn`, and what makes a reversal a new row rather than an erasure.
- Receiving is **bulk**: the list is filtered (e.g. to this week), rows are ticked, one action
  receives them together. A document already received is refused, by name, and the rest of the
  batch still succeeds.

**The list stops offering actions the viewer cannot take.**

- The Approve button is rendered only for rows the server says are actionable by this user,
  sourced from the existing `/approvals/pending` read, which already applies the eligibility
  resolver and the self-approval exclusion. Not disabled — absent.

**Two new columns.**

- *Intake*: received (with who and when) or not, so a week's arrivals can be read at a glance.
- *Requester*: the raiser's name and department, resolved server-side, satisfying the two skipped
  spec files rather than replacing them.

No change to budget, quota, numbering, or FX. Not a breaking change: the new columns are
additive, and the endpoints are new.

## Capabilities

### New Capabilities

- `document-intake`: the finance intake register — which documents a user may receive (the
  reached-a-step-I-am-eligible-on rule), the append-only receipt log and the state derived from
  it, bulk receive, privileged reversal, and the permission codes gating each.

### Modified Capabilities

- `document-engine`: the document list read gains, per row, the raiser's name and department
  (resolved once per page, not per row) and the document's derived intake state.
- `web-documents`: the list shows an intake column and a requester column, offers bulk receive to
  users who may receive, and renders the Approve action **only** for rows the server reports as
  actionable by the viewer — replacing the always-rendered, sometimes-disabled button.

`approval-workflow` is depended on but **not** modified: the eligibility rule is read through the
existing `ApproverResolverService.eligible`, unchanged, so intake and approval can never disagree
about who a step belongs to.

## Impact

**Data model** — one new table, `document_intake_log`, added to `erp_approval_system.dbml`
(company-scoped per invariant 1, append-only per invariant 2) plus its migration. No column is
added to `document`: a mutable `received_at` there could not record a reversal, and would put a
derived value next to the ledger that defines it.

**Backend** — new `document-intake` service, controller and DTOs in the document module; two
permission codes added to the catalog (and therefore to `permissions:sync`, which the deploy
already runs); `DocumentService.list()` extended with requester and intake fields;
`who-raised-it.spec.ts` unskipped.

**Frontend** — `MyDocumentsView.vue` (row selection, bulk action, two columns, the Approve-button
rule), the documents API client and store, i18n for `en`/`la`/`zh`;
`documents-list-requester-column.spec.ts` unskipped.

**Invariants** — invariant 8 is currently breached by this screen and is repaired by it.
Invariant 5 constrains the design: the rule must never name the `FINANCE` role or the `FN`
department, even though in this company's data every workflow routes to exactly that role. It is
expressed as eligibility on a step, so a company that routes elsewhere gets the right answer with
no code change (invariant 7). Invariant 1 applies to the new table; invariant 2 governs its shape.
