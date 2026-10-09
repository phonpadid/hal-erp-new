## 1. Inbox: the type filter

- [x] 1.1 `PendingInboxQueryDto` gains `documentTypeId` — `@IsOptional() @IsUUID()`, like `departmentId`.
- [x] 1.2 `ApprovalInboxService.narrowing()` applies it: `where.documentType = q.documentTypeId`.
- [x] 1.3 Service test: an inbox of two types filtered to one lists only that type, with `total` counting the filtered set across pages; a malformed id is refused with 400.

## 2. Inbox: the type facets

- [x] 2.1 `pending()` returns `facets.documentTypes` — `{ id, code, name, count }` — over the matched set narrowed by everything EXCEPT `documentTypeId`, so choosing a type leaves the others offered.
- [x] 2.2 Shape the response as the pending summary shapes its facets, so the two screens read alike.
- [x] 2.3 Service test: facets count the whole matched set, not the page; and they still name the other types while one type is selected.

## 3. Web: the filter control

- [x] 3.1 `PendingInboxFilters` gains `documentTypeId`, and `inboxParams` passes it.
- [x] 3.2 The store keeps the facets from the last response for the panel to read.
- [x] 3.3 `ApprovalInboxView` adds the select (options from the facets, with counts), its chip, and clears it in `clearAll`.
- [x] 3.4 Component test: picking a type calls the server with `documentTypeId`, shows a chip, and clear-all removes it.

## 4. Payables sheet: the payee's account

- [x] 4.1 `PayablesRow` gains `payeeAccountNo` and `payeeAccountName`.
- [x] 4.2 `payables-workbook.ts`: two headers after `ບັນຊີ` (`ເລກບັນຊີ`, `ຊື່ບັນຊີ`), two cells per row — the number as a TEXT cell — blanks in the subtotal/total rows, and column widths.
- [x] 4.3 `DocumentService.payablesForIds` fills both from `d.vendorBankAccount`, empty when there is none.
- [x] 4.4 Workbook test: the two cells carry the account, a payee-less row leaves all three empty, and `0209876543` keeps its leading zero as text.
- [x] 4.5 Check the existing workbook tests' column expectations and update the ones that index columns after the amounts.

## 5. Done

- [x] 5.1 `pnpm build` in shared, back and front; both full suites green before any push.
