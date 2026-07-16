## Context

`post-action.service.ts` resolves the successor generically via `successorTypesFor(em, company.id,
type.id)` (reading `document_type_ref`) and auto-creates it with `createFrom`, but **only when
exactly one successor resolves** — a type that fans out to several successors silently no-ops. The
literal `CREATE_PO` also survives as the `post_action` value, the dispatcher comparison, a local
`po`, and log text, all vestiges of the hardcoded-`REF_CHAIN` era. `post_action` is a free-form
`varchar` (no enum/CHECK). `document_type_ref` today has no per-pairing behavior flag. This change
does two things: rename the action to `CREATE_SUCCESSOR`, and make auto-creation a per-pairing
`auto_create` choice so a type can auto-spawn zero, one, or many successors.

## Goals / Non-Goals

**Goals:**
- Rename `post_action` value `CREATE_PO` → `CREATE_SUCCESSOR` across code, shared, seed, i18n, DB.
- Add `document_type_ref.auto_create` (default false); `CREATE_SUCCESSOR` creates a DRAFT for every
  successor pairing marked `auto_create=true`.
- `DOC_CONFIG_MANAGE` users toggle `auto_create` per pairing in the reference-chain editor.
- Preserve today's behavior for single-successor types via backfill.

**Non-Goals:**
- No change to `createFrom` copy semantics, budget/quota, same-company pairing rules, or routing.
- No auto-create on the predecessor side or transitive/recursive successor creation.
- No enum/CHECK on `post_action` (stays a free varchar).

## Decisions

**1. `auto_create boolean default false` on `document_type_ref`.**
Entity `DocumentTypeRef.autoCreate`, DBML column, and a migration add it. Default `false` so a newly
added pairing is manual create-from until an admin opts in — the conservative default that avoids
surprise document creation.

**2. Auto-create loops over all `auto_create=true` successor pairings.**
Add `autoCreateSuccessorsFor(em, company, predecessorTypeId)` to `ref-chain.config.ts` returning the
successor types of pairings with `auto_create=true`. The `CREATE_SUCCESSOR` branch iterates and
calls `createFrom` for each, logging per creation; empty set → logged no-op. This replaces the
`successors.length !== 1` guard. `successorTypesFor` (used by create-from validation) is unchanged.

**3. Backfill preserves current behavior.**
Migration sets `auto_create=true` for pairings whose predecessor type has
`post_action='CREATE_SUCCESSOR'` (i.e. the former `CREATE_PO` types). A single-successor type keeps
creating its one successor exactly as before; a multi-successor type now creates all of them — the
requested new capability. All other pairings stay `false` (manual create-from), unchanged.

**4. Full rename + data migration, no dual-accept alias.**
`update document_type set post_action='CREATE_SUCCESSOR' where post_action='CREATE_PO'` runs before
the backfill (so the backfill can match on the new value); the dispatcher only recognizes the new
value. The local `po`→`successor` and `CREATE_PO ...`→`CREATE_SUCCESSOR ...` logs are renamed too.

**5. Admin surface: a toggle per successor pairing.**
`autoCreate` is accepted on pairing create (`CreateRefPairingDto`, `refPairingSchema`) and
toggleable on an existing row via a new `PATCH document-config/ref-pairings/:id` endpoint. The
`PairingView` returned to the UI carries `autoCreate`; `RefChainEditor.vue` shows a switch/badge on
each successor tag. Only the successor side has the flag (it governs what the predecessor's approval
creates).

## Risks / Trade-offs

- **A multi-successor `CREATE_SUCCESSOR` type that historically no-op'd now auto-creates all its
  auto_create pairings** → intended (the feature). Backfill only flips pairings whose predecessor is
  a `CREATE_SUCCESSOR` type, and today the only seeded such type (PROC) has a single successor, so
  real data is unaffected; the behavior change is opt-in via the admin toggle thereafter.
- **Post-action creates several drafts in one transaction** → each `createFrom` runs in the existing
  atomic post-action unit of work with bounded retry; a failure rolls back the terminal transition
  (unchanged guarantee), so partial fan-out cannot persist.
- **Deploy ordering (code before migration)** → an unmigrated `CREATE_PO` row is an unknown action =
  logged no-op, not a crash; run the migration with the deploy. `down()` reverts values and drops
  the column.

## Migration Plan

1. Ship shared (`POST_ACTIONS`, `refPairingSchema`), backend, seed, and i18n together.
2. Migration:
   - `alter table "document_type_ref" add column "auto_create" boolean not null default false;`
   - `update "document_type" set "post_action"='CREATE_SUCCESSOR' where "post_action"='CREATE_PO';`
   - `update "document_type_ref" set "auto_create"=true where "predecessor_type_id" in (select "id" from "document_type" where "post_action"='CREATE_SUCCESSOR');`
   - `down()`: reverse the value update, then drop the column.
3. Verify: PROC→PO pairing reads `auto_create=true`; approving a PROC still spawns one PO draft.

## Open Questions

- Should the predecessor-side listing also surface auto-create state (read-only) for context?
  Proposed: show it on the successor side only, where it is editable — the predecessor list is about
  "created from", not "auto-creates".
