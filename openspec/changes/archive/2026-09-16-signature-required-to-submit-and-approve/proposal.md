## Why

The exported PDF is the paper the company keeps. Its signature row is drawn from the
signature each approver had on file *at the moment they approved* (`approval_log.signature_id`),
and that snapshot is locked for ever. Today nothing stops a person who has never uploaded a
signature from approving — the code even says so ("a missing signature is fine and never
blocks approval") — so the printed sheet comes out with a ruled line where a signature should
be, and no later upload can repair it. On the live database 70 of 89 users have no signature.

Two more things on the same row are wrong for the people who read it: the proposer has no
signature block at all (only a typed identity line), and every approver column is headed
"ຂັ້ນທີ 1 / 2 / 3" because `workflow_step.step_name` is empty on every step in production — a
label that tells the reader nothing about *who* signed in what capacity.

## What Changes

- **A person cannot submit a document without a signature on file.** `POST /documents/:id/submit`
  made by a signed-in person (JWT) is refused with a stable `SIGNATURE_REQUIRED` reason when the
  submitter's `app_user.current_signature_id` is null. The submitter's current signature is
  stamped on the document at submit (**new column** `document.submitted_signature_id →
  user_signature.id`), locked like the FX rate (invariant 6) and never recomputed.
- **A person cannot APPROVE without a signature on file.** `POST /documents/:id/actions` with
  `action = APPROVE` is refused with `SIGNATURE_REQUIRED` when the *acting* user (the delegate,
  when acting under delegation) has no current signature and the recorded step is flagged
  `show_signature_on_pdf`. REJECT / RETURN / CANCEL are unchanged — they stamp no signature.
  **BREAKING** for the `approval-workflow` scenario *"Approve without a signature still records
  the action"*, which this change supersedes; historical rows with a null `signature_id` stay
  valid and still render.
- **API-key submits are exempt.** An external system (`authSource = 'api-key'`, e.g. CLAIM) may
  still create and submit under `external-api`; it stamps no requester signature and the requester
  block prints the name over a ruled line. API keys already cannot approve (`ApiKeyDenyGuard`).
- **The PDF gains a proposer signature block** — first in the row, headed ຜູ້ສະເໜີ, showing the
  stamped `submitted_signature_id` image, the proposer's name and the submit date. Documents
  submitted before this change are stamped once by migration with the signature their proposer
  had on file **at submit time** (155 of 391 on production); one whose proposer had none then, or
  an API-key submit, shows the name over a ruled line. A signature a document is stamped with
  cannot be deleted.
- **Approver block headings become the approver's position.** For a block whose step has an
  APPROVE entry, the heading is the approver's `employee.position` (in the document's company),
  replacing the recorded `step_name` / "ຂັ້ນທີ N" fallback. A block not yet approved keeps
  `step_name` when configured, else "ຂັ້ນທີ N". Applies to both the letter (pdfkit) and the sheet
  (pdfmake) layouts. (The department was dropped from the heading on review — too long for a column.)
- **The signature row wraps at five columns** and holds at least ten signatures on A4, every
  column the same width; a route of seven steps plus the proposer no longer runs off the page.
- **`GET /auth/me` returns `hasSignature`** so the web app knows at login, without an extra call.
- **Web UI gates (UX mirror; server enforces):** "New document" (documents list), "Save & submit"
  (create wizard), "Submit" (detail) and "Approve" (detail) are disabled for a user with no
  signature, with a message that links to `/new/profile` where the signature is uploaded. The
  profile page updates the store after a successful upload so the buttons come alive without a
  reload. Server `SIGNATURE_REQUIRED` refusals surface with the same message. Reject / Return /
  Save draft stay enabled.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `document-engine`: submit lifecycle gains the requester-signature precondition (person submits
  only) and stamps `document.submitted_signature_id`.
- `approval-workflow`: APPROVE on a `show_signature_on_pdf` step requires the acting user's
  current signature; the "Approve without a signature still records the action" scenario is
  replaced by a refusal scenario. Non-approve actions and delegation semantics are unchanged.
- `document-pdf-export`: new proposer signature block; approver block heading changes from
  `step_name` to the approver's position once approved; the row wraps at five columns; placeholder rules for
  documents submitted before the column existed or by an API key.
- `rbac`: `GET /auth/me` context includes `hasSignature`.
- `web-documents`: create / submit affordances disabled without a signature, linking to the
  profile page; `SIGNATURE_REQUIRED` refusal shown readably.
- `web-approvals`: Approve affordance disabled without a signature, linking to the profile page;
  Reject / Return unaffected.
- `document-signatures`: the own-signature panel refreshes the shared session context
  (`hasSignature`) after an upload, so gates elsewhere in the app clear immediately.

## Impact

**Capabilities touched (of the build order):** rbac, document-engine, approval-workflow, plus the
PDF export and web layers on top of them. Master-data, budget-control, quota, inventory,
notifications are untouched.

**Invariants checked:**
- Invariant 2 (append-only `approval_log`): the gate runs *before* the log row is inserted, so
  nothing is written then reverted; no UPDATE/DELETE anywhere.
- Invariant 6 (locked stamps): `submitted_signature_id` is stamped once at submit and never
  recomputed, exactly like `exchange_rate`; the PDF reads the stamp, never the current signature.
- Invariant 7 (configuration over code): the approve gate keys off the recorded step's
  `show_signature_on_pdf`, not the document type.
- Invariant 8 (no self-approval / no chained delegation): unchanged; the gate checks the *acting*
  user's signature, which is also the one that gets stamped.
- Invariant 1 (company isolation): the approver's department/position are resolved from the
  `employee` row in the document's own company only.

**Schema:** one nullable FK column on `document` (`submitted_signature_id`), DBML + MikroORM
migration, plus a one-time data migration recovering stamps for older documents. No change to
`approval_log`.

**Code:** `document-submit.service.ts`, `approval-routing.service.ts` (act + canAct reason),
`rbac-auth.service.ts#identity`, `document-pdf.service.ts`, `document-sheet.renderer.ts`,
`document.entities.ts`; front-end `stores/auth.ts`, `MyDocumentsView.vue`,
`CreateDocumentView.vue`, `DocumentDetailView.vue`, `SignaturePanel.vue`, i18n en/la/zh.

**Tests:** ~19 backend spec files submit documents and ~10 approve them with fixture users that
have no signature — they need a shared `giveSignature` fixture helper. Existing approve-without-
signature test flips to expect a refusal; PDF heading assertions change.

**Rollout / people:** after deploy, users without a signature (70 of 89 on production today)
cannot submit or approve until they upload one at `/new/profile`; documents already waiting on
them will stall until then. Needs an announcement before release. The mobile app (`app/`) calls
the same endpoints and has no signature upload screen — it will receive `SIGNATURE_REQUIRED` and
must show "upload your signature on the web first" (mobile UI change is out of scope here but
the error contract is designed for it).

**External API:** unchanged contract — a key can still create and submit; its documents simply
carry no requester signature.
