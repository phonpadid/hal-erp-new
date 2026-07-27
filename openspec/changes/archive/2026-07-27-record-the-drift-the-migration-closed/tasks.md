## 1. Find the drift, and be sure it is drift

- [x] 1.1 Run `mikro-orm schema:update --dump` and filter its noise before reading anything as a
  finding: the deliberate database-level `check` constraints MikroORM does not model, and the one
  permanently spurious foreign-key drop the entity already documents.
- [x] 1.2 Confirm each survivor against the actual column, not the dump alone. One earlier
  "difference" was a deliberate check whose name did not end in `_check` and so escaped the filter —
  a filter by name will do that again.

## 2. Decide which side is right, one column at a time

- [x] 2.1 `pending_successor.status` — the entity's enum, because a status the outbox worker does
  not recognise is work the system has silently agreed never to do.
- [x] 2.2 `payment_batch_line.wht_amount` — not-null with a zero default, because every reader
  already treats it as a number that exists and there is no business state meaning "unknown".
- [x] 2.3 `document_settlement.id` — drop the default, because the ORM supplies the id and this was
  the only table of 74 declaring one.
- [x] 2.4 Write the reasoning into the migration, not only the commit message. The next person to
  read the dump needs the worked example more than the SQL.

## 3. Close it without touching data

- [x] 3.1 One migration for all three, with a `down` that reverses each.
- [x] 3.2 Zero any null `wht_amount` before the constraint so the migration is correct on a database
  that has them — and confirm this one does not, so nothing is actually rewritten.
- [x] 3.3 Re-run the dump and confirm it reports nothing beyond the known noise.
- [x] 3.4 Run the migrations against an empty database, confirm the same table count as the
  developed one, and boot the container against the result — the deployed path, not just the
  developed one.

## 4. Make the written model complete

- [x] 4.1 Reconcile the DBML's tables against a migrated database. `user_setting` was missing.
- [x] 4.2 Declare it, with a note on why it carries no `company_id`, so its absence is not read as
  the bug by someone who knows invariant 1.
- [x] 4.3 Correct the budget-balance note, which still subtracted ACTUAL and so described a formula
  that charges the budget twice.

## 5. Stop quoting a number that drifts

- [x] 5.1 Reword the entity-coverage requirement to ask for an entity per table rather than per
  thirty-seven tables, and say plainly that no requirement should carry the count.
- [x] 5.2 Correct the count where it is orientation rather than a rule: `openspec/config.yaml`,
  `README.md`, `back/README.md`, `CLAUDE.md`, `openspec/project.md`.
- [x] 5.3 Leave archived changes alone. They record what was true when written; editing them makes
  the record worse, not the document better.
