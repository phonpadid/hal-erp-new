## Context

Two of the three moments in a purchase already produce an entry. The first does not.

```
                      goods/service        invoice           payment
                       received            approved
stock-tracked line     Dr INVENTORY        Dr GRNI           Dr AP
                       Cr GRNI             Cr AP             Cr CASH        ✓ complete

untracked line         (nothing)           Dr EXPENSE        Dr AP
                                           Cr AP             Cr CASH        ✗ gap at the front
```

The gap is only visible at a period boundary, and there it is unavoidable: everything received in
the last days of a month and invoiced in the first days of the next is expensed in the wrong month,
and the liability is missing from the balance sheet in between.

What makes this computable rather than estimable is that the data already exists:

| needed | already there |
|---|---|
| what was received | `document_line.received_qty`, maintained by the receipt path |
| when it was received | **nothing** — see D6, which is why this change grew a column |
| what was invoiced | disbursement lines matched to their PO by `line_no` (three-way matching) |
| at what value | `budget_base_line_amount`, the base-currency amount at the locked rate |
| which is stock | `item.is_stock_tracked` — the same flag the GRNI split reads |
| a way to write it | `JournalVoucherService`, shipped in the previous change |

## Goals / Non-Goals

**Goals:**

- A closed month's expense includes what it consumed, and its balance sheet the liability that
  created.
- The accrual unwinds by itself, so the invoice that follows is not counted twice.
- The fourth copy of "the budget account behind a chained line" becomes the last.

**Non-Goals:**

- Accruing anything that is not derivable from a purchase order. Depreciation and payroll are
  vouchers a person writes.
- Recomputing after a reopen. See D4.
- FX revaluation, still blocked on a subledger that carries the original currency.

## Decisions

### D1 — Accrue from `received_qty` minus what has been invoiced, per PO line

```
for each PO line of the company, dated on or before period_end:
    outstanding_qty = received_qty − Σ (invoiced qty on disbursements referencing this PO
                                        at the same line_no)
    if outstanding_qty <= 0            → nothing
    if item.is_stock_tracked           → nothing (GRNI already holds it)
    amount = outstanding_qty × (budget_base_line_amount / qty)
```

The unit basis is `budget_base_line_amount / qty` rather than `unit_price`, for the reason the
receipt path already uses it: it is the base-currency amount at the rate the document locked, so the
accrual, the budget cut and the eventual invoice are all measured the same way. Using `unit_price`
would mix a document-currency figure into a base-currency ledger.

An item-less line accrues. `PO` is not a `requires_item` type, and a free-text line for a service is
exactly the case with no other coverage.

### D2 — The expense account comes from the chain, and this is the fourth time

`PO` is not budget-controlled — the seeded type is `{ requiresVendor: true }` and nothing more — so
its lines carry no budget and no account. The account belongs to the document that reserved: the
`PROC` above it, at the same `line_no`.

```
PostActionService.cutBudget            reservingAncestorBudgetByLine   ← 1st
GlPostingService.settlementActuals     walks for ACTUAL rows            ← 2nd
GlPostingService.accountByLineOf       (via stockPortionByAccount)      ← 3rd
this query                                                             ← 4th
```

`raise-the-payable`'s design said: *"If a fourth appears, it should become one helper."* It has, so
it does. The helper is the one `stockPortionByAccount` already uses — resolve a document's line
accounts by `line_no`, walking `ref_document_id` to the nearest ancestor that has them — exported
and shared rather than copied a fourth time.

Consolidating the other three is deliberately **not** part of this change: they work, their tests
pass, and rewriting three working call sites to prove a point about duplication is how a small
change becomes a risky one. The helper is shared by the two that can be shared cheaply; the note
stays for whoever touches the others.

### D3 — The reversal is posted at once, not owed

```
close(August)
  ├─ voucher   dated 31 Aug   Dr expense  Cr ACCRUED_EXPENSE
  └─ voucher   dated  1 Sep   Dr ACCRUED_EXPENSE  Cr expense
```

