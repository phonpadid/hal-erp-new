## Why

Approved documents currently have no signed, printable artifact: the approval trail
lives only as `approval_log` rows, and there is no PDF and no visible approver
signature. Finance and audit need a document they can print/file that shows *who*
approved each step **with that approver's signature**. The signature must reflect what
the approver signed with *at the moment of approval*, not whatever they upload later —
the same "lock it at the event" discipline the system already applies to FX rates.

## What Changes

- Let a signed-in user register a reusable **signature image** for themselves
  (upload / replace), stored in S3/MinIO like attachments — never as a DB blob.
  Signature files are **immutable**: replacing a signature writes a new file, it never
  overwrites the old one, so historical approvals keep pointing at the exact image used.
- On **APPROVE**, stamp an immutable reference to the approver's *current* signature
  onto the append-only `approval_log` row. Reject / return / delegate do not stamp a
  signature. If the approver has no signature on file, the approval still succeeds and
  records "no signature" (name/date only on the PDF).
- Let an admin choose, **per workflow step**, whether that step's approval signature
  appears on the exported PDF (`workflow_step.show_signature_on_pdf`). The number of
  signature blocks on the PDF equals the number of steps flagged on — which is inherently
  `<=` the workflow's step count. Steps not flagged are approved normally but omitted from
  the PDF signature area.
- Add a server-side **Export PDF** endpoint that renders an approved (or in-approval)
  document together with its approval trail, embedding — for each flagged step that has an
  APPROVE — that step's stamped signature image, approver name, step label, and acted-at
  timestamp.
- Frontend: a signature-capture panel on the user's own profile page, and an
  **Export PDF** action on the document detail page.
- Frontend: an admin toggle on the workflow-step config page to include/exclude that
  step's signature from the PDF.
- **DBML additions** (proposed, not improvised): new table `user_signature`
  (immutable signature files per user); `app_user.current_signature_id` pointing at the
  active signature; `approval_log.signature_id` holding the locked snapshot;
  `workflow_step.show_signature_on_pdf boolean` controlling PDF signature blocks.

## Capabilities

### New Capabilities
- `document-signatures`: self-service storage of a user's reusable signature image
  (upload / replace / read own), with immutable, versioned files in object storage.
- `document-pdf-export`: server-side PDF generation of a document plus its approval
  trail, embedding each approver's stamped signature.
- `web-signature`: frontend for capturing/replacing one's own signature and for
  triggering document PDF export from the document detail view.

### Modified Capabilities
- `approval-workflow`: the APPROVE action additionally stamps the approver's current
  signature reference onto the new append-only `approval_log` row (locked at approval
  time); other actions do not stamp.

## Impact

- **DBML / migration**: new `user_signature` table; new columns
  `app_user.current_signature_id`, `approval_log.signature_id`,
  `workflow_step.show_signature_on_pdf`.
- **Backend**: new signature module (own-signature endpoints, S3/MinIO upload reusing
  the attachment storage pattern); PDF-export service + endpoint under the document
  module; one added stamp step in `approval-routing.service.ts` `act()` (APPROVE branch).
- **Frontend**: profile signature panel; document-detail Export-PDF button + API call.
- **Invariants**: `approval_log` stays append-only (signature set only at insert).
  Company isolation preserved — export/read are scoped to the active company; signature
  files are personal to the `app_user` and are only ever exposed to their owner or
  embedded (server-side) into a document that the caller is authorized to read.
- **Dependency**: adds a PDF rendering library (e.g. a headless renderer / pdfkit) to
  the backend.
