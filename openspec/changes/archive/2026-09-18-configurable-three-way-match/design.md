## Context

`DocumentSubmitService.submit` calls `MatchingService.assertMatched` when
`docType.postAction === 'CUT_BUDGET' && document.refDocument`. `MatchingService.match` repeats the
same test and compares each invoice line to the predecessor line at the same `lineNo`: qty against
`received_qty`, amount against `line_amount` with tolerance 0. `ReceivingService.receive` accepts
any company document with lines; the web shows the button on any `APPROVED`/`COMPLETED` document
with lines for a `DOC_RECEIVE` holder.

`document_type` already carries a family of boolean flags (`requires_*`, `accrues_on_approval`)
that thread entity → DTO → service → admin form → shared schema; both new settings follow that
path exactly.

## Goals / Non-Goals

**Goals:**
- Matching is a per-type setting with today's behaviour as the default.
- A `PR → PO` company can pay from the PO without pretending to receive on the PR.
- Services can be matched on amount alone.
- Receipts are recorded only on types configured to receive.

**Non-Goals:**
- Tolerance configuration, partial invoicing, chain-wide remaining quantities.
- Changing when or how budget is settled.

## Decisions

### 1. `match_mode` enum, not a boolean

A boolean "match or not" leaves services stuck: they need the amount check without the receipt.
Three values cover the real cases and the default keeps every existing type on `THREE_WAY`.
Stored as `varchar` with a `CHECK` constraint declared on the entity (same pattern as
`post_action`), so the test schema carries it.

### 2. The gate reads `match_mode`, never `post_action`

`submit`: `if (document.refDocument && docType.matchMode !== 'NONE') assertMatched`.
`MatchingService.match` takes the mode: `TWO_WAY` sets `overReceived = false` and reports
`receivedQty` as-is for display; `THREE_WAY` unchanged; `NONE` returns `{ ok: true, lines: [] }`
so the panel disappears. The old "only CUT_BUDGET is a match candidate" comment and branch are
removed — the mode is the whole answer.

### 3. `receives_goods` is a type flag with a backfill, not a derived rule

Deriving "receivable" from pairings (a type is receivable if some successor pairing matches
`THREE_WAY`) would be clever and invisible. A flag an admin can see and flip is the pattern this
codebase uses. The migration backfills it from that very rule once, so nothing that receives today
stops receiving; after that it is configuration. Enforced in `ReceivingService.receive` (400 with
the type code) and mirrored in `canReceive` on the client.

### 4. Validation

`document-type.service`: `match_mode` must be one of the three; `receives_goods` requires the type
to allow lines (it is meaningless otherwise, but no type flag says "has lines" today, so this is
not enforced beyond the boolean). No cross-flag rule ties `match_mode` to `CUT_BUDGET`: a
non-settling successor may still be matched if a company wants it.

**Budget/quota writes**: none. Matching and receiving write no `budget_txn`/`quota_usage`; the
receipt transaction (lines + stock) is unchanged.

## Risks / Trade-offs

- [A type set to `NONE` lets a DISB pay more than the PO ordered] → that is the admin's explicit
  choice, visible on the type; the default stays `THREE_WAY`.
- [Backfill marks a PR type `receives_goods` in a company whose PO is `CUT_BUDGET`] → matches what
  those users do today; they flip it off when they set the PO to `NONE`. Called out in the
  proposal's operations note.
- [Old client on a new server] → the detail's `matching` read returns empty lines for `NONE`, which
  the existing panel already hides.

## Migration Plan

1. `Migration20260919000000`: add `match_mode varchar not null default 'THREE_WAY'` with the
   check; add `receives_goods boolean not null default false`; backfill
   `receives_goods = true` where the type is `predecessor_type_id` of a `document_type_ref` whose
   successor type has `post_action = 'CUT_BUDGET'` (today's effective rule). `down()` drops both.
2. Deploy backend + shared + frontend.
3. Customer: set `PO.match_mode = NONE`; set `PR.receives_goods = false` if not wanted.

## Open Questions

None.
