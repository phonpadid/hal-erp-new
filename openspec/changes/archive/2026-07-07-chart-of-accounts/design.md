## Context

`gl_account` exists today only as an unmanaged `varchar`: on `budget.gl_account` (part of
the `(fiscal_year, department, gl_account)` unique key), `document_line.gl_account`, and
`item.default_gl_account`. Validation is `z.string().min(1).max(255)` — no master, no
types, no hierarchy. Seed data hardcodes a single code `5000`. Reporting treats the string
purely as a grouping key. This slice adds the missing master record and a resolution guard,
so a GL code means a real account, while deliberately not yet introducing double-entry
posting. It is the foundation for later journal/GL, VAT/WHT, and financial-statement work.

## Goals / Non-Goals

**Goals:**
- A company-scoped `account` master (chart of accounts) with type, hierarchy, and
  postable/active flags; code unique per company.
- CRUD API + admin UI gated by new permission codes (`COA_VIEW`, `COA_MANAGE`).
- A single reusable resolver that turns a GL code into a validated active+postable account
  in the active company, called by budget-create and item-create/update.
- Referential integrity via a nullable `account_id` FK on `budget` and `item`, backfilled
  from existing codes, without altering append-only ledgers.

**Non-Goals:**
- No `journal_entry` / `journal_line`, no debit/credit, no posting engine (next slice).
- No changes to the budget balance formula, `budget_txn`, or reserve→actual→release.
- No VAT/WHT, bank/cash, fixed assets, or financial statements.
- No re-typing of `document_line.gl_account` in this slice (it is a snapshot carried on the
  line; it will be migrated when GL posting lands). This slice validates the budget source
  field only.
- No item GL validation: `item` is a group-wide master (extends `BaseEntity`, no
  `company_id`), so its `default_gl_account` has no single company to resolve against a
  per-company chart. It stays a free string this slice and is validated later when it flows
  onto a company-scoped `document_line` — the same deferral as `document_line.gl_account`.

## Decisions

**1. Store the account code on existing rows, add an FK alongside — not a hard type swap.**
`budget.gl_account` / `item.default_gl_account` keep their string column (so the budget
unique key and all reporting group-keys are untouched), and we add a nullable
`account_id uuid` FK referencing `account`. Writes must resolve to an account and set both.
_Alternative considered:_ replace the string with a NOT NULL FK immediately — rejected
because it forces a breaking migration on `budget`'s unique constraint and on
`document_line` snapshots before the master is even populated. The additive FK lets us
enforce at the service layer first and tighten to NOT NULL in a later slice once backfill
is proven.

**2. Account is company-scoped, code unique per company.** Unique index
`(company_id, code)`. Matches invariant #1 and mirrors how `budget`, `department`, etc. are
scoped. GROUP-scope consolidated reporting can read across companies read-only later; this
slice does not add cross-company account sharing.
_Alternative:_ a single group-shared chart — rejected as premature; companies in the group
may run different local charts (Thai vs Lao statutory), and per-company matches the
existing tenancy model.

**3. Account type is a fixed enum; hierarchy is a self-FK `parent_id`.**
`account_type ∈ {ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE}` (drives normal balance for
the future GL). `parent_id` gives a tree for reporting rollups; `is_postable=false` marks
summary/header accounts that cannot be selected on a budget/line. Validation forbids
cycles and cross-type parenting is allowed only under the same top-level type.

**4. Resolution guard is one service method, reused everywhere.**
`AccountService.resolvePostable(companyId, code | id): Account` throws a 400 when the
account is missing, inactive, non-postable, or belongs to another company. Budget-create
and item-create/update call it; the frontend Selects only offer active+postable accounts,
so the guard is defense-in-depth, not the sole check (mirrors the permission-code UX/enforce
split).

**5. Seed a minimal per-company chart and backfill.** On seed, create a small standard
chart per company including the existing `5000` expense account; a data migration maps
every distinct existing `budget.gl_account` / `item.default_gl_account` string to a seeded
account by code, setting `account_id`. Any string with no match is left with a null FK and
logged for manual mapping — enforcement of NOT-NULL is deferred to a follow-up slice so the
deploy is non-blocking.

**No budget_txn / quota_usage writes.** This change performs no ledger writes. Budget
creation already runs inside its existing `em.transactional()`; the only addition is a read
(`resolvePostable`) before the insert — no new lock is required because the account master
is validated by read, and the budget row itself is created as today. There is no paired-row
or reserve→actual→release sequence in this slice, so no new transaction boundary or
pessimistic lock is introduced.

## Risks / Trade-offs

- **[Existing GL strings don't map to any seeded account]** → Backfill logs unmapped values
  and leaves `account_id` null; the resolver enforcement applies to *new* writes only until
  a follow-up slice tightens NOT NULL. No current data is blocked or lost.
- **[Two sources of truth: `gl_account` string + `account_id` FK can drift]** → Writes go
  through the single resolver which sets both atomically from the resolved account; direct
  DB edits are out of scope. A later slice collapses to the FK alone.
- **[`document_line.gl_account` remains free-text this slice]** → Accepted: lines snapshot
  the budget/item GL at creation, so validating the source fields covers the realistic
  entry points; the snapshot is migrated with GL posting.
- **[Breaking change for API clients sending arbitrary GL strings]** → Documented as
  BREAKING in the proposal; the seeded default chart + backfill covers the app's own flows,
  and the error is a clear 400 naming the unknown code.
