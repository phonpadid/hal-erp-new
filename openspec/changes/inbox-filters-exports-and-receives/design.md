## Context

The approvals inbox (`GET /approvals/pending`, `ApprovalInboxService.pending`) works like this:
1. It loads every `IN_APPROVAL` document of the active company.
2. It keeps those where `openStepFor(doc, user)` finds a step the reader may act on. The same
   resolver serves acting, the documents list's `actionable` read, and self-approval exclusion.
3. It applies the search, then the page window, in JS.

Its rows are a hand-built `PendingApproval` shape that carries the login name as `requesterName`,
and neither intake state nor an export exists.

The documents list (`DocumentService.list` / `exportPayables`) already has the pieces we need:
- validated narrowing filters (`DocumentListQueryDto`, `buildDocumentFilter`);
- `requesterIdentities` for the employee name and department;
- `intakeStateFor` for the derived intake state;
- the payables workbook, built by `exportPayables` from a visibility-scoped query.

`approval-workflow` already depends on `document-engine` in both directions through `forwardRef`,
and `PendingSummaryService` already injects `DocumentService`. Reaching into the document module
from the inbox therefore adds no new edge to the module graph.

## Goals / Non-Goals

**Goals:**
- Filters, Excel export and intake on the inbox, answering over the same set the inbox lists.
- A single definition of "the documents I may act on" for listing, exporting and paging.
- Money stays a decimal string end to end.

**Non-Goals:**
- Changing who may act on what: the resolver, delegation and escalation are untouched.
- A new workbook layout. The inbox exports the existing payables sheet.
- Server-side sorting options, or a status filter.
- Refactoring the documents list's filter panel into a shared component (see Decision 5).

## Decisions

### 1. Filters go into the DB read, before eligibility

`pending()` today loads every `IN_APPROVAL` document and resolves eligibility for each one, which
costs a route read plus a resolver call per document. The filters are added to that `em.find`
`where` (`department`, `submittedAt` range, `baseTotalAmount` range),
beside the existing `company` and `status` conditions. The search and the page window stay after
eligibility, as now.

- **Why:** narrowing first means fewer resolver calls, and the result is the same, because
  eligibility of a document does not depend on the filter.
- **Alternative considered:** filter in JS after eligibility. It is correct but pays the resolver
  cost for documents that are about to be discarded.

The date filter reads `submitted_at` (`submittedFrom` / `submittedTo`), not `created_at` as the
documents list does:
- the inbox's own column is *Submitted*;
- the pending summary already filters on `submitted_at`;
- a document enters the inbox at submit, not at draft.

The day-end-inclusive rule matches the list's `createdTo`.

`PendingInboxQueryDto` gains the fields with the same decorators as `DocumentListQueryDto`
(`@IsUUID`, `@IsDateString`, `@IsNumberString`). The global `ValidationPipe`
(`forbidNonWhitelisted`) then refuses malformed input with 400.

### 2. One function computes the actionable set; paging and export both consume it

`pending()` is split:
- `private actionableSet(q)` returns the filtered, searched, unpaged `{ doc, step, slaDueAt }[]`.
- `pending(q)` pages that set and decorates only the page.
- `exportPayables(q)` hands the ids of the WHOLE set to the document module.

- **Why:** the export must equal "what the inbox would list" (spec: *Inbox Payables Export*). Two
  code paths that each re-derive the set would eventually disagree.

### 3. The workbook is built from a given set of documents, not re-queried by visibility

`DocumentService.exportPayables` is split in two:
- `payablesFor(documents: Document[])` does the row, option and filename assembly;
- `exportPayables(q)` becomes "query by visibility + filter, then `payablesFor`".

The inbox calls a thin public `payablesForIds(ids)`, which loads the documents by id through
`forActiveCompany()` (invariant 1, the company filter applied) and delegates to `payablesFor`.

