## Why

`vendor_bank_account` shipped complete on the server — many accounts per vendor, one primary, a
separate `VENDOR_BANK_MANAGE` permission, an audit log on every change — and completely unreachable
from the web app. The only way to enter an account today is to call the API by hand.

That is not a cosmetic gap. `DISB` is seeded `requires_payee`, so **a disbursement cannot be
submitted for a vendor that has no account**, and nothing in the UI lets anyone add one. The
payment-batch feature is inert until this exists: the seed works only because it inserts accounts
directly.

## What Changes

- **Vendor bank accounts become manageable from the master-data area** — list a vendor's accounts,
  add one, edit its details, promote a primary, deactivate a retired one.
- **The affordances split on `VENDOR_BANK_MANAGE`, not `MASTER_MANAGE`.** A user who can edit a
  vendor's phone number sees the accounts read-only. This mirrors the server exactly and is the
  point of the separate code: redirecting a payee account needs no approval, leaves no document,
  and pays out on the next run.
- **The audit trail is surfaced**, not just recorded. Who changed an account number, when, and from
  what to what — visible next to the account. A log nobody can read only helps after the money is
  gone; the deterrent is that the change is visible while it is still reversible.
- **Deactivate rather than delete**, mirroring the server: a retired account stays visible on the
  documents and batches that name it, greyed out and unselectable.
- **The primary account is shown as such** — it is what the payee picker preselects, so which one
  is primary has to be obvious here rather than discovered on a document form.

## Capabilities

### New Capabilities
- `web-vendor-bank-account`: the vendor bank-account surface — list, add, edit, set primary,
  deactivate, and read the change history, gated by `VENDOR_BANK_MANAGE`.

### Modified Capabilities
- `web-master-data`: the vendor registry SHALL offer a way into a vendor's bank accounts, and the
  existing permission-gating requirement SHALL account for `VENDOR_BANK_MANAGE` alongside
  `MASTER_VIEW`/`MASTER_MANAGE`.
- `vendor-bank-account`: the recorded change history gains a read — the rows exist today but
  nothing serves them, so the log deters nobody.

## Impact

**Invariants.** No ledger, no money, no company scope of its own: `vendor` is group-level, so its
accounts are visible to every company in the group — a GROUP-scope read under invariant 1, already
decided and enforced server-side. This change does not widen it; it only makes the existing read
visible. Invariant 5 (authorize on permission codes, never role names) is the whole shape of the
UI here.

**Server.** Almost nothing. `VendorBankAccountController` already exposes list/create/update/
set-primary/deactivate with the right guards, and `masterDataApi.vendorBankAccounts` already wraps
them. Two gaps:
- The audit log has no read endpoint — `vendor_bank_account_log` rows are written but nothing serves
  them, so surfacing the history needs `GET /vendors/:vendorId/bank-accounts/:id/history` behind
  `VENDOR_BANK_MANAGE`.
- The vendor registry cannot say which vendors have no account. Annotating the list server-side
  (one query per page) rather than letting the client ask per row, which would cost 20 round trips
  to render one badge on a 20-row page.

**Code.** `front-end/src/views/master/` (the vendor registry gains the entry point),
a new accounts panel + history view, `front-end/src/api/masterData.ts` (history read),
`back/src/modules/master-data/vendor-bank-account.{service,controller}.ts` (history read only).

**Risk worth naming.** This UI is the fraud surface the server's permission split exists to
protect. Every affordance must gate on `VENDOR_BANK_MANAGE` and nothing else; a picker that shows
inactive accounts, or an edit form that quietly reaches the primary flag, would undo the control
the backend built. The client guard is UX only — the server still enforces — but a UI that
suggests an action the server will refuse is its own defect.

**Out of scope.** Approving a bank-account change (a maker-checker flow for the accounts
themselves); bulk import of accounts; validating an account number against the bank; showing an
account's payment history.
