## Why

Two asks from the people who use the approvals inbox every day.

An approver's inbox mixes every kind of document — disbursements, purchase requests, budget
movements — and the panel offers no way to see one kind at a time. `web-approvals` currently forbids
exactly that: *"The panel SHALL NOT offer … a document-type or vendor filter"*. That was a judgement
about keeping the panel small, not an invariant, and the people doing the work are asking for it;
this change reverses the judgement in the spec rather than quietly contradicting it in code. The same
requirement says the panel holds "exactly three filters" while the code has offered a fourth (intake)
since finance's intake landed, so the requirement is restated to match what the panel actually is.

The payables sheet names the payee's **bank** (`BCEL`, `LDB`) but neither the account number nor the
account name. Finance reads that sheet to make the transfers and has to open each document to copy
the two fields a transfer actually needs, for every row.

## What Changes

- The inbox read accepts `documentTypeId`, validated and applied like its other filters, narrowing
  the actionable set across every page before the window.
- The inbox response carries the document types present in the whole matched set, with counts, so
  the panel can offer them without a second privileged endpoint — the shape the pending summary
  already returns for the same purpose.
- The filter panel gains a document-type select, with its own removable chip, cleared by the same
  clear-all.
- **BREAKING (spec only)**: `web-approvals`' prohibition on a document-type filter is removed. No API
  or data contract changes for anyone else.
- The payables workbook gains two columns after the bank column: the payee's account number
  (`ເລກບັນຊີ`) and account name (`ຊື່ບັນຊີ`), both from the `vendor_bank_account` the document names
  and both empty when it names none.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `approval-workflow`: `Approval Inbox Query` accepts a `documentTypeId` filter and reports the
  document-type facets of the matched set.
- `web-approvals`: `Approval Inbox` offers a document-type filter — the requirement that forbade one
  is rewritten, and the intake filter the panel already has is written down.
- `payables-worksheet-export`: `The Sheet Has Finance's Columns In Finance's Order` gains the payee's
  account number and account name.

## Impact

- `back/src/modules/approval/dto/workflow.dto.ts` — `PendingInboxQueryDto`.
- `back/src/modules/approval/approval-inbox.service.ts` — `narrowing()` and the `pending()` response.
- `back/src/modules/document/payables-workbook.ts` — two columns.
- `back/src/modules/document/document.service.ts` — `payablesForIds` row shaping.
- `front-end/src/api/approvals.ts`, `front-end/src/views/approvals/ApprovalInboxView.vue`.
- Both payables exports — the documents list's and the inbox's — change together, because they are
  one workbook builder fed by one row builder. That is intended: finance reads one sheet.
- No migration, no new table, no invariant touched. The type filter only narrows, so it cannot admit
  a document the unfiltered inbox would not list (invariant 1 unaffected).
