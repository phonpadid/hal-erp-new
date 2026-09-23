## Context

`vendor` and `item` are group-wide tables with a unique `vendor_code` / `item_code` that the
create DTO takes verbatim from the caller. The web registry (`MasterDataView.vue`) shows a text
input for it and treats it as immutable after creation. Document numbering already solves the
"hand out the next number safely" problem for documents with `doc_running_number` +
`lockForUpdate` + `inTransaction`, but that counter is keyed by company + document type + year,
which does not fit a group-wide registry.

## Goals / Non-Goals

**Goals:**
- The system issues `V-nnnnn` / `I-nnnnn` on create; the caller cannot choose the code.
- Two concurrent creates never get the same code and never skip one (no gaps from lost races;
  gaps from rolled-back transactions are acceptable, as with document numbers).
- Generated codes never collide with legacy hand-typed ones.

**Non-Goals:**
- Renumbering existing vendors/items.
- Per-company or per-category prefixes.
- Letting an admin override the code on create.

## Decisions

### 1. A dedicated `master_sequence` table, not `doc_running_number`

`doc_running_number` requires `company_id` and `document_type_id` (both NOT NULL) and resets per
year. Bending it (a sentinel company, a fake document type) would put a lie in a table the
numbering spec reasons about. A two-row table is honest and cheap:

```
master_sequence { kind varchar pk ('VENDOR' | 'ITEM'), current_no int not null default 0 }
```

### 2. Same lock discipline as document numbering

`MasterSequenceService.next(kind)`: `inTransaction` → `lockForUpdate(MasterSequence, {kind})` →
`current_no += 1` → flush → return `${PREFIX[kind]}-${String(n).padStart(5,'0')}`. Rows are
seeded by the migration, so there is no `ensure()` race to handle. The vendor/item `create`
calls `next()` **inside its own transaction** together with the insert, so a failed insert rolls
the increment back too (no spent numbers on validation failures that happen after numbering).

### 3. Legacy-collision guard is done once, at migration

Seed `current_no` = max numeric suffix of existing codes matching the exact pattern. Codes that do
not match the pattern (`213`, `BANKPICK-DEMO`) cannot collide with a generated code by
construction. No runtime "skip if taken" loop: it would hide a broken counter behind a retry.

### 4. The code leaves the create schema entirely

`vendorSchema` / `itemSchema` in `@erp/shared` drop `vendorCode` / `itemCode`; the create DTOs
drop the field; class-validator's whitelist rejects it if sent. Keeping it optional-and-ignored
would let a client believe it chose the code. The read model (`Vendor`, `Item` entities, list
rows) is unchanged, so the edit dialog and table columns still show it.

### 5. Format `V-00001` / `I-00001`

Five digits, zero-padded, unbounded (`padStart` never truncates). The one item in the customer
copy is already `I-00001`, so the format is continuous with what exists.

## Risks / Trade-offs

- [An integration posts `vendorCode`] → 400 with the field named; grep shows no internal caller.
  Flagged in the proposal for the deploy checklist.
- [Legacy code `V-00007` typed by hand after the migration seeds at 6] → cannot happen: the create
  endpoint no longer accepts a code, and seeds write entities directly with non-pattern codes.
- [Rolled-back create leaves a gap] → accepted, identical to document numbering.

## Migration Plan

1. `Migration20260918000000`: create `master_sequence`, insert `VENDOR`/`ITEM` rows seeded from
   existing codes. `down()` drops the table.
2. Deploy backend + shared + frontend together (the form and DTO share one schema; a mismatch
   would make the form send a field the server rejects).

## Open Questions

None.
