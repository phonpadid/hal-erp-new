## 1. The flags reach the client

- [x] 1.1 Add `requiresEmployee`, `requiresWarehouse` and `accruesOnApproval` to the document-type
      shape in `front-end/src/api/docConfig.ts`, matching the names the create/update DTOs accept
- [x] 1.2 Add the three to the shared Zod schema the document-type form resolves against, as optional
      booleans defaulting to `false`, so client and server validation do not drift
- [x] 1.3 Include them in `DocTypeFormView.vue`'s `initialValues` (create: all false) and in the
      mapping that seeds the form from an existing type (edit)

## 2. The document-type form offers them

- [x] 2.1 Extend `FLAGS` in `components/doc-config/DocTypeFormFields.vue` with `requiresEmployee` and
      `requiresWarehouse`, keeping the existing one-switch-per-flag rendering
- [x] 2.2 Add `accruesOnApproval` to the form — it is not a `requires_*` flag (it changes WHEN the
      expense is recognised, not what the requester must supply), so render it outside the
      requirement group, beside `default_gl_account`, with its own label
- [x] 2.3 Write the three hints in `en`, `la` and `zh` `admin.ts`: employee — "the requester must name
      the employee this document is about, and it is who the ready-to-pay queue will show as owed";
      warehouse — "the requester must name the stock location; required by every stock post-action";
      accrual — "the expense is recognised when the document is fully approved, not when it is paid"
- [x] 2.4 Show an inline message when `requiresPayee` is on and `requiresVendor` is off, quoting what
      the server refuses: a payee is a vendor's bank account, so the field would have nothing to offer
- [x] 2.5 Show an inline message when `accruesOnApproval` is on and neither `requiresBudget` nor
      `requiresVendor` is, and when it is on with `requiresBudget` but a post-action that does not
      settle — the two guards in `document-type.service.ts`
- [x] 2.6 Leave enforcement on the server: the messages inform, and the request is still what decides.
      Do not add a client-side refusal that the server does not make

## 3. The list shows them

- [x] 3.1 Add `requiresEmployee` and `requiresWarehouse` to the flag badge set in
      `views/admin/doc-config/DocTypesView.vue`, following the existing `requiresPayee` badge
- [x] 3.2 Leave the list's requirement filter as it is (budget / quota / vendor / item) — the spec
      names that set, and widening it is a separate decision

## 4. Seed a travel reimbursement type

- [x] 4.1 Add `TRAVEL` / `Travel Reimbursement` / `FINANCE` to the `docTypes` array in
      `back/src/seed/seed-data.ts` with `requiresBudget: true`, `requiresEmployee: true`,
      `accruesOnApproval: true`, `postAction: 'CUT_BUDGET'` — and nothing else, so no vendor, no
      payee, no item and no warehouse
- [x] 4.2 Write the comment above it in the style of `CLAIM`'s: what it is, why it names an employee
      and not a vendor, why that is what makes the accrual credit `CLAIM_PAYABLE`, why it settles its
      own reservation, and that it is paid by hand because a person has no bank account in this system
- [x] 4.3 Confirm by reading the loop below the array that `TRAVEL` gets a published form template, the
      required `reason` field, the Standard Approval workflow and a `dept_doc_type` mapping without
      any further code — and that no branch in that loop tests for the code `TRAVEL`
- [x] 4.4 Re-run the seed against an existing database and confirm it is idempotent: one `TRAVEL` row,
      no duplicate template, no duplicate mapping. `seed.spec.ts` already re-ran the seed but counted
      only permissions and users, so a duplicated type would have passed it — widened the count to
      `document_type`, `form_template` and `dept_doc_type`, which is what the seeded loop creates

## 5. Tests

- [x] 5.1 Backend: the SEEDED `TRAVEL` type carries the flag combination that makes a reimbursement
      payable — employee required, no vendor, no payee, own budget, accrues, settles. Rewritten from
      "assert the submit gate for a non-HR type": that gate branches on `requiresEmployee` alone and
      `authoring-and-subject.spec.ts` already pins all three of its cases, so a FINANCE-category copy
      would have re-tested one branch while the seeded configuration — the thing a flag flip breaks
      silently — stayed unasserted
- [x] 5.2 Backend: a fully approved `TRAVEL` document writes an accrual debiting the budget's account
      and crediting `CLAIM_PAYABLE`, from its OWN ACTUAL rows, with no reference chain
- [x] 5.3 Backend: that document appears in the ready-to-pay queue with `payableKind: 'CLAIM'`,
      `owedTo` equal to the employee's full name, and no `payee`
- [x] 5.4 Backend: building a `payment_batch` from it is refused, naming the missing payee account —
      the existing refusal, asserted for this shape so nobody later reads the absence as a bug
- [x] 5.5 Backend: recording a payment for it by hand with no slip and no prior attachment is refused;
      with a slip it succeeds and the document leaves the queue
- [x] 5.6 Frontend: the document-type form saves `requiresEmployee`, `requiresWarehouse` and
      `accruesOnApproval`, and renders them when editing a type that carries them
- [x] 5.7 Frontend: the payee-without-vendor and accrual-without-source messages appear on the
      combinations the server refuses, and the form can still be submitted (the server answers)
- [x] 5.8 Frontend: covered by the existing `create-document-review-completeness.spec.ts`, which
      drives `needsEmployee` through a `requiresEmployee` type end to end. The computed reads the flag
      and nothing else — not the category, not the post-action — so a FINANCE-category duplicate
      would assert the same branch twice. No test written; recorded here rather than ticked silently

## 6. Verify in the app

- [x] 6.1 Start the dev stack, create a `TRAVEL`-shaped type through the admin screen alone, with no
      seed and no database edit — this is the hole the change exists to close. Done against the local
      app: budget + employee + accrual set, `CUT_BUDGET` chosen, saved, listed with its new badges,
      and re-opened for edit with all three rendering back. The accrual-must-settle message appeared
      while the post-action was empty and cleared when `CUT_BUDGET` was picked. No console errors
- [x] 6.2 Raise a travel reimbursement against a travel budget, name an employee, approve it through,
      and confirm the ready-to-pay queue names that employee. Done end to end. The first attempt
      (`TRAVEL-HAL-2026-0001`) could not be approved — admin raised it and invariant 8 forbids
      self-approval — so it was withdrawn, releasing its reserve in full. `TRAVEL-HAL-2026-0002` was
      then raised as `jek` (a STAFF member of the budget's own department) through an API key bound
      to that user, and approved by admin: no self-approval, no password handled, key revoked after.
      The queue shows it owed to `ທ່ານ ສີສະຫວັນ ມາຢົງເຊິນ`, GL `625.01`, no payee — which is the
      whole question this change answers
- [x] 6.3 Record the payment with a slip and confirm it leaves the queue and the document reads
      UPLOADED in the documents list. MinIO came up (docker started, bucket `halepr-bk` created,
      API restarted). Recorded against `TRAVEL-HAL-2026-0002` with a real uploaded slip:
      `POST /payments/:id` → 200, `baseActual 1000`, `whtAmount 0`; the document no longer appears
      in `GET /payments/handoffs`; `POST /payments/slip-status` reports `UPLOADED`; the slip is
      listed via `GET /payments/:id/slips` (id `0f0991c3-1ab4-4f13-a466-adbc1d97eb15`,
      `slip.png`)
