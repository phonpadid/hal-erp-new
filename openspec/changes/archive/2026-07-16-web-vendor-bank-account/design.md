## Context

The server side is finished and unreachable. `VendorBankAccountService` handles create, update,
set-primary, and deactivate, each in a transaction, each writing a `vendor_bank_account_log` row;
`VendorBankAccountController` gates reads on `MASTER_VIEW` and every mutation on
`VENDOR_BANK_MANAGE`; `masterDataApi.vendorBankAccounts` already wraps all five calls. Nothing in
the web app calls any of it.

Three facts shape the design:

- **`DISB` is seeded `requires_payee`.** A disbursement for a vendor with no account cannot be
  submitted, and today nobody can add one without curl. This is the gap that makes payment batches
  unusable outside the seed.
- **`vendor` is group-level.** Its accounts are shared across the group by design — a decision
  already made and enforced. This UI inherits it and must not imply otherwise.
- **`vendor_bank_account_log` is written but never read.** Every mutation records actor, timestamp,
  and before/after values; no endpoint serves them.

## Goals / Non-Goals

**Goals:**
- Let a `VENDOR_BANK_MANAGE` user manage a vendor's accounts without touching the API by hand.
- Show accounts read-only to a `MASTER_VIEW` user, with no manage affordance at all.
- Surface the audit trail where the account is, while a change is still reversible.
- Make "which account is primary" obvious, since that is what the payee picker preselects.

**Non-Goals:**
- Any server behaviour change beyond a history read. The rules are settled; this is a surface.
- Maker-checker approval for an account change — worth discussing, but a different change.
- Validating an account number against a bank, or bulk import.
- Widening or narrowing the group-level visibility of accounts.

## Decisions

### The accounts live inside the vendor row, not as a top-level page

An account has no meaning apart from its vendor, and the question a user arrives with is always
"where does *this vendor* get paid". A panel opened from the vendor registry keeps that framing and
reuses the vendor list's existing scoping and permission plumbing.

*Alternative rejected:* a standalone "Bank accounts" page listing every vendor's accounts. It reads
like a payments directory and invites exactly the browsing this data does not deserve — the
interesting question is never "show me all account numbers".

### Every mutation gates on `VENDOR_BANK_MANAGE`; the list gates on `MASTER_VIEW`

Mirrors the controller exactly. A `MASTER_MANAGE` user with no `VENDOR_BANK_MANAGE` sees accounts
and no buttons — not disabled buttons, absent ones: a control that exists but refuses teaches the
user the permission split is a bug rather than a boundary.

The client guard is UX only and the server stays authoritative, but a UI offering an action the
server will reject is its own defect.

### The audit trail sits next to the account, not on a separate admin page

The log exists because this table is not append-only and an attacker's cheapest move is edit → run
the batch → edit back. A history buried in an admin console is found after the money is gone;
beside the account it is found while the change is still reversible, and the fact that it is
visible is itself the deterrent.

*Requires one new endpoint.* `GET /vendors/:vendorId/bank-accounts/:id/history`, gated by
`VENDOR_BANK_MANAGE` — reading who redirected a payee is itself sensitive, so it does not ride on
`MASTER_VIEW`. This is the only server work in the change.

### Deactivate, never delete — and say why in the UI

The server has no delete, deliberately: a document or an exported batch that names an account must
stay legible. The UI shows a retired account greyed and unselectable rather than hiding it, so a
user who opens an old document and sees an account they cannot find in the list is not left
guessing.

### Primary is a state to promote, not a checkbox to tick

`setPrimary` is its own endpoint because promoting one demotes the other atomically. The UI mirrors
that with a "make primary" action per row rather than a toggle on the edit form — a form field
would imply two accounts could be primary between saves, which the service specifically prevents.

Deactivating the primary silently clears the flag server-side, leaving the vendor with none. The UI
SHALL say so at that moment: the next disbursement for that vendor will preselect nothing, and the
requester — not the person who deactivated it — is the one who finds out.

### Account numbers are text everywhere, including in the input

`accountNo` is a string end to end for a reason: as a number `000123` becomes `123`, a different
account. The field is a plain text input, never a numeric one, and the column is never right-aligned
or formatted like a quantity.

*Sequence note (the rules ask for one):* **this change writes no `budget_txn` and no
`quota_usage`,** and touches no money at all. The only new server code is a read. Transaction
boundaries and locking are unchanged — the existing service already wraps each mutation, and the
atomic primary demotion lives there, not here.

## Risks / Trade-offs

**This UI is the fraud surface the permission split exists to protect** → Gate every affordance on
`VENDOR_BANK_MANAGE` alone and test the negative case explicitly. The likeliest mistake is reusing
the vendor form's `MASTER_MANAGE` check out of habit, which would hand account edits to everyone
who can fix a typo in a vendor's name.

**A group-level account edited in company A silently affects company B** → True today and unchanged;
the UI does not imply per-company accounts. Worth revisiting if a tenant objects, but inventing a
company scope in the client that the server does not enforce would be worse than the current
honesty.

**Surfacing the history makes account numbers easier to harvest** → It shows changes to accounts
the user can already read. Gating the history on `VENDOR_BANK_MANAGE` keeps it narrower than the
account list itself.

**The panel could grow into a payments console** → Scope it to the vendor. Payment history belongs
to the batch views, which already have it.

## Migration Plan

Additive and reversible: one read endpoint plus a UI surface. No schema change, no data change, no
behaviour change to anything that exists. Reverting removes a page.

Worth doing early rather than late: until it ships, `requires_payee` on `DISB` can only be
satisfied by the seed, so any real company adopting payment batches is blocked on it.

## Open Questions

- **Should an account change need approval?** The proposal scopes maker-checker out, and the audit
  log plus the separate permission is the current control. If a tenant's auditors want four eyes on
  a payee change, that is a `document_type` away — an account change could itself be a document —
  and worth a proposal of its own.
- Should the history show changes to accounts that were later deactivated, or only live ones?
  (Leaning: all of them — a retired account is exactly where a covering edit would hide.)
