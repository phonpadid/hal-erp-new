## Why

The predecessor→successor pairings that drive the document reference chain (PR→PO,
PROC→PO, PO→DISB, ADVANCE→CLEAR_ADVANCE) live in a hardcoded object,
`REF_CHAIN`, in `back/src/modules/document/ref-chain.config.ts`. Adding or changing a
chain — the backbone of `create-from-predecessor` and the `CREATE_PO` post-action —
requires a code change and redeploy, which contradicts the project's
**configuration over code** invariant and prevents companies from tailoring their own
chains. The pairings are also global by type `code`, so they cannot vary per company
even though `document_type` is company-scoped.

## What Changes

- Add a company-scoped join table `document_type_ref`
  (`predecessor_type_id` → `successor_type_id`) as the storage for allowed pairings,
  replacing the in-code `REF_CHAIN` object.
- Rewrite `isRefPairingAllowed()` and `successorTypesFor()` as DB-backed lookups scoped
  by the active company, keeping the two existing call-site behaviors identical:
  create-from validation ([document.service.ts:190](../../../back/src/modules/document/document.service.ts#L190))
  and `CREATE_PO` successor resolution
  ([post-action.service.ts:89](../../../back/src/modules/approval/post-action.service.ts#L89)).
  `CREATE_PO` auto-create still fires **only when exactly one successor resolves**.
- Enforce company isolation on pairings: both endpoints of a pairing MUST be
  `document_type` rows in the same company; a pairing may never span companies.
- Seed the current pairings (`PO:[PR,PROC]`, `DISB:[PO]`, `CLEAR_ADVANCE:[ADVANCE]`)
  as `document_type_ref` rows for every company that has the matching types.
- Add an admin config UI to view/add/remove a document type's successor and predecessor
  pairings, gated by a permission code and mirroring the server's company scope.

## Capabilities

### New Capabilities
<!-- none — this reuses existing capabilities -->

### Modified Capabilities
- `document-engine`: the "Document Reference Chain" requirement's pairing configuration
  is now stored per company in `document_type_ref` (not a global in-code table), and
  seeded/enforced within a company.
- `web-doc-config`: add management of reference-chain pairings to document-type
  configuration, permission-gated.

## Impact

- **DBML / schema:** new `document_type_ref` table in `erp_approval_system.dbml` +
  MikroORM entity + migration.
- **Backend:** `ref-chain.config.ts` helpers become DB-backed (async, company-scoped);
  call sites in `document.service.ts` and `post-action.service.ts` updated to pass the
  active company / `em`. New REST endpoints + DTOs for reading/mutating pairings. Seed
  data updated. `ref-chain.spec.ts` reworked; concurrency not affected (no ledger/number
  writes).
- **Frontend:** new pairing editor in the document-type config screen (Vue 3 / PrimeVue),
  Pinia permission gating, typed API client + Zod DTO.
- **Behavior unchanged:** `approval-workflow` `CREATE_PO` semantics and the
  document-engine reference-chain scenarios keep the same observable behavior; only the
  pairing storage moves from code to data.
- **Invariants:** upholds company isolation (#1) and configuration-over-code (#7);
  touches no ledger/append-only or FX invariants.
