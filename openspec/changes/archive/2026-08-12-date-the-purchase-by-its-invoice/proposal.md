# Date the purchase by its invoice

## Why

A company's VAT return is filed on dates the system generated for itself, and it cannot produce a
purchase listing at all.

**There is no invoice date.** `document` carries `submitted_at`, `approved_at` and `created_at`, and
none of them is the supplier's tax invoice date. The accrual posts on `approved_at` — the moment
somebody clicked approve — and the payment path posts on `paid_at`. Under VAT law the tax point for
input VAT is the **tax invoice**, and it is the supplier's invoice date and number that the revenue
authority matches a claim against.

So the two paths disagreeing about when input VAT is recognised, which an earlier change reported
and did not fix, is the smaller half of the problem. Making them agree on `approved_at` would be
consistency without correctness: an invoice dated the 28th and approved on the 3rd is claimed in the
wrong month either way.

**There is no invoice number either.** The purchase listing that supports a VAT return needs the
supplier's invoice number per line. `document.doc_no` is the company's own running number. Nothing
records the vendor's.

**And a rule that is no longer true tells administrators to avoid the only correct configuration.**
The DBML note on `accrues_on_approval` and the comment on the submit DTO both say it must not be set
together with `requires_payee` — "both debit the same accounts, so a type carrying both would
recognise its expense twice". That was true before the payable existed. It is not true now: the
payment path checks `accruedPayable()` and clears the payable instead of debiting expense a second
time, and `seed-data.ts` ships exactly that combination on `DISB`, deliberately and with a comment
explaining why. Nothing in the code enforces the rule. Two documents forbid the configuration the
reference data uses and the engine depends on.

## What Changes

- `document.vendor_invoice_no` and `document.vendor_invoice_date` — nullable columns, a migration,
  the DBML, the entity and the submit DTO.
- Submit requires both on a document that carries VAT **and** whose type accrues on approval — the
  documents that actually claim the VAT. See design D2.
- The approval accrual is dated the vendor invoice date, falling back to the approval date when the
  invoice's month is already closed. See design D3.
- The stale `requires_payee` / `accrues_on_approval` rule is corrected in both places it is written.
- The document form captures the two fields, gated the same way the payee field is.

## What This Change Does NOT Do

- **No second date on `journal_entry`.** A posting date distinct from a document date is the general
  answer and a bigger change; the fallback in D3 covers the case that makes it necessary, and the
  proposal for it belongs with the VAT return that would consume it.
- No purchase listing report. The number is now captured; the report that lists it is the tax
  settlement's work.
- No change to the payment path's VAT for non-accruing types. Those types recognise their expense at
  payment — cash basis by configuration — and their VAT follows the expense it belongs to. Whether a
  type should be cash-basis at all is a configuration question, not this change's.

## Impact

- Affected specs: `document-engine`, `purchase-tax`
- Affected code: `document.entities.ts`, the submit DTO and service, `gl-posting.service.ts`,
  `erp_approval_system.dbml`, a migration, `CreateDocumentView.vue`, `i18n/locales/{en,la,zh}/`
- Migration: two nullable columns. No data change — documents submitted before this have no invoice
  date and are not given a fabricated one.
