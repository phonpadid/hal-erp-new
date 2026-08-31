## 1. The read

- [x] 1.1 The mapping list's query DTO gains optional `departmentId`, `documentTypeId` and
      `isActive`. None defaults — `isActive` in particular must not default to true.
- [x] 1.2 `DeptDocTypeService.listForCompany` `$and`s each given narrowing onto the
      already-company-scoped predicate, alongside `withSearch`. It narrows; it never replaces.
- [x] 1.3 The reported `total` counts what matches the narrowing, not every mapping in the company —
      otherwise the "showing N of M" the screen renders is a lie in the direction that matters.
- [x] 1.4 No schema change, no migration. Three optional read parameters.

## 2. The department options

- [x] 2.1 A read returning the departments that hold at least one mapping in the active company,
      authorized by the same code the mapping list is. NOT `GET /departments`, which needs
      `DEPARTMENT_VIEW` — a `DOC_CONFIG_MANAGE` holder need not have it, and sourcing the dropdown
      there hands an empty filter to the administrator it is for.
- [x] 2.2 Identifying fields only, company-scoped, ordered so the list is stable.

## 3. The screen

- [x] 3.1 Three controls in the toolbar: department, document type, active. Each sends its value to
      the server and resets to page 1.
- [x] 3.2 The active control is tri-state — unset / active / inactive — not a checkbox.
- [x] 3.3 With any filter applied, the screen states how many mappings are shown out of how many
      exist.
- [x] 3.4 Three locales for any new label.

## 4. Tests

- [x] 4.1 Narrowing to a department returns only that department's mappings.
- [x] 4.2 Narrowing to a document type returns only that type's, across departments.
- [x] 4.3 The narrowings compose with each other and with the search term.
- [x] 4.4 A department of another company narrows to nothing rather than reaching across
      (invariant 1) — asserted from both directions.
- [x] 4.5 Deactivated mappings come back when no active narrowing is given, and only they come back
      when narrowed to inactive.
- [x] 4.6 `total` reflects the narrowing, not the company's whole set.
- [x] 4.7 The department-options read is refused without the mapping list's own permission, and
      returns only departments that hold a mapping.
- [x] 4.8 The screen sends each filter to the server and resets to page 1; it does not filter the
      loaded page.
- [x] 4.9 The shown-of-total count appears once a filter is applied.
- [x] 4.10 The existing doc-config mapping suites pass unchanged.

## 5. Verify in the app

- [x] 5.1 On the customer's 80 mappings, filter to `ພະແນກບໍລິຫານ` and confirm the list shows that
      department's mappings and says so out of 80. Read only — this screen edits configuration, so
      do not save anything to prove a filter works.

      Verified against the running app on the customer's real 80 mappings. Nothing was saved.

      - unnarrowed: 80 rows, no count shown — a count beside a whole list is noise
      - by department `ພະແນກບໍລິຫານ`: `ສະແດງ 4 ຈາກ 80`, and the four types it may raise are
        `BUDGET_PLAN`, `BUDGET_ADJ_INC`, `BUDGET_ADJ_DEC`, `SPEND_HIST` — the question the screen
        exists to answer, on screen in one action
      - composed with the type filter (`SPEND_HIST`): `ສະແດງ 1 ຈາກ 80`, one row
      - narrowed to inactive: `ສະແດງ 0 ຈາກ 80` — correct on data where all 80 are active, and the
        control behaves rather than appearing broken
      - no console errors

      **Defect found and fixed while verifying**: the first filter applied rendered
      `ສະແດງ 4 ຈາກ 0`. The denominator is only knowable from a read with nothing narrowing it, and
      on a first visit that read happens inside `loadAll`, which never recorded it. The unit tests
      had missed it because they SEEDED `mappingsTotalUnfiltered` — the very number the code must
      derive. Fixed in `loadAll`, and pinned by two tests that run against a real store rather than
      the action-stubbing mount helper.
