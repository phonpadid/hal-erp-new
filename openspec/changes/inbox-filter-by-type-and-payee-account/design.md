## Context

`ApprovalInboxService.actionableSet()` already builds the whole matched set before the page window —
filters are applied in the `where`, then eligibility per document, then the search. `narrowing()`
turns the query into that `where`. A type filter is one more column there, and the facets are a
count over the set that function already returns, so neither costs an extra query.

The pending-summary screen answers the same question with the same shape (`facets.documentTypes`
with counts), so the inbox's control can be built exactly like that one.

Both payables exports — the documents list's and the inbox's — go through
`DocumentService.payablesForIds` and `buildPayablesWorkbook`. `d.vendorBankAccount` is already loaded
there; `bank_code` is read from it and the other two fields are sitting beside it unused.

## Goals / Non-Goals

**Goals:**

- Filter the inbox to one document type, answered server-side across every page.
- Offer the type control from what the reader's own inbox holds, not from the company's type
  catalogue.
- Put the payee's account number and name on the payables sheet, as text.

**Non-Goals:**

- A vendor filter, or any other new filter. The spec's judgement against those stands.
- Changing which documents the inbox lists. The type filter only narrows.
- Touching the documents list's own filter panel, which already has its own.

## Decisions

**Facets come from the server, not from a type-admin endpoint.** `docConfigApi.documentTypes` needs
`DOC_CONFIG_MANAGE`, which an approver has no reason to hold, and it would list every type in the
company — mostly ones this reader never sees. The inbox already knows which types its matched set
holds.

**The type filter does not narrow its own facets.** Computing facets after applying every filter,
the type filter included, would leave the control offering exactly the type already chosen, so
nothing else could be picked without clearing first. Facets are therefore computed from the set
narrowed by everything EXCEPT `documentTypeId`. This costs a second pass over an in-memory array.

**The account number is a text cell.** `{ t: 's' }`, like `accountNo` everywhere else in this
codebase ("Text, always — an account number identifies, it does not measure"). A numeric cell drops
`0209876543` to `209876543`, which is a wrong account number, not a formatting nuisance.

**Two columns, not one.** A single "account" cell holding `0209876543 ບໍລິສັດ ກ ຈຳກັດ` cannot be
copied into a transfer form, which is the entire purpose.

**Both exports change together.** They are one builder; finance reads one sheet. Splitting them to
touch only the inbox's would mean two sheets that disagree about what a column means.

## Risks / Trade-offs

- **The sheet grows two columns**, so anyone with a saved template or macro keyed to column letters
  after `ບັນຊີ` sees them shift. The sheet is read by eye and the columns after the amounts are the
  ones finance fills in by hand, so the risk is low — but it is a visible change to a document people
  print.
- **`web-approvals` reverses a published prohibition.** That is the change's point and it is written
  down in the delta, including why, so the next reader does not "fix" it back.
- **Facets add a pass over the matched set per request.** Bounded by the inbox size (one approver's
  actionable documents), and no new query.
