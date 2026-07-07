## 1. Data model & migration

- [x] 1.1 Add `tax_code` to `erp_approval_system.dbml`: `id`, `company_id`, `code`, `name`, `kind` enum (VAT/WHT), `rate decimal(9,6)`, `is_active`, unique `(company_id, code)`.
- [x] 1.2 Add tax columns to the DBML: `document_line.tax_code_id` + `tax_amount decimal(15,2)`; `document.sub_total` / `tax_total` / `grand_total` / `base_tax_total decimal(15,2)`.
- [x] 1.3 Add the `tax_kind` enum (VAT/WHT) to `back/src/common/enums`, and add `VAT_INPUT` + `WHT_PAYABLE` to the `AccountRoleType` enum (only VAT_INPUT is used this slice).
- [x] 1.4 Create the MikroORM `TaxCode` entity (company-scoped); add `taxCode` + `taxAmount` to the DocumentLine entity and the tax totals (`subTotal` / `taxTotal` / `grandTotal` / `baseTaxTotal`) to the Document entity.
- [x] 1.5 Generate the migration (create `tax_code`; add the columns + FK/indexes) and verify it applies cleanly.

## 2. Permission codes

- [x] 2.1 Add `TAX_VIEW` and `TAX_MANAGE` permission codes (registry + seed grant to admin).

## 3. Backend: tax module & VAT computation

- [x] 3.1 Scaffold a `tax` NestJS module: `TaxCode` entity wiring, service, controller, DTOs.
- [x] 3.2 Implement company-scoped tax-code CRUD (create/update/list/deactivate) with `(company_id, code)` uniqueness, `TAX_VIEW` / `TAX_MANAGE` guards, `ParseUUIDPipe` on id params.
- [x] 3.3 Implement `TaxService.computeLineVat(netLine, taxCode, decimalPlaces)` and a document-totals helper (`sub_total` / `tax_total` = Σ rounded line VAT / `grand_total`), all via the `Money` decimal helper.
- [x] 3.4 Implement a `TAX_VIEW` read: input VAT by period (company-scoped, read-only).

## 4. Backend: wire into submit and GL posting

- [x] 4.1 In the document submit flow, compute per-line VAT and stamp `tax_amount` + document totals in the existing submit transaction; set `base_total_amount` to the tax-inclusive grand total and `base_tax_total = toBase(tax_total)` at the locked daily rate, while keeping `budget_base_line_amount` (reserve/actual basis) pre-tax.
- [x] 4.2 Extend `GlPostingService.postForPayment`: add a Dr `VAT_INPUT` line for `document.base_tax_total` when non-zero; keep cash-clearing at `base_actual` and the Σdebit = Σcredit assert.

## 5. Seed

- [x] 5.1 Seed a default Thai VAT code per company (`VAT7` 0.07) and the `VAT_INPUT` `account_role` mapping (adding a VAT-input asset account to the chart).

## 6. Frontend

- [x] 6.1 Add a Tax Codes admin view (list + create/edit) gated by `TAX_VIEW` / `TAX_MANAGE`, with API client, Pinia store, and a shared Zod schema.
- [x] 6.2 On the document create/line editor, add a VAT tax-code Select per line and show the document `sub_total` / `tax_total` / `grand_total`.
- [x] 6.3 Add a read-only Input-VAT Summary view (VAT by period) gated by `TAX_VIEW`, with route + nav entry.
- [x] 6.4 Add i18n keys (en + la) for the tax admin, tax kinds, line/document tax labels, and the summary.

## 7. Tests

- [x] 7.1 Unit: `computeLineVat` rounds per line; document `tax_total` equals the sum of rounded line amounts (no drift), and `grand_total = sub_total + tax_total`.
- [x] 7.2 Unit: submit stamps line `tax_amount` + document totals + `base_tax_total`, and the reserved budget uses the pre-tax base (VAT does not change the budget).
- [x] 7.3 Unit: GL posting for a VAT settlement debits expense + VAT_INPUT and credits cash, balanced (Σdebit = Σcredit).
- [x] 7.4 Unit: tax-code CRUD enforces `(company_id, code)` uniqueness and company isolation; authorization rejects without `TAX_MANAGE` / `TAX_VIEW`.
- [x] 7.5 Unit: a line/document with no tax code is untaxed (`tax_amount` 0, `grand_total = sub_total`) and its settlement entry omits the VAT line (backward compatibility).
- [x] 7.6 Frontend: tax-code form validation; the per-line VAT select and document totals render.
