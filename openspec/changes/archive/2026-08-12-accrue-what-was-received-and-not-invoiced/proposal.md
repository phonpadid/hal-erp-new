## Why

A month can now be closed, and closing it does not make it complete.

`raise-the-payable-at-approval-not-at-payment` moved expense recognition from the cash to the
invoice, which is most of the way to accrual accounting. It left one gap and named it:

```
service received 28 Aug ──────────────► invoiced 5 Sep ──────► paid 20 Sep
       │                                      │
       │        ◄── August closes ──►         │
       │                                      │
  the obligation exists                  expense recognised
  August's books say nothing             in September
```

August understates both its expense and its liability, and September overstates its expense by the
same amount. Monthly statements are wrong in both directions for anything received near a boundary
— which, for a company that receives goods and services continuously, is a running error rather
than an edge case.

**This system can compute the gap, which most cannot.** `document_line.received_qty` is already
maintained by the receipt path, and three-way matching already links a disbursement to its purchase
order by `line_no`. So "received and not yet invoiced" is a query, not an estimate:

```
accrual = Σ over PO lines:  (received_qty − invoiced_qty) × the line's base unit amount
          where the item is NOT stock-tracked
```

Stock is excluded because it is already handled: goods capitalized at receipt raise `GRNI`, which
is the same accrual by another name. What has no counterpart is the service and the untracked
consumable.

`close-a-month-once-it-is-drained` said this belongs with the manual voucher, and the voucher
shipped in the change before this one. Everything needed now exists.

## What Changes

- **`document_line` records WHEN it was received**, not only how much. `received_qty` is a running
  total with no time attached, so "how much had been received as at the 30th" — the question this
  accrual asks — could not be answered from it at all. Stock lines have `stock_txn.created_at` to
  fall back on; a service or untracked consumable produces no stock movement and had nothing.
  **Scope grew here during implementation**: the change was drafted assuming the date was derivable
  and a test showed it was not. See the design's D6.
- **A new `ACCRUED_EXPENSE` account role**: the liability standing between a service being received
  and its invoice arriving. The same shape as `GRNI` — which is exactly what it is, for the goods
  and services `GRNI` does not cover.
- **Closing a period posts an accrual.** After the readiness check and before the status flips, the
  close computes what was received and not invoiced as at `period_end`, and posts one voucher:
  debit each purchase's expense account, credit `ACCRUED_EXPENSE`. Dated `period_end`.
- **And posts its reversal at once**, dated the first day after `period_end`. Posted immediately
  rather than deferred to the next close, so forgetting it is structurally impossible: an accrual
  whose reversal is a future intention is how the same expense gets recognised twice.
- **The expense account comes from the chain**, a fourth time. A PO line carries no budget — `PO` is
  not a budget-controlled type — so the account is the reserving ancestor's at the same `line_no`.
  This change extracts that walk into **one helper** used by all four places that need it, which
  `raise-the-payable`'s design said should happen if a fourth appeared.
- **Both entries are keyed to the period**, so re-closing cannot double-post them.
- **A period with nothing outstanding posts nothing.** No zero-value voucher, no empty entry.

Deliberately **out of scope**:

- **Recomputing the accrual after a reopen.** The entries are keyed by period id and the ledger is
  append-only, so the first close's accrual is the period's accrual: a reopen-and-reclose does not
  recompute it. If the figures changed in between, the operator reverses the accrual and posts a
  correcting voucher — both of which they can now do, and both of which leave a trail. Encoding a
  second attempt would need a sequence inside a uuid column, which is a worse answer than a visible
  manual correction.
- **Period-end FX revaluation.** Still needs the original currency of each open payable, which
  `journal_line` does not carry. Unchanged from where `raise-the-payable` left it.
- **Accruing anything but received-not-invoiced.** Depreciation, prepaid amortisation and payroll
  are vouchers a person writes; they are not derivable from a purchase order and nothing here
  pretends otherwise.
- **Reversing on the accrual's own schedule.** The reversal is always the day after `period_end`,
  which is the standard reversing accrual. A voucher that should unwind on some other date is a
  manual voucher.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `accounting-period`: closing gains the accrual and its reversal, and the requirement says what a
  close does and does not compute.
- `gl-journal`: `Config-Driven System Account Roles` gains `ACCRUED_EXPENSE`.

## Impact

**Backend**

- `back/src/common/enums/index.ts`, `erp_approval_system.dbml` — `ACCRUED_EXPENSE` in
  `account_role_type`, and `document_line.last_received_at`. One migration for the column; no new
  table.
- `back/src/modules/gl/received-not-invoiced.service.ts` (new) — the query: PO lines with
  `received_qty` beyond what has been invoiced, non-stock only, per expense account, in base
  currency.
- `back/src/modules/accounting/period/accounting-period.service.ts` — `close` posts the accrual and
  its reversal through `JournalVoucherService`.
- `back/src/modules/gl/gl-posting.service.ts` — the ref-chain line-account walk becomes one exported
  helper; `stockPortionByAccount`, the accrual and the payment path use it, and the new query is the
  fourth caller.
- `back/src/modules/document/document.entities.ts` and `receiving.service.ts` —
  `last_received_at`, stamped when a receipt advances `received_qty`.
- One migration adding that nullable column. Every existing row stays null: a receipt recorded
  before the column existed happened at a time nobody wrote down, and inventing one would be a guess
  dressed as data.
- `back/src/seed/seed-data.ts` — account `2200` and the `ACCRUED_EXPENSE` mapping, its own account
  rather than sharing `GRNI`'s.

**Invariants**

- Invariant 3 and 6: the accrual writes no `budget_txn`. It reads `received_qty` and purchase lines,
  and touches no budget.
- Invariant 2: both entries are appended and never edited; a correction is a reversal.
- Invariant 1: the query is company-scoped, and the voucher resolves accounts through the
  company-scoped resolver.

**Risk**

The accrual is computed from `received_qty`, so it is only as good as receipts being recorded
promptly. A company that receives goods and records the receipt a week later will accrue a week
short — the figure is right about what the system knows, and the system knows what it was told. That
is a process property rather than a defect, and it is worth stating because an accrual that looks
authoritative invites the assumption that it is complete.

Second: the accrual and its reversal are two entries in different periods, and the second one lands
in a period that is open. If somebody reopens the earlier period and reverses the accrual manually
without also reversing its reversal, the two stop cancelling. The pairing is only as strong as
whoever unwinds it understanding that it is a pair — which the memo on both entries says.
