## Why

Company HAL runs a disbursement workflow — `ອະນຸມັດໃບເບີກຈ່າຍແລະອັບໂຫຼດສະລິບການໂອນ`, five sequential
steps — in which finance transfers the money at step 4 and the remaining approver signs off on a
transfer that has already happened. Nothing makes the slip a condition of that step, so step 4 can
be approved on an assurance that the money moved, and the document completes with the evidence
still missing. The company already tried to close this: a `requires_payment_slip` flag was added on
a branch that is not being merged, and it was never enforced — the flag existed and approval never
read it.

The gap is not merely that the flag is absent. A slip cannot be attached at approval time at all:
`payment_attachment` hangs off `payment`, and a `payment` row is only written by
`PaymentService.recordPayment` after the document is fully approved. Evidence for a step 4 approval
therefore has nowhere to live until well after the approval it was supposed to justify.

## What Changes

- A workflow step gains `requires_payment_slip`. When set, an APPROVE on that step is refused unless
  the document already carries at least one slip. Reject, return and delegate are unaffected — a
  step that cannot be approved must still be refusable.
- The refusal happens inside the existing approve transaction, next to the current
  `assertApprovable` post-action gate and before the `approval_log` row is written, so a refused
  approval leaves no audit row, no step movement and no released hold.
- **BREAKING (data model):** `payment_attachment.payment` becomes nullable and the row gains a
  NOT NULL `document`. A slip now names the document it evidences; the payment becomes the optional
  second fact, filled in when one is recorded. Existing rows are backfilled from
  `payment.document_id`, which is NOT NULL today, so every current row keeps its meaning.
- Slip upload, list, download and delete work for a document with no payment yet. Today all four
  resolve the payment first and 404 when there is none.
- The workflow-step admin form gains the checkbox, and the step configuration mutation carries and
  validates the flag.
- The approval screen tells the approver that this step needs a slip, shows whether one is attached,
  and lets them attach it in place rather than sending them to a payment screen that does not yet
  apply to this document.
- One existing row is restored to `true`: step 4 of the HAL workflow above
  (`1c7648af-1bf1-427d-894c-b144f35ecba9`), whose prior value is held at
  `~/erp-backup-2026-09-01/csv/workflow_step__requires_payment_slip.csv`.

Explicitly out of scope: changing when a payment may be recorded, and changing the existing rule
that a hand-recorded payment must carry evidence in the same request. Those govern a different
moment and a different actor, and this change does not relax either.

## Capabilities

### New Capabilities

None. Every behaviour here extends a capability that already exists.

### Modified Capabilities

- `payment-slip`: a slip is anchored to a document rather than to a payment, so evidence may exist
  before a payment does; the permission gates, storage rules and company scoping are unchanged.
- `approval-workflow`: a step may declare that it requires payment evidence; an APPROVE on such a
  step is refused while the document has no slip; step configuration mutations carry the flag.
- `web-doc-config`: the workflow step form offers the requirement as a checkbox (Requirement:
  Workflow and Step Management).
- `web-approvals`: the approval screen states the requirement, its current state, and offers the
  upload that satisfies it.
- `web-payments`: the slip panel reads and writes slips for a document that has no payment yet.

## Impact

**Schema** — `workflow_step.requires_payment_slip` (boolean, NOT NULL, default false);
`payment_attachment.document_id` (uuid, NOT NULL, FK to `document`, indexed);
`payment_attachment.payment_id` becomes nullable. One migration, backfilled before the NOT NULL is
applied. The database is live: 42 documents, 6 existing `payment_attachment` rows, 29
`workflow_step` rows.

**Backend** — `approval.entities.ts` (`WorkflowStep`), `payment.entities.ts` (`PaymentAttachment`),
`approval-routing.service.ts` (the approve gate), `payment-attachment.service.ts` (resolve by
document, not by payment), `payment-handoff.service.ts` (`slipStatus` for a slip with no payment),
`workflow-config.service.ts` and its step DTO.

**Frontend** — `WorkflowStepCreateView.vue` and its Zod schema, the approval action dialog,
`PaymentSlips.vue`, `stores/payments.ts`, `api/payments.ts`, and i18n for `la`, `en`, `zh`.

**Invariants** — `approval_log` stays append-only: the gate refuses before the row is written, never
after. Company scoping is unchanged; a slip is reachable only through a document in the active
company. Authorization stays on permission codes (`PAYMENT_MANAGE` to upload, `PAYMENT_VIEW` to
read, `PAYMENT_SLIP_DELETE` to delete) — the approve gate reads the flag but grants nothing. No
`budget_txn` or `quota_usage` is written by any path here; evidence settles nothing.

**Concurrency** — the approve path is touched, so it needs a test that two approvers racing the same
step cannot both pass the gate, and that a slip uploaded concurrently with an approval either
satisfies the gate or does not, with no in-between.
