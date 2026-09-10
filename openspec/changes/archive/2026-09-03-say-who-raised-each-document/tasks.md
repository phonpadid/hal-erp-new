## 1. The list read names the requester

- [x] 1.1 In `document.service.ts` `list()`, after `paginate(...)`, collect the distinct
      `created_by` ids of the returned page
- [x] 1.2 Resolve names in TWO reads, both on the company-scoped EM: every `Employee` whose `user` is
      one of those ids **and whose company is the document's company**, selected with
      `fields: ['fullName', 'user', 'department.name']` — the department rides the same row, so it
      costs no extra query; then `AppUser` for the ids that matched no employee, with
      `fields: ['username']`. Never populate the relation onto the document — it would serialize the
      whole `AppUser`, `passwordHash` included, which is why `detail()` reads partials
- [x] 1.3 Return each row as its JSON plus `requesterName: string | null` and
      `requesterDepartment: string | null`, and WITHOUT the raw `createdBy` id; keep `total`, `page` and `limit` from the paginator untouched
- [x] 1.4 Leave the `mine` filter as it is — it is applied server-side from the request context and
      needs no id on the row

## 2. The client carries and shows it

- [x] 2.1 Add `requesterName?: string | null` and `requesterDepartment?: string | null` to `DocumentSummary` in `front-end/src/api/documents.ts`
      and remove nothing else from the type
- [x] 2.2 Add a Requester column AND a Department column to `MyDocumentsView.vue`, both
      `data-priority="secondary"`, beside Created and Next approver, each rendering its value or the
      muted dash when null
- [x] 2.3 Add `documents.list.columns.requester` to `en`, `la` and `zh` — reuse the wording the
      approvals list already uses for the same idea (`Requester` / `ຜູ້ສະເໜີ` / `申请人`), and
      `documents.list.columns.requesterDepartment` (`Department` / `ພະແນກ` / `部门`)

## 3. Tests

- [x] 3.1 Backend: a list page names each document's creator by employee full name when the creator
      has an employee record in that company, and by username when they do not; the department is
      that employee's, and is null for the username case
- [x] 3.2 Backend: an employee record of ANOTHER company for the same user does not supply the name
      (D2 — the scoping is the point, and a same-user-different-company fixture is what proves it)
- [x] 3.3 Backend: the returned rows carry no `createdBy` and no field of `AppUser` other than the
      resolved name
- [x] 3.4 Backend: resolving a page costs a bounded number of queries, not one per row
- [x] 3.5 Frontend: the list renders the requester for a row that has one and the empty dash for a
      row whose `requesterName` is null

## 4. Verify in the app

- [x] 4.1 Open the documents list and confirm the column names the creator — `TRAVEL-HAL-2026-0002`
      and `DISB_TEST-HAL-2026-0001` were both raised by `jek`, so both must say so
- [x] 4.2 Open one of those documents and confirm the detail names the same person as the list.
      Both reads return `ທ້າວ ບຸນຮຽງ ບົວສີປະເສີດ` for `TRAVEL-HAL-2026-0002`, so they agree —
      verified against the API, because the detail SCREEN does not render the requester at all. It
      has resolved `requesterName` all along and nothing prints it; that is a gap this change did not
      create and does not close
