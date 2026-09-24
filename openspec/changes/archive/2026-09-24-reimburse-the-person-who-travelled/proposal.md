## Why

An employee travels for work, pays out of their own pocket, and comes back to be reimbursed. The
company owes a PERSON, and no document type can say so.

The nearest type is `CLAIM`, and it is the wrong one. `CLAIM` is fed by the external claim
integration — a parcel carrier's lost-and-damaged system posting customer compensations over the
API — and `docs/claim-integration.md` states the contract plainly: "The ERP does not know your
customers or your employees. Whatever identifies the claimant must travel as field values." A travel
reimbursement raised as a `CLAIM` therefore reaches the ready-to-pay queue with `owedTo` empty:
finance is shown an amount, a GL account, and nobody to pay. Adding `requires_employee` to `CLAIM`
instead of a new type is not an option — it would refuse every submit the external system makes.

The type that WOULD express it cannot be configured. `requires_employee` has been enforced at submit
since the HR types shipped (`document-submit.service.ts`), the create and update DTOs accept it, and
`document-type.service.ts` persists it — but the document-type form's flag list is
`requiresBudget / requiresQuota / requiresVendor / requiresItem / requiresPayee`. `requires_employee`,
`requires_warehouse` and `accrues_on_approval` appear on no screen and in no client type. They are
settable only by seeding the database, which this capability's own post-action requirement already
names as not configuration — and it is silent, because a shorter list of switches looks complete.

So there are two holes, and the second is why the first cannot be closed by an administrator today.

## What Changes

- The document-type form offers `requires_employee`, `requires_warehouse` and `accrues_on_approval`
  alongside the flags it already offers, each with a hint saying what it forces the requester to
  supply or when the expense is recognised. The client type and Zod schema carry them, mirroring the
  server DTO.
- The form states, before the request is sent, the two cross-flag rules the server already refuses:
  a payee without a vendor, and an accrual with neither budget nor vendor. The server stays the
  enforcer; the screen stops presenting a save that can only fail.
- The document-type list shows the new flags as badges, so a type's obligations are readable without
  opening it.
- A `TRAVEL` document type is seeded — `requires_budget`, `requires_employee`,
  `accrues_on_approval`, `post_action = CUT_BUDGET`, and deliberately no vendor, no payee, no item.
  A fresh install can then reimburse a person without anyone hand-writing a row, for the same reason
  `CLAIM` is seeded: a path only tests can reach is one whose tests are the only thing holding it up.
- The ready-to-pay queue's existing behaviour — naming the related employee when no vendor is
  present — is written into the spec, which today only says a claim appears there.

Explicitly out of scope, and both are real limits of what ships here:

- **Paying a person through a bank batch.** A payee is a `vendor_bank_account`, `employee` has no
  bank account at all, and `requires_payee` without `requires_vendor` is refused by an existing
  guard. A `TRAVEL` document is therefore paid by hand and recorded with a slip, which the payment
  path already forces. Giving an employee a bank account is a schema change and its own proposal.
- **The advance chain.** `ADVANCE → CLEAR_ADVANCE` is already a seeded ref-chain pairing that is
  skipped because neither type exists. Money paid before the trip, then cleared, is a different
  document and a different settlement; this change is reimbursement after the fact.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-doc-config`: the document-type form and list carry every requirement flag the engine
  enforces, not the subset that shipped (Requirement: Document Type Management).
- `payment-handoff`: the ready-to-pay queue's identification of who is owed is specified for the
  case where the payee is a person rather than a vendor.

## Impact

**Schema** — none. No migration. Every column this change uses exists: `document_type.requires_employee`,
`requires_warehouse`, `accrues_on_approval`, and `document.related_employee_id`.

**Backend** — `back/src/seed/seed-data.ts` only (one entry in the `docTypes` array; the loop below it
already gives a new type its form template, its `reason` field, its Standard Approval workflow and
its `dept_doc_type` mapping). No service, DTO or entity changes — they already accept the flags.

**Frontend** — `components/doc-config/DocTypeFormFields.vue` (the `FLAGS` list and hints),
`views/admin/doc-config/DocTypeFormView.vue` (initial values and the schema), `api/docConfig.ts`
(the type), `views/admin/doc-config/DocTypesView.vue` (badges), and i18n for `en`, `la`, `zh`.

**Invariants** — company isolation is untouched: a type belongs to the active company and
`requires_employee` is already checked against the document's own company at submit. Authorization
stays on `DOC_CONFIG_MANAGE`. No ledger is written by anything here; the seeded type's accrual and
settlement run on paths that already exist and are already tested. Configuration over code
(invariant 7) is the point of the change — the behaviour is entirely in `document_type` flags, and
nothing branches on the code `TRAVEL`.

**Concurrency** — none. Nothing here reserves budget, issues a number, or writes an append-only
ledger.
