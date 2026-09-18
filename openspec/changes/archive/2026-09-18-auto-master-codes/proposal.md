## Why

`vendor_code` and `item_code` are typed by whoever creates the record. Nobody has a scheme for
them, so the registry fills with `213`, `BANKPICK-DEMO` and whatever else came to mind, and a
typo on the immutable business key is permanent. The person adding a vendor is not the person
who should be inventing its key: the system should hand out the next number.

## What Changes

- **BREAKING (API):** `POST /vendors` and `POST /items` no longer accept `vendorCode` /
  `itemCode`. The server generates them — `V-00001`, `I-00001`, … — from a group-wide
  counter and returns the created record with its code.
- New table `master_sequence` (`kind` PK ∈ `VENDOR` | `ITEM`, `current_no`), incremented under
  `SELECT … FOR UPDATE` like `doc_running_number`. Seeded by the migration at the highest number
  already in use in the matching pattern, so generated codes never collide with legacy ones.
- The create dialogs in the web registry drop the code field; the edit dialog keeps showing it
  read-only, and the created code is shown in the success toast so the user can quote it.
- The shared Zod schemas split: `vendorSchema` / `itemSchema` no longer carry the code (the
  form and the create DTO share them); the code stays on the read model.
- Seeds and tests that create vendors/items with an explicit code keep working — they write the
  entity directly, not through the create endpoint.

Not in scope: renumbering existing records, or per-company prefixes (the registries are
group-wide, so the sequence is too).

## Capabilities

Touches `master-data` and `web-master-data`. Invariants: none at risk — the sequence is
group-wide by design because `vendor`/`item` are (invariant 1 is about `vendor_company` /
`item_company`, untouched). Concurrency rule: the counter is locked pessimistically and every
create is one transaction; a concurrency test is required.

### New Capabilities

(none)

### Modified Capabilities

- `master-data`: Group Vendor Registry and Group Item Registry gain "the code is issued by the
  system from a locked group-wide sequence"; the create DTOs stop accepting a code.
- `web-master-data`: Create and Edit Master Records — the create form asks for no code; the
  issued code is shown after save and read-only on edit.

## Impact

- **Migration**: `master_sequence` table + two seed rows (`VENDOR`, `ITEM`) whose `current_no`
  is `max(numeric suffix)` over codes matching `^V-\d+$` / `^I-\d+$` (0 if none).
- **DBML**: new table.
- **Backend**: `master-data.entities.ts` (MasterSequence), new `master-sequence.service.ts`,
  `vendor.service.ts` / `item.service.ts` create, `dto/vendor.dto.ts` / `dto/item.dto.ts`,
  `shared/src/index.ts` schemas.
- **Frontend**: `MasterDataView.vue` dialogs, i18n (en/la/zh) for the "code will be assigned"
  hint and the toast.
- **API consumers** sending `vendorCode`/`itemCode` on create get `400` (whitelist validation
  rejects unknown properties) — check integrations before deploy. `grep` shows no internal
  caller besides the web registry.