- **Why not intersect with `visibleWhere`?** Being an eligible actor on the current step is a
  stronger claim than `DOC_VIEW` visibility. The reader can already open each of these documents
  (the party half of visibility covers a live step naming them). An intersection could therefore
  only silently drop rows the inbox shows, and a sheet that disagrees with the screen is the
  failure this change exists to avoid.
- **Alternative considered:** a document-list filter `awaitingMe=true`, so the inbox becomes the
  documents list with a flag. Rejected because:
  - `document-engine` cannot call `ApproverResolverService` without inverting the dependency the
    inbox already owns;
  - it would put a second "may act" implementation beside `openStepFor`.

### 4. Row decoration reuses the list's readers, page only

The page's documents are passed to `requesterIdentities(em, docs)` and
`intakeStateFor(em, ids, viewerId?)`, the same functions `DocumentService.list` calls.
- `viewerId` is passed only when the reader holds `DOC_INTAKE_RECEIVE`, exactly as the list does.
  Every other reader gets `canReceive: false` without paying the reachability query.
- `PendingApproval` gains `requesterDepartment: string | null` and `intake: IntakeState`.
- `requesterName` becomes the resolved name.

This costs a fixed number of batch queries per page, never one query per row.

### 5. Frontend: the inbox owns its filter panel

`ApprovalInboxView.vue` gets its own popover and chips in the documents list's style, with
exactly three filters: department, a submitted-date range and amount. The user asked for exactly
these; status is fixed at pending. Filter state lives in the approvals store
next to `search`, and `loadPending` sends it with every request.

- **Why not extract a shared component from `MyDocumentsView`?** The inbox's panel is a
  deliberately small subset: department, submitted date and amount only. It has no status, type,
  vendor or "only mine", and it filters on submitted date rather than created date. The list's panel
  is also pinned by existing specs through `data-testid`s. A shared component would need a prop per
  difference, plus a regression risk on a screen this change does not otherwise touch. The
  duplication is template markup; the logic that matters (building params, chip labels) is small.
  Revisit if a third screen wants the panel.

The intake UI (selection column, bulk and row receive, reverse, intake column) mirrors the
documents list, including its gating (`DOC_INTAKE_RECEIVE` / `DOC_INTAKE_REVERSE`) and its per-row
`intake.canReceive` rule. It calls `documentsApi.receiveIntake` / `reverseIntake`, so there is one
write path.

- The selection is cleared whenever `approvals.pending` changes.
- The export button is shown to every inbox viewer, since the inbox is already gated on
  `DOC_APPROVE`. It calls `approvalsApi.exportPending(filters)` and uses `downloadBlob`.

### 6. Route

The new route is `GET /approvals/pending/payables.xlsx`, with `@RequirePermissions(DOC_APPROVE)`,
on `ApprovalInboxController` next to `pending-summary.xlsx`. The filename is
`pending-approvals-payables-<COMPANY>-<YYYY-MM-DD>.xlsx`.

## Risks / Trade-offs

- **[Risk] Export of a large inbox.** It resolves eligibility for every filtered document, as
  `pending()` already does per request.
  → The filters now cut the set before the resolver. The export builds rows with batch `$in` reads
  only.
- **[Risk] Duplicated filter markup drifts from the documents list.**
  → Both sets of field semantics are pinned by specs. Decision 5 records when to extract.
- **[Trade-off] Date semantics differ** (list = created, inbox = submitted).
  → The chip and the label say "Submitted", so the difference is visible, not hidden.
- **Budget / quota / numbering:** no flow writes `budget_txn` or `quota_usage`, and no document
  number is issued, so there is no transaction boundary or lock to specify. Intake writes remain in
  `DocumentIntakeService` under its existing transaction and lock.

## Migration Plan

No schema change and no new permission code. The change deploys with the usual `migration:up`,
which is a no-op here. Rollback is a code revert: the new query params are optional and the new
row fields are additive, so an older frontend keeps working against the new backend.

## Open Questions

_None blocking._ If finance later wants the inbox export to use a sheet other than payables (for
example the pending summary's workbook), that is a follow-up change.
