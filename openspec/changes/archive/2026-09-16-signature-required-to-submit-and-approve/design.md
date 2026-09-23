## Context

Signatures already exist end to end: `user_signature` rows are immutable, `app_user.current_signature_id`
points at the live one, `SignatureService` (own-scope, JWT-resolved) uploads and reads it, and
`ApprovalRoutingService.act()` stamps `approval_log.signature_id` on APPROVE. `DocumentPdfService`
builds one `SignatureBlock` per recorded `document_approval_step` flagged `show_signature_on_pdf`
and both renderers (`document-pdf.service.ts` letter via pdfkit, `document-sheet.renderer.ts` sheets
via pdfmake) draw the stamped image or a ruled line.

What is missing is the *gate* — nothing requires the signature to exist before the moment it is
stamped — and the proposer has no stamp at all. On the production restore 70 of 89 accounts have no
signature and every `workflow_step.step_name` is empty, so headings fall back to "ຂັ້ນທີ N".

Constraints that shape the design: `approval_log` is append-only (invariant 2), stamps are locked
and never recomputed (invariant 6), behaviour keys off configuration (invariant 7), API keys may
create/submit but never approve (`external-api`, `ApiKeyDenyGuard`), the mobile app calls the same
endpoints and has no signature UI, and ~29 backend spec files submit or approve with fixture users
that have no signature.

## Goals / Non-Goals

**Goals:**
- A person cannot submit or APPROVE without a signature on file; the refusal is a stable coded
  error a client reacts to by sending the person to the profile page.
- The proposer's signature is stamped at submit and printed first in the signature row.
- Approver block headings read the approver's position once signed; the row wraps at five.
- The web app disables the affected buttons ahead of time from `hasSignature` in `/auth/me`.
- No existing document, approval row or printed sheet changes meaning.

