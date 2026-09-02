## Context

Two Excel files in `data/account/`, both exported from the customer's accounting system, both
laid out identically: a title block of merged cells, a header row at row 13–16
(`ເລກບັນຊີ` / `Acct. No.`, `ຊື່ບັນຊີ ພາສາລາວ`, `ໝວດບັນຊີ` / `Type.`, `ຍອດເຫຼືອ` / `Balance.`,
`ຂອດວຽກ` / `Cat`), then one account per row with the code in column 2, the name spread across
merged columns 3–18, the type in column 19 and the normal balance in column 23.

`ບັນຊີ (3).xls` (3,341 rows) is the parent chart. `ສາລະບານບັນຊີ 2026 (3).xls` (742 rows) holds
the accounts this company actually posts to. They belong to **one** company, and they interlock:

- the two files share **no code at all** — the union is 4,083 accounts with nothing to reconcile
- every one of the 742 company-chart rows finds its parent in the parent chart — **742/742**

The chart is a French/Lao-style 7-class chart:

| class | accounts | head | `ໝວດບັນຊີ` |
|---|---|---|---|
| 1 | 960 | current assets | ຊັບສິນ |
| 2 | 223 | non-current assets | ຊັບສິນ |
| 3 | 21 | capital | ໜີ້ສິນ |
| 4 | 1,114 | third-party liabilities | ໜີ້ສິນ |
| 5 | 16 | suspense / awaiting clearing | ອື່ນໆ |
| 6 | 982 | expenses | ລາຍຈ່າຍ |
| 7 | 767 | revenue | ລາຍຮັບ |

The system has no Excel reader, no import path of any kind, and a seeded chart of about a dozen
invented codes. Every GL-account consumer has therefore only ever been exercised against fixtures.

## Goals / Non-Goals

**Goals:**
- One command that takes these two files and leaves the company holding its real chart.
- Derive what the files do not state — the hierarchy and postability — from the data itself, and
  say so out loud rather than inferring quietly.
- Refuse to write anything it could not place, and be safe to run a second time.
- A dry run that is honest about what the real run would do.

**Non-Goals:**
- A permanent upload endpoint or an import screen. That is a product feature with permissions, a
  file-size limit, and a result view; this is a bootstrap step for a company being set up.
- Opening balances. The files carry a normal-balance *kind* (`ໜີ້`/`ມີ`/`ສະສາງ`), not amounts.
- The budget plan and the 5,715-row spend history — separate changes, in that order.
- Preserving `ຂອດວຽກ`, `ຍອດເຫຼືອ`, or the running number. Nothing in this system reads them.

## Decisions

### The hierarchy comes from the longest existing code prefix

The files have no parent column. The parent of an account is the longest **proper prefix of its
code that is itself an imported account**: the dotted tail is dropped first, then digits are
trimmed one at a time, and the first candidate that exists wins. `1213110.20` → `1213110`? no →
`121311`? no → … → `1213` ✓.

Measured over the merged set: 4,076 of 4,083 get a parent, and the seven left over are exactly the
class heads `1`–`7`. The tree is four levels deep, with 184 accounts holding children.

*Alternative rejected — parse depth from the code's shape.* This is the mistake the budget change
had to undo: in the customer's budget plan `1.1` is a category and `1.101` a line beneath it, both
with one dot. Their account codes are kinder, but the lesson stands — look up what exists rather
than reading meaning into a string. The prefix rule uses only membership, never shape.

*Alternative rejected — import flat, with no parent at all.* Nothing in the system rolls a figure
up the account tree today, so a flat chart would function. It would also show an administrator
4,083 sibling rows and no way to see that `1017.0001` sits under `1017`, and it would throw away
structure the data plainly contains.

### `is_postable` is derived from having children, because the file does not say

`ຂອດວຽກ` (Cat) looked like a postable flag. It is not: its values 0/1/2/3/4 fall across headers
and leaves alike — 121 headers and 2,190 leaves both carry `0`. Whatever it means, it does not
mean this.

So: an account that ends up with at least one child is a header and gets `is_postable = false`
(184 accounts); everything else is postable (3,899). This is the definition the rest of the system
already assumes — `resolvePostable` refuses a non-postable account, and a summary node should never
be a posting target.

### The account type is the file's own column, with two named exceptions

`ໝວດບັນຊີ` maps ຊັບສິນ → `ASSET`, ໜີ້ສິນ → `LIABILITY`, ລາຍຮັບ → `REVENUE`,
ລາຍຈ່າຍ → `EXPENSE`. 4,051 of 4,083 rows carry one of those four.

For the 32 that do not (31 say `ອື່ນໆ`, one is blank):

1. **Take the nearest ancestor that has a standard type.** This settles 16 of them — the `1027.x`
   advances under class 1 become `ASSET` (11) and the `4218.x` customer refunds under class 4
   become `LIABILITY` (5).
2. **When no ancestor has one either, skip the row and report it.** That is exactly the 16
   accounts of class 5 — suspense and awaiting-clearing, whose own head is `ອື່ນໆ`. They map to no
   `AccountType`, and inventing one would file a real account under a class its owner did not put
   it in. **4,067 accounts are imported; 16 are skipped and named in the report.**

