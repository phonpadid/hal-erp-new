## Context

Two tools describe this database and they are not the same tool. The specs build their schema from
the **entities**; the deployed database is built from the **migrations**. Nothing compares them
except `mikro-orm schema:update --dump`, which nobody runs on a schedule, and which is the only
reason these three differences were found at all.

The dump is noisy. Roughly eighteen `check` constraints exist in the database that MikroORM does not
model — deliberate, hand-written guards added by migrations (`company_correction_window_check`,
`attendance_day_minutes_non_negative_check`, and so on) — and the dump proposes dropping every one
of them on every run. There is also one permanently spurious foreign-key drop on
`app_user_current_signature_id_foreign`, already documented in the entity, caused by breaking an
entity graph cycle. Reading the dump means filtering that noise, and a fourth "difference" reported
in an earlier pass turned out to be one of those deliberate checks whose name simply does not end in
`_check`. Anything claimed from this dump has to survive that filter before it is called drift.

What survived:

```
  pending_successor.status         entity: enum PENDING|DONE|FAILED     db: varchar, unconstrained
  payment_batch_line.wht_amount    entity: default 0, not nullable      db: nullable
  document_settlement.id           entity: no default                   db: gen_random_uuid()
```

## Goals / Non-Goals

**Goals:**

- Close the three differences so the deployed schema enforces what the entities express.
- Record which side of each disagreement was judged correct, and why, so the next person to read the
  dump has a worked example rather than a coin toss.
- Make the written model (DBML) complete, and stop the parts of it that drift from being quoted as
  fact.

**Non-Goals:**

- Removing the deliberate database-level check constraints MikroORM does not model. They are guards
  the entities cannot express, and the dump's suggestion to drop them is wrong, not a finding.
- Teaching MikroORM about those constraints so the dump comes back clean. That is a larger piece of
  work and would trade real guards for a tidier report.
- Any behaviour change. If a caller can tell the difference, something has gone wrong.
- Rewriting archived changes that quote the old table count.

## Decisions

**The entity wins all three.** Not by rule — by argument, one column at a time.

`pending_successor.status` — the entity's enum is the worker's contract. The outbox polls for
`PENDING`; a row holding anything else is work the system has silently agreed never to do. A varchar
column makes that failure writable. Constraining it means a bad write fails loudly at the moment it
happens instead of becoming an obligation that quietly evaporates.

`payment_batch_line.wht_amount` — every reader already treats it as a number that exists. The export
is specified as the payable "net of `wht_amount`"; `netAmount()` subtracts it. Both of those work on
a null only by accident: one because SQL coalesces upstream, one because the code coalesces
defensively. Nullable here means "we do not know whether tax was withheld", and there is no business
state that corresponds to not knowing.

`document_settlement.id` — here the entity wins by being unremarkable. The default never fires
because the ORM supplies the id before insert. Of 74 tables this was the only one carrying such a
default, and it arrived with a table written three migrations ago. A convention with a single
exception costs more to remember than it saves.

**The migration asserts rather than repairs.** It runs an `update` to zero any null `wht_amount`
before adding the constraint, but there were none — the statement is there so the migration is
correct on a database that does have them, not because this one did. Nothing else rewrites data. If
a constraint had failed against existing rows, that would have been a finding about the data, and it
would have needed a decision of its own rather than a quiet fix inside a cleanup.

**The DBML gains `user_setting` rather than a note saying it is elsewhere.** The DBML claims to be
the authoritative model; a table it omits is a claim that the table does not exist. Its lack of
`company_id` is recorded as deliberate, because a reader who knows invariant 1 will otherwise read
the omission as the bug.

**A count in prose is removed, not corrected.** "37 tables" was wrong in four places, one of them a
live requirement. Correcting it to 75 fixes today and guarantees the same conversation later. The
requirement now asks for an entity per table in the DBML, which is the thing actually meant and
which cannot go stale. The READMEs still carry the number, because a README is orientation rather
than a rule — but the requirement no longer does.

**Archived changes keep their numbers.** They describe what was true when they were written. Editing
them to agree with today would make them a worse record, not a better one.

## Risks / Trade-offs

**The dump stays noisy, so this can happen again.** The eighteen unmodelled checks mean nobody can
glance at `schema:update --dump` and see "clean"; drift will keep hiding among them. Mitigated only
partly: the CI gate now runs the migrations against an empty database on every deploy, which catches
a migration that cannot build the schema at all — but not one that builds a schema differing from
the entities in a way that still works. Closing that properly means either modelling the checks or
diffing the two schemas directly, and neither is in scope here.

**A checked enum turns a silent bad write into a failed one.** That is the point, but it is a
behaviour change for any code path that was writing an unrecognised status and getting away with it.
Nothing in the codebase does — the enum is used everywhere the column is written — and every
existing row is `DONE`. The risk is a write path outside the application, and there is none.

**`NOT NULL` on `wht_amount` is a one-way door in practice.** Reverting it is trivial in the
migration, but any row written in the meantime carries a real zero where it might once have carried
null, and the two are no longer distinguishable. Accepted: the distinction had no meaning.
