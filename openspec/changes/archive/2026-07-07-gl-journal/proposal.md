## Why

The system tracks money as single-sided budget commitments (`budget_txn`: RESERVE →
ACTUAL → RELEASE) but has no double-entry general ledger — there is no journal, no
debit/credit, and no way to produce a trial balance or financial statements. The
`payment-handoff` capability already emits `payment.settled` at the exact moment an actual
payment + FX is recorded, and the `PaymentHandoffListener` is explicitly a dispatch seam
where "an external accounting integration can hook in… without touching the approval/payment
flow." This change fills that seam with an internal general ledger, building on the
chart-of-accounts master to turn settlements into balanced journal entries. It does not
change the budget ledger or the payment flow.

## What Changes

- Introduce an append-only, double-entry **general ledger**: `journal_entry` (header) and
  `journal_line` (account, debit, credit, base amount) with the hard invariant Σdebit =
  Σcredit per entry. Like `budget_txn`, entries are insert-only — corrections are reversing
  entries, never updates.
- Add a **GL posting engine** that subscribes to `payment.settled` and generates one
  balanced entry per settled document: debit the budget's expense account at the locked
  base, credit a cash-clearing account at the actual base, and post the FX difference to a
  realized FX gain/loss account (invariant 6 — FX goes to accounting, not the budget). The
  posting is **idempotent**: one journal entry per source payment, keyed on the source.
- Add a small, config-driven **system-account role map** (`account_role`: company → role →
  account) so the engine resolves the cash-clearing and FX gain/loss accounts by role, not
  by hardcoded codes (invariant 7).
- Add a read-only **journal query** (`GL_VIEW`) and permission code; seed default role
  mappings per company.
- **Out of scope (later slices):** posting periods / period-close, AP/AR subledgers, VAT/WHT,
  and financial statements (trial balance / P&L / balance sheet). This slice produces the
  balanced journal those build on.

## Capabilities

### New Capabilities
- `gl-journal`: the double-entry general ledger (`journal_entry` / `journal_line`, the
  balanced-entry invariant, append-only enforcement), the posting engine that subscribes to
  `payment.settled`, the system-account role map, and the read-only journal query.

### Modified Capabilities
<!-- None. payment-handoff already emits payment.settled; this change subscribes to that
     existing contract without altering it. chart-of-accounts is consumed unchanged. -->

## Impact

- **Data model**: new `journal_entry`, `journal_line`, and `account_role` tables (DBML +
  migration). No change to `budget_txn`, `payment`, or `account`.
- **Backend**: new `gl`/`general-ledger` module (entities, posting service, journal read
  service, controller, DTOs, permission code, seed). A new listener (or an addition to the
  existing seam) subscribes to `payment.settled`; the append-only guard is extended to the
  new ledger tables. Reuses the chart-of-accounts resolver to map codes → accounts.
- **Frontend**: a read-only Journal view (entries + their balanced lines), gated by
  `GL_VIEW`; nav entry and i18n.
- **Invariants**: preserves all core invariants. Company isolation (#1) covers the new
  tables; the ledger is append-only (#2 style); FX stays out of the budget (#6); role
  mapping keeps posting config-driven (#7); authorization by permission code (#6). The
  balanced-entry rule (Σdr = Σcr) is a new ledger invariant introduced by this capability.
- **Risk**: the posting engine runs post-commit off an event; a posting failure must not
  roll back the (already committed) payment — failures are logged and retryable, and the
  idempotency key prevents double-posting on retry.