**Non-Goals:**
- A signature upload screen in the mobile app (it shows the server's message; upload stays on web).
- Requiring a signature for REJECT / RETURN / CANCEL, or for saving a draft.
- Snapshotting the position at approval time (see Decisions).
- Inventing a stamp for a document whose proposer had no signature when they submitted (see Decision 5).
- Changing the external API contract.

## Decisions

### 1. One coded error, `SIGNATURE_REQUIRED`, for both gates
Add `SIGNATURE_REQUIRED` to `ErrorCode` (`back/src/common/errors/error-code.ts`) and throw it via
`coded(...)` (HTTP 400 like `PAYMENT_SLIP_REQUIRED`). It earns a code by the file's own rule: the
screen reacts differently — a link to `/new/profile` instead of an error toast. The message body
names the profile page in words too, for the mobile app and API clients that only show text.
*Alternative:* plain `BadRequestException` — rejected; the web client would have to string-match.

### 2. Gate placement: before anything is written, inside the same code path that stamps
- **Submit** (`DocumentSubmitService.submit`): check right after the DRAFT/status guard and the
  derives-quantity guard, before the FX/VAT/budget work — it is a precondition on the person, not
  on the content, and it must fail before any `budget_txn` RESERVE is attempted so nothing needs
  releasing. The signature id read there is stamped onto `doc.submittedSignatureId` in the write
  transaction alongside `exchangeRate` / `submittedAt`. The user is resolved from
  `RequestContext.userId()`; `RequestContext.apiKeyId()` set ⇒ skip the gate and stamp null.
- **Approve** (`ApprovalRoutingService.act`): the acting user is already loaded to read
  `currentSignatureId`; move that read above the `approval_log` insert and, when
  `dto.action === APPROVE && step.showSignatureOnPdf && !currentSignatureId`, throw. `step` is the
  recorded `document_approval_step` already fetched for the slip check, so the flag is the one
  frozen on this document's route (invariant 7 + "issued sheet does not change"). The check sits
  after `assertApprovable`/`assertSlipAttached` and before `tem.persist(ApprovalLog)`, inside the
  existing `PESSIMISTIC_WRITE` transaction on `document`.
- **Delegation**: the acting user (`actingUserId`) is the delegate, whose signature is what would be
  stamped — so the delegate's signature is what is checked. No change to eligibility resolution.

### 3. `canAct` grows a reason instead of turning false
`GET /documents/:id/can-act` keeps `canAct: true` for an eligible approver without a signature and
adds `reason: 'SIGNATURE_REQUIRED'`. Turning it false would hide Reject/Return, which need no
signature. The mobile client already types `{ canAct: boolean; reason?: string }`. The web
`documentsApi.canAct` currently unwraps to a boolean — widen it to return the object and keep a
`canAct` boolean plus `canActReason` in the documents store.

### 4. `hasSignature` rides on `/auth/me`
`RbacAuthService.identity()` already loads `AppUser`; add `hasSignature: !!user.currentSignatureId`
to `UserIdentity`. The Pinia `auth` store keeps it in state; `SignaturePanel` calls
`auth.setHasSignature(true)` (or re-fetches `/auth/me`) after a successful upload so the gates clear
without reload. *Alternative:* each view calling `GET /auth/signature` — rejected; three views would
each pay a request and could disagree.

### 5. New column `document.submitted_signature_id`, not a `SUBMIT` approval_log row
A nullable uuid FK on `document` → `user_signature.id`, mapped as a scalar `@Property` exactly like
`AppUser.currentSignatureId` (avoids a forward class reference and keeps `Document` free of a
relation to rbac). DBML: add to `Table document` with a note mirroring `exchange_rate`'s "stamped at
submit, never recomputed", plus a `Ref`. Migration is additive and nullable — no backfill, no
downtime. *Alternative:* an `approval_log` row with a new `SUBMIT` action — rejected: it adds an enum
value to a PG type, appears in the `approval-log` endpoint that `docs/claim-integration.md`
promises to external readers, and would change every timeline in web and mobile.

### 5b. Backfill recovers stamps, never invents them
Documents submitted before the column existed (391 on the production copy) print an empty proposer
line. `Migration20260916000000` stamps each with the latest `user_signature` of its `created_by`
uploaded at or before `submitted_at` — the row the submit would have stamped — and leaves the rest
null (155 recovered, 233 whose proposer uploaded only afterwards, 3 with none). *Alternatives
considered:* stamping the first signature uploaded after submit (fills every column, but prints as
"given at submit" an image that did not exist then — the column stops meaning one thing);
a render-time fallback to the current signature (worse: an issued sheet would change every time the
person replaced their signature). Chosen for the same reason `approval_log.signature_id` is
snapshot, not looked up. `SignatureService.delete` now also refuses a signature any document's
stamp references.

### 6. PDF model: proposer block is a separate field, headings resolved at export
- `DocumentPdfModel` gains `proposerBlock: SignatureBlock | null` (name from the existing
  `nameOf(createdBy)`, `actedAt = submittedAt`, image loaded from `submitted_signature_id` via the
  same `loadObject`). Both renderers prepend it to the row; the existing "count ≤ steps" invariant
  and its test apply to `signatureBlocks` only.
- `SignatureBlock` gains `heading: string`, computed once in the service: approved → the
  approver's `position`, falling back to `stepName`, then `ຂັ້ນທີ N`; pending → `stepName ?? ຂັ້ນທີ N`.
  Renderers print `heading` and stop deriving labels themselves, so both layouts agree. The
  department was in the heading in the first cut and was dropped on review: two long Lao lines per
  column broke the row.
- The row wraps at `SIGNATURES_PER_ROW = 5` (`signature-rows.ts`, shared by both renderers) with
  every column the same fixed width sized for a full row, and the rows kept together
  (`unbreakable`). pdfmake never shrinks a `*` column below its content's minimum — a 120pt image or
  a Lao title with no space to break at — so eight `*` columns simply ran off the page; a fixed
  width holds the grid whatever the content wants, and the image `fit` follows the column.
- The position is read from the approver's `employee` row in the document's company at export
  time — the same live resolution `nameOf` already uses for the name, and `related_employee` uses
  for the proposer line. Snapshotting it at approval would need another column on the append-only
  log for a case (people changing title) the name already tolerates.
- Documents with no recorded route (the `approval_log` fallback) get the same heading rule.

### 7. Web gating by permission code *and* signature
Existing `v-if="auth.can('DOC_CREATE')"` stays; add `:disabled="!auth.hasSignature"` and a
`<Message severity="warn">` with a `<RouterLink :to="{ name: 'profile' }">` beside "New document",
"Save & submit", detail "Submit" and "Approve". Server `SIGNATURE_REQUIRED` (via `codeOf(e)`) shows
the same message in the wizard's existing refusal panel and in `ReviewApprovalDialog`. Icons
`pi pi-pencil`, i18n keys under `documents.signatureRequired.*` in en/la/zh. No hardcoded colours.

### 8. Test fixtures
Add `giveSignature(em, userId)` to `back/src/test/` (a `user_signature` row + `currentSignatureId`)
and call it where fixture users submit or approve — ~19 submit and ~10 approve spec files. The
existing "approve without signature" test flips to expect `SIGNATURE_REQUIRED`; a new test covers
the flagged-off step still approving, the delegate case, API-key submit, and the stamped
`submitted_signature_id`. Concurrency tests on reserve/numbering are untouched — the gate runs
before them and adds no writes.

## Risks / Trade-offs

- [70 of 89 production users cannot submit/approve on deploy day] → announce before release; the
  refusal text and the disabled-button message both say exactly where to upload; the profile panel
  says why. Consider a short grace period only if the business asks — it is not in this change.
- [Mobile approvers have no upload screen] → they receive `SIGNATURE_REQUIRED` with a message naming
  the web profile page; a mobile upload screen is a follow-up change.
- [API-key submits print a proposer block with an empty line] → intended; the external system is
  not a person. The name is still printed so the sheet says who raised it.
- [233 older documents keep an empty proposer line after the backfill] → by design; their proposers
  had no signature when they submitted. They print a line to sign by hand, as they always have.
- [Long routes (7 steps on production) + a proposer block = 8 columns on A4] → rows of five with
  fixed equal widths; verified by rendering 8- and 10-column sheets to PDF during review.
- [Department/position read live may differ from the day of approval] → accepted, matches how the
  approver's *name* is already resolved; documented in the spec as "resolved in the document's
  company".
- [Stale `hasSignature` in the client] → the server is authoritative; the client handles the coded
  refusal identically, and refreshes `/auth/me` after it.
- [Rollback] → the column is nullable and unused by older code; migration down drops it. The
  ErrorCode and gates are pure code and roll back with the deploy.

## Migration Plan

1. DBML: add `submitted_signature_id` to `Table document` + `Ref` → `user_signature.id`.
2. Entity + MikroORM migrations: `20260915` adds the column; `20260916` recovers stamps for
   documents submitted before it. Run both on both deploy targets.
3. Backend: ErrorCode, submit gate + stamp, approve gate + `canAct` reason, `/auth/me`
   `hasSignature`, PDF model + both renderers.
4. Tests: fixture helper, update affected specs, new scenarios.
5. Frontend: store, four gated buttons + messages, SignaturePanel refresh, i18n.
6. Announce to users; deploy; watch for `SIGNATURE_REQUIRED` in logs the first days.

## Open Questions

- None open. (The heading separator question fell away when the department was dropped.)
