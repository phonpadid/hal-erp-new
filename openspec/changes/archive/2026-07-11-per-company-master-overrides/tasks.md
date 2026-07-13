## 1. Schema + entities

- [x] 1.1 Add `default_gl_account varchar [null]` to `item_company` and remove
  `default_gl_account` from `item` in `erp_approval_system.dbml`
- [x] 1.2 Add `payment_term_days int [null]` to `vendor_company` in `erp_approval_system.dbml`
- [x] 1.3 Add `defaultGlAccount?` to `ItemCompany` and `paymentTermDays?` to `VendorCompany`;
  remove `defaultGlAccount` from the `Item` entity
- [x] 1.4 Migration: add the two columns, backfill `item_company.default_gl_account` from each
  item's `item.default_gl_account` (per enabled company), then drop `item.default_gl_account`

## 2. Master-data backend

- [x] 2.1 Remove `defaultGlAccount` from `CreateItemDto` / `UpdateItemDto` and the item
  create/update service
- [x] 2.2 Extend enable DTOs to accept `defaultGlAccount` (item) / `paymentTermDays` (vendor)
- [x] 2.3 In `ItemService.enableForCompany`, persist the GL and — when non-null — validate it via
  `AccountService.resolvePostable` (active company); reject a non-postable code
- [x] 2.4 In `VendorService.enableForCompany`, persist the `paymentTermDays` override
- [x] 2.5 Replace `ItemService.defaultGlAccountFor(itemId)` with a company-scoped lookup that
  returns the active company's `item_company.default_gl_account` (no group read)
- [x] 2.6 Make the company-enabled vendor read expose the effective terms
  (`vendor_company.payment_term_days` ?? `vendor.payment_term_days`)
- [x] 2.7 Unit tests: item GL validated on enable (postable ok / non-postable rejected); item
  line GL comes from the per-company value and is company-scoped; vendor terms override + fallback

## 3. Document-engine

- [x] 3.1 Confirm `DocumentService.writeLines` item-line path derives GL from the company-scoped
  `ItemService` lookup; the "no GL → reject on requires_budget" path now keys on the missing
  per-company GL
- [x] 3.2 Update/extend the item-line GL tests (gl-account-autofill / doc-type specs) to seed the
  GL on `item_company` instead of `item`

## 4. Frontend

- [x] 4.1 Remove the GL field from the group item create/edit form and the item Zod schema / DTO
  type
- [x] 4.2 In the enablement UI, add the item GL picker (Select from the active company's postable
  accounts, label "name (code)") and the vendor payment-term input; show effective values
- [x] 4.3 Reuse/add a postable-accounts read for the active company to populate the picker
- [x] 4.4 Update the enable API types / shared schema for the new fields

## 5. i18n + verification

- [x] 5.1 Add en/la strings for the per-company GL picker and payment-term fields
- [x] 5.2 Run `openspec validate --changes per-company-master-overrides --strict`
- [x] 5.3 Backend suites green (master-data enable + validation, document-engine item-line GL);
  migration applies + backfills cleanly on a seeded DB, and item lines resolve from `item_company`
- [x] 5.4 Frontend `vue-tsc` clean for the changed files
