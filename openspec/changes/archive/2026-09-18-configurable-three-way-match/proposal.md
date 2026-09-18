## Why

Three-way matching is hardcoded: every document whose type is `CUT_BUDGET` and which references
a predecessor is matched against that predecessor's `received_qty` and line amounts before it may
be submitted. That rule was written for `DISB → PO`. A company whose chain ends at the PO
(`PR → PO`, the PO is the paying document) gets its PO matched against the PR instead — it must
"receive goods" on a requisition that has bought nothing yet, and a PR raised without prices makes
every PO fail on amount. Services have no goods to receive at all, and still face the quantity
half. The rule is behaviour that should come from `document_type` configuration (invariant 7), not
from the post-action.

A second, related trap: the "receive goods" action is offered on every approved document with
lines — a PR, a compensation claim — so people record receipts on the wrong document and the
matching still fails.

## What Changes

- `document_type` gains `match_mode` ∈ `NONE` | `TWO_WAY` | `THREE_WAY` (default `THREE_WAY`,
  which is exactly today's behaviour). `NONE` skips matching; `TWO_WAY` checks amount against the
  predecessor only (no receipt needed — services); `THREE_WAY` checks quantity against
  `received_qty` and amount.
- The submit gate and the match read honour `match_mode` instead of `post_action`. A document
  with no predecessor is never matched, as today.
- `document_type` gains `receives_goods boolean default false`: whether receipts may be recorded
  on documents of this type. The receive endpoint refuses other types; the web detail offers the
  action only where the flag is on. The migration backfills `true` for every type that is the
  predecessor of a `THREE_WAY` successor pairing, so existing PO types keep receiving.
- The document-type admin form exposes both settings, with hints.
- Seed: `DISB` = `THREE_WAY`, `PO` = `receives_goods`; everything else defaults.

Not in scope: a configurable amount tolerance (still exact), partial invoicing, remaining-quantity
tracking across several successors.

## Capabilities

Touches `document-engine` (type configuration), `procurement-receiving` (matching gate, receipt
gate), `web-doc-config` (form), `web-procurement` (receive affordance). Invariants: strengthens 7;
no ledger row is written by any of this — budget settlement is unchanged and still happens at
approval of the `CUT_BUDGET` document.

### New Capabilities

(none)

### Modified Capabilities

- `document-engine`: Configurable Document Type — two new flags with their defaults and validation.
- `procurement-receiving`: Three-Way Matching Before Disbursement — gated by `match_mode`, not
  `post_action`; Goods Receipt — only on a `receives_goods` type.
- `web-doc-config`: Document Type Management — the form offers `match_mode` and `receives_goods`.
- `web-procurement`: Goods Receipt Screen — the affordance follows the type flag; Three-Way
  Matching Panel — shown for `TWO_WAY`/`THREE_WAY`, omitted for `NONE`.

## Impact

- **Migration**: two columns on `document_type` + backfill of `receives_goods`.
- **DBML**: `document_type.match_mode`, `document_type.receives_goods`.
- **Backend**: `document.entities.ts`, `dto/config.dto.ts`, `document-type.service.ts`,
  `document-submit.service.ts` (gate), `matching.service.ts` (mode-aware), `receiving.service.ts`
  (type gate), seed.
- **Frontend**: `DocTypeFormFields.vue`, `docConfig` api/store, `DocumentDetailView.vue`
  (`canReceive`, matching panel), i18n en/la/zh, `shared/src/index.ts` type-form schema.
- **Operations**: after deploy, the customer sets their `PO` type to `match_mode = NONE` (and
  `receives_goods` if they receive stock on it) — one admin-screen change, no code.
