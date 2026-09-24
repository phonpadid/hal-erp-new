## 1. Backend: inbox query filters

- [x] 1.1 Add to `PendingInboxQueryDto` (`back/src/modules/approval/dto/workflow.dto.ts`) the optional
  fields below, with the same decorators `DocumentListQueryDto` uses for the same kind of field:
  `departmentId` (`@IsUUID`), `submittedFrom`, `submittedTo`
  (`@IsDateString`), and `minAmount`, `maxAmount` (`@IsNumberString`, kept as strings)
- [x] 1.2 In `ApprovalInboxService`, add the filters to the `em.find` `where` beside `company` +
  `status`:
  - `department`;
  - `submittedAt` `$gte` from, `$lte` end of the `submittedTo` day (the list's day-end rule);
  - `baseTotalAmount` `$gte` / `$lte` as strings
- [x] 1.3 Split `pending()` into:
  - `private actionableSet(q)`: the filtered, eligible, searched, unpaged list of `{ doc, step, slaDueAt }`;
  - `pending(q)`: the page window over it.

  Eligibility stays `openStepFor`, unchanged
- [x] 1.4 Decorate only the page:
  - `requesterIdentities(em, pageDocs)` gives `requesterName` (resolved) and `requesterDepartment`;
  - `intakeStateFor(em, ids, viewerId?)` gives `intake`, with `viewerId` passed only when the
    reader holds `DOC_INTAKE_RECEIVE`.

  Extend the `PendingApproval` interface to match
- [x] 1.5 Unit tests (DB-backed, `approval-inbox.spec.ts`), one per scenario in
  `specs/approval-workflow/spec.md`:
  - a filter narrows across pages and `total` follows;
  - a filter never surfaces an own or non-eligible document;
  - the submitted date is inclusive of its last day;
  - `maxAmount` `1000000` excludes `1000000.01`;
  - a malformed filter gives 400 (DTO validation spec);
  - intake state on rows, and `canReceive` false without the code;
  - the requester is named from the employee record

## 2. Backend: inbox payables export

- [x] 2.1 Split `DocumentService.exportPayables`:
  - extract `payablesFor(em, documents)`, which assembles the rows, options and filename;
  - `exportPayables(q)` becomes visibility query + `payablesFor`.

  `payables-export.spec.ts` and `payables-workbook.spec.ts` must stay green unchanged
- [x] 2.2 Add public `DocumentService.payablesForIds(ids)`: load by id through `forActiveCompany()`
  with the same populate and order as today, then `payablesFor`
- [x] 2.3 Add `ApprovalInboxService.exportPayables(q)`, which passes the ids of `actionableSet(q)` to
  `payablesForIds`, and inject `DocumentService` (already wired via `forwardRef`)
- [x] 2.4 Add `GET /approvals/pending/payables.xlsx` to `ApprovalInboxController` with
  `@RequirePermissions(DOC_APPROVE)` and the xlsx content type. Name the file
  `pending-approvals-payables-<COMPANY>-<YYYY-MM-DD>.xlsx`
- [x] 2.5 Tests:
  - the export holds exactly the whole filtered actionable set across pages;
  - a COMPANY-scope viewer exports only their actionable documents;
  - 403 without `DOC_APPROVE`;
  - the export writes nothing

## 3. Frontend: API and store

- [x] 3.1 In `front-end/src/api/approvals.ts`:
  - add `PendingInboxFilters`;
  - extend `pending()` to send the set filters only;
  - add `exportPending(filters)`, a blob plus the filename from Content-Disposition, like
    `documentsApi.exportPayables`;
  - add `requesterDepartment` and `intake: IntakeState` to `PendingApproval`
- [x] 3.2 In `stores/approvals.ts`:
  - hold `filters` beside `search`;
  - `loadPending` sends them;
  - add `applyFilters(f)` and `clearFilters()`, both back to page 1

## 4. Frontend: inbox view

- [x] 4.1 Add the filter button (with an active-count badge), the popover and the removable chips to
  `ApprovalInboxView.vue`:
  - department (`DEPARTMENT_VIEW`);
  - submitted-date range;
  - min/max amount as strings, debounced.

  These three only: no status (fixed at pending), no type, no vendor, no "only mine"
- [x] 4.2 Add the Excel export button: busy state, a disabled state while running, and a toast on
  failure. It builds its params from the panel's current values, not the store's applied ones
- [x] 4.3 Add the intake UI, mirroring `MyDocumentsView`:
  - the selection column, the bulk receive with a count of `intake.canReceive` rows, the row
    receive, the reverse button (`DOC_INTAKE_REVERSE`), and the intake column;
  - the selection is cleared when `approvals.pending` changes;
  - after receive or reverse, reload the inbox
- [x] 4.4 Show the requester's department under the name in the requester column
- [x] 4.5 Add the i18n keys to every locale (`i18n.parity.spec.ts` and `no-literal-text.spec.ts`
  must pass), reusing the existing `documents.filters.*` / `documents.list.intake.*` keys where
  the wording is the same
- [x] 4.6 View specs (`views/approvals/`), from `specs/web-approvals/spec.md`:
  - choosing a filter reloads page 1 with the param;
  - removing a chip drops its param;
  - the panel holds only department, date and amount;
  - the export sends the on-screen filters;
  - a failed export shows a toast and re-enables the button;
  - the intake column and actions are absent without the codes and present with either;
  - the row receive shows only when `canReceive`;
  - a partly refused batch names the refusal;
  - paging clears the selection.

  `approval-inbox-responsive.spec.ts` stays green

## 5. Verification

- [x] 5.1 `DB_PORT=5433 DB_NAME=erp_test pnpm -C back test` and `pnpm -C front-end run ci` are green
- [x] 5.2 Drive it in the browser against the local stack as a finance approver:
  - filter the inbox to this week and export;
  - check that the workbook rows match the inbox;
  - tick rows and receive them;
  - check that a non-finance approver sees no intake column
