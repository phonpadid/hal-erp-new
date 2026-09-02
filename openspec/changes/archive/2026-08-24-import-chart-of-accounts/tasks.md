## 1. Relax the hierarchy rule first

> Done first because the importer cannot write 46 of the customer's accounts until it is, and
> because it is the only part of this change that touches existing behaviour.

- [x] 1.1 Drop the `account_type` comparison from `AccountService.requireValidParent`. Keep the
      same-company check and the cycle walk exactly as they are.
- [x] 1.2 Leave a comment at the removal saying what it protected and why it was removed — no
      rollup reads `account.parent` — so it is not restored as an obvious-looking safeguard.
- [x] 1.3 Rewrite the existing rejection test in `account.service.spec.ts` into its inverse: an
      `ASSET` under a `REVENUE` parent is ACCEPTED and keeps its own type. Name the real pair from
      the customer's chart (`752.01` under `752`) in the test so the reason survives.
- [x] 1.4 Confirm the cycle and cross-company tests in that file still pass untouched.

## 2. Read a workbook

- [x] 2.1 Add `xlsx` to `back/package.json` — it reads BIFF `.xls` and OOXML `.xlsx` through one
      API, which `exceljs` does not.
- [x] 2.2 `chart-import/workbook-reader.ts`: open a file and return its first sheet as rows of raw
      cell values, `.xls` and `.xlsx` alike.
- [x] 2.3 Locate the header row by scanning the first 30 rows for `ເລກບັນຊີ` or `Acct. No.`, and
      return the column index of code, name, and class from THAT row. Refuse a file with no
      locatable header, naming the file.
- [x] 2.4 Read the name from the merged span between the code column and the class column — the
      exports put it across columns 3–18 and only the first carries a value.
- [x] 2.5 Unit-test the reader against both real files: it finds the header at row 14 in
      `ບັນຊີ (3).xls` and at row 13 in `ສາລະບານບັນຊີ 2026 (3).xls`, and yields 3,341 and 742
      accounts.

## 3. Merge and derive

- [x] 3.1 `chart-import/merge.ts`: merge several files' rows into one map keyed by code. Refuse the
      run when a code appears twice with a different name or class, naming both values.
- [x] 3.2 Derive the parent as the longest proper code prefix present in the merged set — dotted
      tail dropped first, then digits trimmed one at a time. Never read depth from a code's shape.
- [x] 3.3 Derive `is_postable`: false for an account with at least one child, true otherwise.
- [x] 3.4 Map the class column: ຊັບສິນ→`ASSET`, ໜີ້ສິນ→`LIABILITY`, ລາຍຮັບ→`REVENUE`,
      ລາຍຈ່າຍ→`EXPENSE`. For any other class, take the nearest ancestor carrying a mapped class;
      with no such ancestor, mark the row skipped with its reason.
- [x] 3.5 Fall back to the code as the name for the one row that carries none (`659222`), and
      report it.
- [x] 3.6 Return a plan: accounts to create, rows skipped with reasons, and the child/parent pairs
      whose types differ — the last purely to be reported.
- [x] 3.7 Unit tests on the real merged set: 4,083 codes, 0 collisions, 16 skipped and all of them
      class 5, 4,067 written under 6 roots, 179 headers, 31 cross-type pairs, and 742/742
      company-chart rows parented into the parent chart. (Measured during 3.7: skipping class 5
      also removes its 5 headers and 15 of the 46 cross-type pairs, and root `5` with it. The
      raw-chart figures in the design — 7 roots, 184 headers, 46 pairs — describe the file; these
      describe the import.)
- [x] 3.8 Unit-test the prefix rule directly on `1213110.20` → `1213` with `1213110` absent, and on
      a pair of equal-length codes differing only in separator position, which must not become
      parent and child.

## 4. Write

- [x] 4.1 `chart-import/chart-import.service.ts`: resolve the company by code, refusing an unknown
      one by name; refuse a run naming no company at all.
- [x] 4.2 Insert every planned account parentless, then set parents in a second pass, both inside
      one `em.transactional()` so a part-way failure leaves the chart as it was.
- [x] 4.3 Skip an account whose `(company, code)` already exists — never update, rename, re-parent
      or duplicate — and count it as unchanged.
- [x] 4.4 Stamp the named company on every row written (invariant 1) and assert in a test that a
      second company's chart is untouched by the run.
- [x] 4.5 DB-backed test: import both files into a fresh company, assert 4,067 accounts,
      `1017.0001`'s parent is `1017`, `1017` is not postable and its children are, and no class-5
      account exists.
- [x] 4.6 DB-backed test: run it twice, assert the second run creates nothing and modifies nothing.
- [x] 4.7 DB-backed test: a failure injected inside the transaction, after both passes have done
      their work, leaves zero accounts — plus its non-vacuous twin proving the same run writes
      4,067 when nothing fails. (First attempt hooked the forked EM's `flush` and never fired:
      `em.transactional` hands the callback an EntityManager of its own.)

## 5. The command

- [x] 5.1 `back/src/cli/import-accounts.ts` taking `--company <code>`, `--dry-run`, and one or more
      file paths.
- [x] 5.2 Print the report: created / unchanged / skipped counts, every skipped row with its
      reason, every cross-type child/parent pair, and the root codes with their child counts.
- [x] 5.3 `--dry-run` opens no write transaction, and reports the same counts the real run reports
      — asserted by a test that runs both over the same files.
- [x] 5.4 Register `import:accounts` in `back/package.json`.

## 6. Verify against the real thing

- [x] 6.1 Dry-run both customer files against the running database and read the report end to end.
      (4,067 to create · 16 skipped, all class 5 · 179 headers · roots 1,2,3,4,6,7 · 16 types taken
      from an ancestor · 1 row named by its code · 31 contra pairs.)
- [x] 6.2 Import for real into `HAL Co`, then confirm in the app: the accounts admin screen lists
      the chart, `1017.0001` shows `1017` as its parent, and a document line can pick a leaf but
      is refused `1017`. (Chart screen renders the Lao names with `1`→`10`→`101`→`1011` nested and
      marked non-postable; the postable picker offers 3,905 — 3,888 imported leaves plus the 17
      seeded rows — and none of `1`, `101`, `1011`, `1017`.)
- [x] 6.3 Confirm in Postgres that every imported row carries the company id, and that the 16
      class-5 codes are absent. (4,084 rows = 4,067 imported + 17 seeded, one company, 179 headers,
      no class-5 code, and `752.01` ASSET stored under `752` REVENUE.)
- [x] 6.4 Mutation-check the postability rule: make every account postable and confirm 4.5 fails.
      A chart where summary nodes can be posted to raises no error on its own — it just quietly
      accepts a wrong GL account. (`isPostable: true` for every row fails 4 tests across the unit
      and DB specs; restoring it returns 66/66.)
- [x] 6.5 Backend suite green (1,758 passed, 36 skipped); `tsconfig.build.json` clean.
- [x] 6.6 Sync the two specs into `openspec/specs/` and archive the change.
