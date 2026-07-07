## Context

Purchase documents are tax-exclusive today: `document_line.line_amount = qty × unit_price`, the
document carries `total_amount` / `base_total_amount` / `budget_base_total_amount` but no tax, and
only `tax_id` (a registration number) is stored. The chart of accounts, the `account_role` map,
and the double-entry GL (`gl-journal`) now exist and post a balanced entry on `payment.settled`.
This slice adds purchase-side tax — input VAT computed on the document and withholding tax (WHT)
deducted at payment — and extends the GL posting to include both, reusing the role map and the
existing dual-base split (budget base vs. payment/FX base).

## Goals / Non-Goals

**Goals:**
- A company-scoped `tax_code` master (kind VAT | WHT, rate) — rates are configuration (invariant 7).
- Per-line VAT on documents (`document_line.tax_code_id` + `tax_amount`) and document tax totals
  (`sub_total` / `tax_total` / `grand_total`), computed at submit.
- WHT at payment (`payment.wht_amount` + `wht_tax_code_id`, defaulting from the vendor), so the
  vendor is paid net of WHT and a WHT-payable liability is recorded.
- GL posting of input VAT (`VAT_INPUT`) and WHT-payable (`WHT_PAYABLE`) in the settlement entry,
  keeping Σdebit = Σcredit.
- A read-only tax summary (VAT input by period; WHT by vendor), `TAX_VIEW`-gated; seed default Thai
  VAT/WHT codes.

**Non-Goals:**
- **WHT at payment is deferred** to a follow-up under this capability (it needs payment-flow and
  GL changes and is cleanly separable). The `tax_code.kind` and `AccountRoleType` enums include the
  WHT values now so the follow-up needs no schema churn, but nothing computes WHT here.
- No statutory returns (PP30, PND3/53) or e-filing, no tax-invoice numbering/printing.
- No output VAT / sales-AR side (there is no AR subledger yet).
- No change to the budget basis: input VAT is recoverable and is NOT charged to the budget.

## Decisions

**1. VAT rides the payment/FX base; the budget base stays pre-tax (reuses the existing split).**
The model already separates `budget_base_total_amount` (BUDGET_RATE, the reserve/actual basis)
from `base_total_amount` (daily rate, the payment/FX basis). VAT is folded into the **payment
base only**: at submit, `budget_base` stays `Σ net line base` (unchanged — budget reserves/cuts
the pre-tax amount, invariants 3/4), while `base_total_amount` becomes `(net + VAT) × daily rate`
= the `grand_total` the vendor is billed. So the budget ledger is untouched and the payment settles
the tax-inclusive amount.
_Alternative:_ put VAT into the budget basis too — rejected; recoverable input VAT is not a budget
expense, and it would distort every budget balance.

**2. `tax_code` carries rate + kind only; the GL account comes from `account_role`.**
`tax_code` = `{ code, name, kind: VAT|WHT, rate, is_active }`, company-scoped, unique per company.
The posting engine resolves the account by role (`VAT_INPUT` for VAT, `WHT_PAYABLE` for WHT) via the
existing `account_role` map — no per-code account link, consistent with the gl-journal role decision
(invariant 7).

**3. VAT computed at submit, per line, summed to the document total (no drift).**
Inside the existing submit transaction, each line's `tax_amount = round(net_line × tax_code.rate,
currency.decimal_places)`; `sub_total = Σ net`, `tax_total = Σ line tax_amount`, `grand_total =
sub_total + tax_total`. Summing the already-rounded per-line amounts (not rounding the total
separately) guarantees the lines reconcile to the total exactly.

Submit also stamps `document.base_tax_total = toBase(tax_total)` at the locked daily rate, so the GL
has the VAT figure in base currency without re-deriving a rate.

**Sequence — submit (writes budget_txn as today; VAT adds NO budget_txn):**
1. Submit runs in its existing `em.transactional()` and reserves budget under
   `LockMode.PESSIMISTIC_WRITE` on each budget (unchanged).
2. VAT is computed from each line's `tax_code` and stamped onto the lines + document totals
   (`sub_total` / `tax_total` / `grand_total` / `base_tax_total`) in the **same** transaction — this
   is arithmetic on the document, it does not read or write `budget_txn` and needs no additional
   lock. The reserve amount is still the pre-tax `budget_base_line_amount`.

**4. GL settlement entry extended, still balanced.**
On `payment.settled` the posting engine now builds:
- Dr expense account(s) at `Σ ACTUAL` (pre-tax net) — unchanged.
- Dr `VAT_INPUT` at `document.base_tax_total` when it is non-zero — new.
- Cr cash-clearing at `base_actual` — unchanged.
- FX line for `fx_delta` — unchanged.
Balance holds when the budget rate equals the daily rate (the seeded/default case): `Dr = net + VAT
= grand = base_locked`; `Cr = base_actual`; and `base_actual = base_locked + fx_delta`, which the FX
line closes. The existing Σdr = Σcr assert fails the posting (logged, retryable) rather than writing
an unbalanced entry — surfacing a budget-rate/daily-rate mismatch instead of mis-posting.

## Risks / Trade-offs

- **[Per-line VAT rounding drifts from the document total]** → `tax_total` is the sum of the
  already-rounded per-line `tax_amount`s (not an independent round of the whole), so lines always
  reconcile to the total; all math uses the `Money` decimal helper at the currency's
  `decimal_places`.
- **[VAT leaking into the budget basis]** → The budget reserve/actual keeps using
  `budget_base_line_amount` (pre-tax); only `base_total_amount`/payment carry the tax-inclusive
  grand total. Covered by a test asserting the reserved/actual budget is unchanged by VAT.
- **[Missing VAT_INPUT role mapping]** → Same failure mode as gl-journal: the posting is a logged,
  retryable no-op for that company until the role is mapped; the payment is unaffected. Seed installs
  the default mapping.
- **[Budget rate ≠ daily rate breaks the entry]** → Then `Σ ACTUAL` (budget-rate net) + `base_tax_total`
  (daily-rate VAT) ≠ `base_locked`, so the balance assert fails and the posting is a logged no-op
  rather than a wrong entry. The common/seeded case has them equal; reconciling differing rates in the
  GL is a separate concern (not introduced by VAT).
- **[Backward compatibility for tax-free documents]** → `tax_code_id` is nullable; a line with no
  tax code has `tax_amount = 0`, `grand_total = sub_total`, and the settlement entry omits the VAT
  line — existing untaxed flows are unchanged.
