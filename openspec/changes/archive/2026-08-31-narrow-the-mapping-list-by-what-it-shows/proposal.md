## Why

The department-mapping screen shows five columns — department, document type, template, workflow,
active — and offers one search box and no filter. Measured on the customer's data today:

| | |
|---|---|
| mappings | **80** — four pages of 20 |
| departments | **20** |
| document types | **4** |
| active | 80 of 80 |

An administrator asking the question this screen exists to answer — *which document types is
`ພະແນກບໍລິຫານ` allowed to raise?* — has to guess a word the department's name shares, or page
through all four pages and read 80 rows. Search cannot express it: search finds *a* mapping whose
department name or type code you can partly remember, and a department name typed into the box
matches the department column of every one of that department's four rows while telling you nothing
about which types are missing.

`narrow-a-budget-list-to-what-you-own` settled this exact question one screen over, and its
reasoning holds here unchanged: the columns a reader is shown are the dimensions they will try to
narrow by, and offering none is why the search box gets asked to do a job it cannot. That change
also recorded the rule this one must follow — a control that appears to filter must filter the
whole list, not the page the client happens to hold.

## What Changes

- The mapping list gains a **department** filter, a **document type** filter and an **active**
  filter, applied server-side alongside the existing search.
- The three compose with each other and with `search`, and each resets the list to page 1.
- A filter states what it is hiding: with one applied the screen says how many rows it is showing
  out of how many exist, so a narrowed list cannot be mistaken for the whole one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: the mapping read gains the three optional narrowing parameters, which narrow
  the company-scoped predicate and can never replace it.
- `web-doc-config`: "Department Document Mapping" gains the filters and the shown-of-total count.

## Impact

- **Capabilities touched**: `document-engine` (the read), `web-doc-config` (the screen). No other
  screen reads this list.
- **Invariant risk**:
  - INVARIANT 1 (company isolation): each filter NARROWS `{ department: { company: companyId } }`
    and must never replace it — a department id from another company must therefore match nothing
    rather than reach across. This is the property `withSearch` already relies on, and the filters
    must be composed the same way.
  - INVARIANT 5 (permission codes): unchanged. The screen stays behind `DOC_CONFIG_MANAGE`, and no
    filter widens what a caller may read.
- **Ledger**: nothing here writes anything. Three optional query parameters and three controls.
- **Code**: `DeptDocTypeService.listForCompany`, its query DTO, the doc-config API client, and
  `DeptMappingsView`.
- **The active filter is inert today.** All 80 mappings are active, so it will narrow nothing until
  somebody deactivates one — but the column is already on screen, and a column a reader can see is
  a dimension they will try to narrow by. Included for that reason, not because the current data
  needs it.
- **Not in scope — a workflow filter.** The column is there and only two workflows exist, so a
  filter over it separates 80 rows into roughly two heaps and answers no question anybody is asking
  yet. Worth adding the day a company configures more than a handful.
- **Not in scope — the missing-mapping question.** "Which types is this department NOT allowed to
  raise" is the other half of what an administrator wants, and no filter over existing rows can
  answer it: it is about absent rows. A real need, a different screen.
