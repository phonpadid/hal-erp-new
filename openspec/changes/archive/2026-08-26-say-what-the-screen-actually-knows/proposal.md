## Why

A second end-to-end pass, this time driven through the browser rather than the API
(`docs/ui-run-2026-08-26.md`, 2026-08-26), ran the whole document lifecycle for a `REC` type:
create, upload, submit, approve twice, return, resubmit, reject, withdraw, self-approve, overspend,
list, search, export. **Every lifecycle case behaved correctly** — the engine fixes from
`keep-a-document-moving-after-submit` hold through the UI, and the budget arithmetic on screen
matches the ledger.

Three defects remain, and none is in the engine. Each is a screen telling the user something other
than what the system knows: a search box that filters nothing, a warning about a file that is
already attached, and a document type the wizard offers but cannot finish.

## What Changes

**The approval inbox's search searches the queue, not the page.**
- `ApprovalInboxView` binds its search box to PrimeVue's `filters` / `globalFilterFields`, but
  `AppDataTable` runs the table in `lazy` mode, where PrimeVue delegates filtering to the server and
  never applies `filters` itself. Nothing handles the filter event, so typing does nothing at all —
  verified: searching `SPEND` returned twenty unrelated `REC*` rows.
- It matters because the inbox pages: the approver in this run had 43 pending documents across three
  pages and no way to find one except by eye.
- The search SHALL query the server across the whole pending set, the way `MyDocumentsView` already
  does with `docNo`. Client-side filtering is not an acceptable fix here — in lazy mode the client
  holds one page, so it would search 20 of 43 and look like it worked.

**A draft stops claiming a required file is missing when it is attached.**
- `DocumentDetailView.missingRequiredFields` builds its value map from `docs.fieldValues` alone. A
  `file` field never has a `doc_field_value` row — its value is a `document_attachment` — so a
  required file field is reported missing on every editable draft, always. `line_items` has the same
  shape: its value is a `document_line`.
- The server's submit gate, which this prompt exists to mirror, already special-cases exactly those
  two field types. The client's copy omits the special case, and the comment above it claims it
  "can never disagree with the wizard or the server submit gate".
- **This is what makes a refused submit unreadable.** The true reason is a toast that
  auto-dismisses; the false banner does not. On the over-budget case in this run, ten seconds later
  the only instruction left on screen was to attach a file that was already attached — the actual
  refusal (`2000000 requested, 1000000 available`) was gone. A screen SHALL keep the reason a submit
  was refused visible for as long as the document is still refused.

**`BUDGET_PLAN` names the screen that authors it.**
- No spec changes here: `web-documents` already requires *Choosing a Type Authored Elsewhere Goes
  There*, with the scenario "A budget plan goes to the budget screen", and `CreateDocumentView`
  already honours `authoring_route`. This company's `BUDGET_PLAN` row simply has `authoring_route`
  NULL, so the wizard walks the user through four steps, mints `BUDGET_PLAN-HAL-2026-0096`, and
  refuses at submit — a real document number spent on a draft that can never be submitted, because
  its content lives on `budget_movement` where the generic form cannot write.
- Fixed as configuration, plus a guard so the gap is visible rather than discovered by a user.

**A disagreeing API origin says which two files disagree.**
- `front-end/.env` points at `http://localhost:3000/api-new` while a machine's `back/.env` may set
  another port; login then fails with `ERR_CONNECTION_REFUSED` and nothing on screen names either
  file. **Corrected from an earlier draft of this proposal, which said the repository ships a
  broken pair — it does not.** `back/.env.example` sets `PORT=3000`, both READMEs document 3000,
  `main.ts` defaults to 3000, and both `.env` files are gitignored: the divergence is local, not
  committed.
- The requirement is therefore about making local drift *visible*, not about changing a checked-in
  value. Nothing in the repository needs to move.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-approvals`: *Approval Inbox* gains a requirement that its search resolves against the whole
  pending set server-side, and that a queue spanning pages stays navigable.
- `web-documents`: a new requirement that a draft's completeness prompt counts a field's value
  wherever that field's type actually stores it — an attachment for `file`, lines for `line_items` —
  and that the reason a submit was refused stays legible until it stops being true.
- `platform-foundation`: *Local development environment* gains a requirement that a disagreement
  between the front-end's configured API origin and the backend's configured port is reported by a
  command that names both values, rather than surfacing as a connection error at the login screen.

## Impact

**Build-order capabilities touched:** none of the nine domain capabilities changes behaviour. This
is presentation over `approval-workflow` (inbox) and `document-engine` (draft completeness,
authoring route), plus one configuration row.

**Invariants:** none is affected. No fix writes `budget_txn` or `approval_log`; no money is
formatted or computed differently; the self-approval rule and the inbox's exclusion of a user's own
documents are unchanged and were both verified correct in this run.

**Code**
- `front-end/src/views/approvals/ApprovalInboxView.vue` — search to the server; `stores/approvals.ts`
  to carry the term.
- `front-end/src/views/documents/DocumentDetailView.vue` — `missingRequiredFields` counts
  attachments and lines; keep a refused submit's reason on screen.
- `front-end/src/components/AppDataTable.vue` — if it keeps accepting `filters`, it should not
  silently ignore them in `lazy` mode.

**Data:** one row — `document_type.authoring_route = 'budgets'` for `BUDGET_PLAN` in company HAL.
No migration; the column already exists and is already read.

**Not in scope:** the over-budget message naming its control point, budget node and department node
by UUID rather than by name. The numbers in it are correct and the message is the server's; making
it readable is a separate change.
