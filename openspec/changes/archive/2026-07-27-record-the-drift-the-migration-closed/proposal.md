## Why

The entities and the migrations had drifted apart in three places, and the drift was closed in a
migration that went in without a proposal. The judgement at the time was that it introduced no
behaviour — it made the database enforce rules the specs already stated — so no requirement was
changing and no change was owed.

That judgement was half right. Nothing new was introduced. But "the specs already stated it" is
exactly the claim that deserved writing down, because the specs stated it about the *code* and the
database had been free to disagree since the day each column was created. `pending_successor.status`
is described in `successor-outbox` as `PENDING` / `DONE` / `FAILED`; the column was a bare varchar,
so a typo could be written and the outbox worker would simply never pick that row up again.
`payment_batch_line.wht_amount` is treated across `payment-batch` and `gl-journal` as an amount that
always exists — every export is "net of `wht_amount`" — and the column allowed null, which
`netAmount()` survived only because it defensively coalesced.

A rule that lives in one layer and not the other is not enforced; it is merely intended. The
migration turned three intentions into constraints, and this records that, along with the reasoning
about which side of each disagreement was right — because the next person to find a difference
between an entity and a column has to make the same call and deserves to see how it was made.

Two related pieces of rot are cleared at the same time. The DBML omitted `user_setting` entirely, a
real table nobody had written down. And the count of tables, quoted as "37" in four separate
documents, had been wrong for so long that it was off by half — including inside a live requirement,
which is the one place a stale number can be mistaken for a rule.

## What Changes

- **`pending_successor.status` becomes a checked set.** The column was varchar with no constraint
  under an entity declaring an enum. The entity is right: an outbox row whose status is not one the
  worker recognises is invisible work.
- **`payment_batch_line.wht_amount` becomes NOT NULL, defaulting to zero.** A line either withholds
  something or withholds nothing; there is no third state for it to be in.
- **`document_settlement.id` loses a default no other table has.** The ORM generates the id, so
  `gen_random_uuid()` never fired. Of 74 tables it was alone in declaring one.
- **`user_setting` is written into the DBML**, with a note on why it carries no `company_id` —
  preferences follow the person across companies, so invariant 1 does not reach it.
- **The table count stops being a number in prose.** The live requirement that asks for an entity
  per table says so without quoting a total, which is what drifted; the READMEs are corrected.

Every row present already satisfied all three constraints, so the migration rewrote no data.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-foundation`: a new requirement that a rule the entities express is enforced by the
  database too; and the existing entity-coverage requirement stops quoting a table count that
  drifts.

## Impact

- `back/src/migrations/Migration20260807000000.ts` — three constraints, no data rewritten.
- `erp_approval_system.dbml` — `user_setting` added; the budget-balance note already corrected.
- `openspec/specs/platform-foundation/spec.md` — one requirement reworded, one added.
- `openspec/config.yaml`, `README.md`, `back/README.md` — the stale count.
- Archived changes keep their original numbers: they record what was true when they were written,
  and editing them would be falsifying a record rather than fixing a document.
- No entity change, no endpoint change, no API surface change.