Class 3 is imported as `LIABILITY`, following the file's column, even though the head reads
`ບັນຊີ ທຶນ` (capital) and the system has an `EQUITY` value that would fit. The customer's
bookkeeper classified those 21 accounts, and the column is the classification.

### Type does not have to match the parent's — the spec rule goes

`AccountService.requireValidParent` rejects a parent whose `account_type` differs from the child's.
The customer's chart breaks that in **46 places**, and they are not mistakes:

| child | | parent | |
|---|---|---|---|
| `752.01` | ຊັບສິນ | `752` | ລາຍຮັບ |
| `1213183.20` | ໜີ້ສິນ | `1213` | ຊັບສິນ |
| `7081.304` | ຊັບສິນ | `708` | ລາຍຮັບ |

These are contra accounts filed under the head they offset — ordinary double-entry bookkeeping.
(46 is the count in the raw chart. Fifteen of those pairs have a class-5 account on one side and
leave with it, so 31 survive among the accounts actually written. Both numbers are true of
different things, and the tests say which is which.)
The rule exists to protect rollups, and **no report, balance or posting path in this system rolls
a figure up the account tree**: `account.parent` is read by the admin list to print a parent code,
and by the cycle check. Nothing else. So the rule would reject 46 real accounts to protect
something that does not exist.

Same-company and no-cycles stay. Only the type comparison goes, and the spec says why, so nobody
restores it as an obvious-looking safeguard.

*Alternative rejected — keep the rule and import those 46 parentless.* They would be the only
accounts in the chart with no place in it, chosen by a rule the customer's accountant does not
share.

*Alternative rejected — keep the rule and let the importer write rows directly, bypassing the
service.* An import path with different rules from the API is two definitions of a valid account,
and the looser one is invisible.

### Reading `.xls` and `.xlsx`

The parent chart is `.xls` (BIFF) and the budget workbook that a later change will need is
`.xlsx`. `xlsx` (SheetJS) reads both from one API; `exceljs` does not read BIFF. Chosen for that
reason alone.

The header row is **found, not assumed**: the reader scans the first 30 rows for the one holding
`ເລກບັນຊີ` or `Acct. No.` and takes its column positions. Both files put it at a different row
(13 and 14), and a fixed offset would silently read the wrong columns of the next export.

### Idempotence by code, per company

A row whose `(company, code)` already exists is skipped and counted as `unchanged` — never updated,
never duplicated. An import is not a sync: overwriting a name someone corrected in the app because
a stale spreadsheet still holds the old one is a worse failure than doing nothing.

### Two passes inside one transaction

Accounts are inserted parentless first, then the parent links are set in a second pass, both inside
one `em.transactional()`. A self-referencing tree cannot be inserted in dependency order without
sorting it first, and the sort is the thing most likely to have a bug. Either the whole chart lands
or none of it does.

No budget or quota row is written, so no `budget_txn` sequencing note applies and nothing is
locked: this writes only `account` rows, for a company being set up, before any ledger exists.

## Risks / Trade-offs

- **A later export changes column positions** → the header row is located by its labels each run,
  and a file with no locatable header is refused rather than read at an offset.
- **The prefix rule attaches an account to the wrong parent** → the dry run prints every derived
  parent, and a mis-parented account has no functional effect today (nothing rolls up); it is
  correctable in the admin screen.
- **Dropping the same-type rule lets a genuine typo through in hand entry** → accepted, and stated
  in the spec. The check was never load-bearing; the type of an individual account is still
  validated against the enum.
- **The 16 skipped class-5 accounts are needed later** → they are named in the report, and adding
  them is a one-row-per-account admin task once someone decides what they are.
- **4,083 rows in a picker** → out of scope here, but worth knowing: the document line and budget
  forms filter to postable accounts, which is 3,899. If that proves unusable, the fix is a
  searchable picker, not a smaller chart.

## Migration Plan

1. `pnpm import:accounts --company <code> --dry-run data/account/*.xls` — prints the counts, the
   derived tree, the 16 skips and the 46 cross-type parents. Writes nothing.
2. Read the report. Confirm the counts match the table in the proposal.
3. Re-run without `--dry-run`.
4. Verify in the app: the admin chart lists 4,067 accounts, `1017.0001` shows `1017` as its parent,
   and a document line can pick a leaf account but not `1017`.

**Rollback**: the accounts of a company that has posted nothing can be deleted by company id. Once
anything references an account, deactivate instead — which is the existing rule, not a new one.

## Open Questions

- Which company code these 4,067 accounts belong to. The files name
  `ບໍລິສັດ ຮຸ່ງອາລຸນໂລຈີສຕິກ` and `ບໍລິສັດ ຮຸ່ງອາລຸນຂົນສົ່ງດ່ວນ` in their title blocks but are one
  company's chart; the running system has `HAL Co`. Needed at run time, not at build time — the
  command takes `--company`.
- Whether the 16 class-5 suspense accounts should later become `ASSET`, or whether the
  `AccountType` enum should gain a value for them. Deliberately not decided here.