Both in the same operation. A reversal that is a future intention is how an expense gets recognised
twice: the accrual sits in August, the invoice arrives in September, and nothing removes the first
unless somebody remembers. Posting the pair together makes forgetting impossible rather than
unlikely.

Dating the reversal `period_end + 1` is the standard reversing accrual and needs no configuration.
It cannot land in a closed period: periods close in order, so the day after one that is closing is
either in an open period or in none.

### D4 — Keyed to the period, which means computed once

Both entries take the period's id as their `source_id`, under `PERIOD_ACCRUAL` and
`PERIOD_ACCRUAL_REVERSAL`. The uniqueness `journal_entry` already has then makes a re-close a no-op
rather than a double-post.

The consequence is that **the accrual is computed on the first close and never recomputed**. A
reopen-and-reclose keeps the original figure even if receipts changed in between. The alternatives:

| option | verdict |
|---|---|
| a sequence in the source key (`periodId#2`) | rejected: `source_id` is a uuid column |
| a fresh uuid per close, tracked elsewhere | rejected: invents a second identity for the same thing |
| **compute once; correct by hand when it matters** | **chosen** |

The third is honest and now actually possible: an operator reverses the accrual and posts a
correcting voucher, both visible, both attributed. Before the previous change it would have been no
answer at all.

### D5 — Nothing outstanding posts nothing

A period with no received-not-invoiced lines produces no voucher. An entry with no lines cannot
balance meaningfully, a zero-value entry says nothing, and both would make the journal noisier for
every company that invoices promptly.

### D6 — `received_qty` has no time on it, and the accrual needs one

**Found by a test, after the rest of this design was written.** The accrual is "what was received as
at `period_end`", and the first implementation approximated that with the purchase order's
`created_at` — which is when somebody raised the order and says nothing about when the goods
arrived. Closing a month that had already passed accrued nothing at all, because the orders were
raised after it.

There was no better column to reach for:

```
received_qty          a running total, no timestamp
stock_txn.created_at  has the time — but only for stock-tracked lines,
                      which are exactly the ones this accrual EXCLUDES
```

So the question was unanswerable from the data, and three options followed:

| option | verdict |
|---|---|
| accrue what is outstanding *now*, whenever the close runs | correct when a month is closed promptly, overstates when it is closed late — and quietly |
| **record `last_received_at` and filter on it** | **chosen** |
| defer the accrual until a receipt-date change ships | the same work, one change later |

The column is nullable and every existing row stays null, because a receipt recorded before it
existed happened at a time nobody wrote down. A null is treated as "received at some unknown point
in the past" and therefore **included**: the goods were received, and excluding them would
understate silently rather than admit the gap.

The wider value is not the accrual — it is that "what did we receive in March" becomes answerable
for services at all, which it was not.

## Risks / Trade-offs

**The accrual is only as good as receipts being recorded.** A company that receives on Monday and
records it on Friday accrues Monday-to-Thursday short at a month end that falls between. The figure
is correct about what the system knows; it is not correct about the world. Worth stating because an
accrual that looks authoritative invites the assumption that it is complete — and the fix is a
process one, not a code one.

**The pair can be broken by hand.** The accrual and its reversal are two entries in two periods, and
someone who reverses only the first leaves the second standing. Both memos say they are a pair, and
that is the whole of the protection.

**A late invoice for a much larger amount still lands wholly in its own month.** The accrual
estimates from the order; if the invoice arrives at twice the ordered value, August accrued the
ordered figure and September carries the difference. That is correct — the difference was not known
in August — but it will look like a variance nobody can explain without knowing this exists.

## Migration Plan

An enum value and a seed role mapping. No table, no migration, no backfill: periods closed before
this ships have no accrual, and manufacturing one for them would restate months already reported.

## Open Questions

- Whether the accrual should exclude PO lines whose `line_status` is `CLOSED`. Today a closed line
  with `received_qty > invoiced_qty` would still accrue, which is arguably right — the goods were
  received and never billed — and arguably a data-entry artifact. Left as-is because nothing in this
  system closes a line for a reason other than being fully received.
