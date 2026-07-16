## Why

The `CREATE_PO` post-action no longer creates a PO by hardcoded rule — since the reference chain
became `document_type_ref` configuration, it resolves whatever successor the company configured. But
the name still hardcodes "PO", and the action **only auto-creates when exactly one successor
resolves**, silently no-op-ing when a type legitimately fans out to several successors (e.g. an
approved requisition that should spawn both a PO and a disbursement draft). Two related fixes:
rename the action to its true meaning, and make multi-successor auto-creation a per-pairing
configuration choice (invariant 7) instead of an all-or-nothing single-successor rule.

## What Changes

- Rename the `post_action` value `CREATE_PO` → `CREATE_SUCCESSOR` everywhere (shared `POST_ACTIONS`,
  the post-action dispatcher, logs/local names, seed, i18n, comments). **BREAKING (internal value
  rename)**: existing `document_type.post_action='CREATE_PO'` rows are migrated to
  `CREATE_SUCCESSOR`.
- Add an `auto_create` boolean to `document_type_ref` (default `false`). On full approval, the
  `CREATE_SUCCESSOR` post-action SHALL create a DRAFT successor for **every** successor pairing of
  the source type marked `auto_create = true` (supporting multiple), and be a logged no-op when none
  are. Pairings with `auto_create = false` remain available for manual create-from only.
- `DOC_CONFIG_MANAGE` users can toggle `auto_create` per pairing in the reference-chain editor.
- Backfill: existing pairings whose predecessor type is a `CREATE_SUCCESSOR` type are set
  `auto_create = true`, preserving today's behavior for single-successor types and enabling
  multi-successor for any that fan out.
- No change to `createFrom`, budget/quota, the same-company pairing rules, or approval routing.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `document-engine`: `document_type_ref` gains an `auto_create` flag; reference-chain lookups and
  the (renamed) `CREATE_SUCCESSOR` successor resolution read it. `CREATE_SUCCESSOR` auto-creates a
  DRAFT per `auto_create` pairing (multiple allowed) instead of only on a single resolved successor.
- `approval-workflow`: the "Post-Action Execution on Full Approval" requirement renames `CREATE_PO`
  → `CREATE_SUCCESSOR` and creates a DRAFT successor for each `auto_create` pairing.
- `web-doc-config`: the reference-chain editor lets a `DOC_CONFIG_MANAGE` user mark a successor
  pairing as auto-created on approval.

## Impact

- **Data model / DBML**: `document_type_ref` gains `auto_create boolean [default: false]`.
- **Backend**: `document.entities.ts` (`DocumentTypeRef.autoCreate` + comment), `ref-chain.config.ts`
  (`successorTypesFor` + a new auto-create-only resolver), `post-action.service.ts` (rename +
  create-per-auto-pairing loop, local/log rename), `ref-chain.service.ts` + `config.dto.ts`
  (accept/toggle `autoCreate`), `approval-routing.service.ts` comment.
- **Shared** (`@erp/shared`): `POST_ACTIONS` `'CREATE_PO'` → `'CREATE_SUCCESSOR'`; `refPairingSchema`
  gains `autoCreate`.
- **Seed**: PROC type `postAction` → `CREATE_SUCCESSOR`; its PROC→PO pairing seeded `auto_create=true`.
- **Frontend**: `RefChainEditor.vue` (auto-create toggle + badge), `api/docConfig.ts` +
  `stores/docConfig.ts` (carry `autoCreate`, add update), i18n labels (en/la) for the toggle and the
  renamed post-action.
- **Migration**: add `auto_create` column; rename `post_action` values; backfill `auto_create=true`
  for `CREATE_SUCCESSOR`-predecessor pairings.
- **Invariants**: reinforces configuration-over-code (invariant 7); company isolation and
  budget/quota/ledger paths untouched. Single-successor types behave identically after migration.
