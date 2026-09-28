## Why

`REC-HAL-2026-0026` on production, a draft whose currency was just corrected from LAK to THB, shows:

| tile | value | |
| --- | --- | --- |
| ຍອດລວມ | `42,000.00 THB` | correct, live |
| ຍອດລວມສະກຸນຫຼັກ | `42,000 LAK` | **stale** |
| ອັດຕາແລກປ່ຽນ (ລ໋ອກຕອນສົ່ງ) | `1.00` | **stale** |

The screen is asserting that 1 THB = 1 LAK and that 42,000 THB = 42,000 LAK. Both are wrong by a
factor of about 690.

`document.exchange_rate` and `document.base_total_amount` are written only at submit. This document
was submitted while it was still LAK — the company base — so the rate resolved to the identity 1 and
the base total to the document total. Being returned to `DRAFT` and having its currency corrected
changes neither: invariant 6 says a stamped rate is never recomputed, and the correction path
deliberately does not touch them. Resubmitting re-stamps both correctly, and a test already asserts
that. The defect is entirely in what the screen claims in the meantime.

`DocumentDetailView` gates these two tiles on `isForeignCurrency` alone, with no status condition, so
a draft displays a stamp belonging to a submission that has been superseded. The documents list does
the same with its base-total column.

This state is newly reachable. Until `draft-currency-correctable`, a document's currency could not
change, so a stamped rate always belonged to the currency the document named; the two could not
contradict each other. That change was shipped with the staleness noted as "pre-existing and not
currency-specific" — true of the mechanism, and wrong about the consequence.

The spec already says what should happen. *Detail shows locked rate and formatted base amounts* is
written against "a **submitted** foreign-currency document"; only the implementation is missing the
condition.

## What Changes

- The detail view SHALL NOT present a base-currency total, a locked exchange rate, or a lock date
  while the document is `DRAFT`. A draft has no submission whose rate is locked — either it has never
  been submitted, or the submission its figures came from was withdrawn by the return that put it
  back in `DRAFT`.
- The documents list SHALL show its base-currency column as empty for a `DRAFT` row, using the empty
  state that column already has for a document carrying no base total.
- Nothing about what is shown once a document has left `DRAFT` changes. Its currency can no longer
  change there, so its stamp always matches it.
- **No server change.** No stored value is altered, cleared or recomputed; invariant 6 is untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-documents`: *Document List and Detail* states that the locked rate and base amounts belong to
  a submitted document, and that a draft shows neither.

## Impact

Touches **web-documents** only.

- `front-end/src/views/documents/DocumentDetailView.vue` — the two tiles gain the status condition.
- `front-end/src/views/documents/MyDocumentsView.vue` — the base-total column's draft case.

No migration, no DTO change, no endpoint.

Deliberately excluded: showing a draft's total in its OWN currency in the list instead of an empty
cell. `DocumentSummary` carries no currency code, so that needs the list read to grow one — a server
change, and a different requirement from this one. The author of a draft already sees the live
figure, with an advisory base conversion, on the edit wizard.
