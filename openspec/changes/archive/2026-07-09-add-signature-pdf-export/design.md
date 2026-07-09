## Context

The approval engine records each action as an append-only `approval_log` row
([approval-routing.service.ts](../../../back/src/modules/approval/approval-routing.service.ts)
`act()`), but there is no signature and no printable artifact anywhere in the system —
no PDF export exists today. `app_user` (the global identity) has no signature; `employee`
is the per-company personnel row. Attachments already establish the storage pattern:
`document_attachment` keeps a `file_path` into S3/MinIO and never stores blobs in the DB.

The request: at APPROVE time the system must pull the approver's signature and later
embed it into an exported PDF. The audit-critical constraint is that the signature shown
on a historical document must be the one in force **when the approval happened** — even
if the user replaces their signature afterward — mirroring invariant 6 (locked FX).

## Goals / Non-Goals

**Goals:**
- Self-service: a user can upload and replace their own signature image.
- Immutable capture: each APPROVE stamps a locked reference to the approver's signature
  as it was at approval time.
- Server-side PDF of a document + approval trail with embedded signatures.
- Keep `approval_log` append-only and preserve company isolation.

**Non-Goals:**
- Drawn-on-canvas / biometric / cryptographic (PKI) e-signatures — this is an image
  stamp, not a legal digital signature.
- Signatures for reject/return/delegate actions (name + date only).
- Configurable PDF templates per document type (single standard layout first).
- Editing or versioned "rollback" of signatures beyond keeping old files immutable.

## Decisions

### D1: Immutable signature files + `current_signature_id`, snapshot by id on approve
A new `user_signature` table holds one row per uploaded signature (immutable file in
object storage). `app_user.current_signature_id` points at the active one. On APPROVE we
copy that id into `approval_log.signature_id`.

- **Why**: The snapshot must never change after the fact. If we stored a single
  `app_user.signature_path` and let the user overwrite it, every historical PDF would
  silently change. Immutable files + a foreign-key snapshot make "what they signed with"
  permanent, and give a natural audit history for free.
- **Alternative rejected**: copy the signature *bytes* into a per-approval file at
  approval time — more storage churn and a second copy to secure, for no extra benefit
  over referencing an already-immutable file.
- **Alternative rejected**: `app_user.signature_path varchar` overwritten on replace —
  breaks the locked-at-event guarantee.

### D2: Signature lives on `app_user`, not `employee`
The signer identity in `approval_log.approver_id` is an `app_user`. A person signs the
same way regardless of which company's document they approve, so the signature is global
to the user. Company isolation is preserved because the *document* and its export stay
company-scoped; the signature image is only ever surfaced to its owner or embedded
server-side into a document the caller may already read.

### D3: Stamp only on APPROVE, tolerate a missing signature
`act()` gains one step in the APPROVE branch: read `actingUser.current_signature_id` and
set it on the `ApprovalLog` being created (set at insert — append-only preserved). REJECT
/ RETURN / DELEGATE do not stamp. If the approver has no signature, `signature_id` stays
null and approval still succeeds; the PDF prints name + timestamp with a "signature not on
file" placeholder. Approval must never be blocked by a missing signature.

### D4: PDF generated server-side, streamed, authorized by read permission
A new `DocumentPdfService` under the document module renders the document header, form
field values, line items, and the approval trail (each step: approver name, acted-at,
embedded signature image fetched from storage by the stamped id). The endpoint
(`GET /documents/:id/pdf`) reuses the existing document-read guard and company scope — if
you may read the document you may export it. Signature images are fetched server-side, so
the raw signature file is never exposed via a public URL.
- **Library**: a headless-HTML renderer (render an HTML/Handlebars template → PDF) keeps
  the layout in familiar markup and dark/light is irrelevant (print styling). pdfkit is
  the fallback if a headless browser is undesirable in the deploy target. Decide at apply.

### D5: Signature upload endpoints are self-only
`POST /me/signature` (multipart) and `GET /me/signature` resolve the user from the JWT,
never from a path id — same shape as `user-profile`. Validation: image mime allow-list
(png/jpeg/svg), max size, dimensions sanity. Replacing writes a new `user_signature` row
and repoints `current_signature_id`; the old row/file is left intact for historical snapshots.

### D6: Which steps carry a signature is a per-step flag, not a raw count
`workflow_step.show_signature_on_pdf boolean` decides whether a step's approval signature
is drawn on the PDF. The number of signature blocks = the count of flagged steps, so
"signatures `<=` steps" holds by construction and there is no separate number to keep in
sync with the step list.

- **Why over a `signature_count` integer on the workflow**: a bare count leaves "*which*
  N steps?" ambiguous and can drift out of range when steps are added/removed. A per-step
  boolean names exactly which approvals appear, survives step reordering, and reuses each
  step's existing `step_name` as the signature block label (e.g. หัวหน้าแผนก / ผอ.ฝ่าย /
  CFO). Chosen with the user.
- **Default**: `true` — by default every approval step's signature shows (audit-friendly);
  an admin unticks intermediate steps to reduce the blocks. Additive/nullable in the
  migration, so existing workflows keep showing all approvers.
- **Rendering rule**: the PDF signature area lists flagged steps in `step_no` order. A
  flagged step that has an APPROVE shows the stamped signature; a flagged step with no
  APPROVE yet (exporting an in-progress document) shows an empty signature box with the
  step label. Non-flagged steps never appear in the signature area regardless of approval.
- **Setting it**: the flag is persisted through the existing workflow-step configuration
  mutation and exposed as a toggle on the step-config page.

## Risks / Trade-offs

- **Orphaned signature files after replace** → acceptable: old files are intentionally
  retained because past approvals reference them; a later GC job may prune only signatures
  that no `approval_log` row and no `current_signature_id` reference.
- **SVG signature upload = XSS/render risk** → sanitize or rasterize SVG on upload, or
  restrict to png/jpeg initially.
- **PDF library adds a heavy dependency (headless browser)** → isolate behind
  `DocumentPdfService`; the interface stays stable if we swap the renderer.
- **Large approval trails / many embedded images** → images are small signature PNGs;
  cap dimensions on upload so PDF size stays bounded.
- **Signature is an image stamp, not legally binding PKI** → documented as a Non-Goal;
  revisit if statutory e-signature is later required.

## Migration Plan

1. Migration adds `user_signature` table, `app_user.current_signature_id`,
   `approval_log.signature_id` (all nullable / additive — no backfill needed).
2. Deploy backend (signature module + PDF service). Existing approvals have null
   `signature_id`; their PDFs print name + date only — no data repair required.
3. Deploy frontend (profile signature panel, document Export-PDF action).
4. Rollback: additive columns/table can be dropped; no existing behavior changes when the
   feature is unused, so rollback is safe.

## Open Questions

- Renderer choice (headless HTML vs pdfkit) — resolve against the deploy environment.
- Allowed signature formats — png/jpeg only at first, or admit sanitized SVG?
- Should COMPLETED-only documents be exportable, or also IN_APPROVAL / DRAFT (watermarked
  "DRAFT / not fully approved")? Leaning: allow any readable status, watermark when not
  COMPLETED.
