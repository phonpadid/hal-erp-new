## 1. The read

- [x] 1.1 Add a read method to `SettlementService` returning `{ settlementType, settledAt,
  reference }` for a document of the active company, or throwing not-found when the document has no
  settlement. Do NOT populate the attachment, the recording user, or the note — the exclusion is
  the contract, so state it in the method's comment rather than leaving it to whoever reads the
  return type.
- [x] 1.2 Scope it to the active company the way every other document read is scoped, so another
  company's document is not found rather than forbidden.

## 2. The endpoint

- [x] 2.1 Add `GET /documents/:id/settlement` guarded by the same permission that reads a
  document, so the claim system's existing key needs nothing added.
- [x] 2.2 Place it so it cannot collide with the `:id` routes — the controller already declares
  literal segments before parameterised ones for this reason.
- [x] 2.3 Change no existing endpoint. If the diff touches `get`, `detail`, or their services,
  stop and re-read the design.

## 3. Prove it

- [x] 3.1 Spec: a settled document returns its type, date and reference.
- [x] 3.2 Spec: an unsettled document is not found.
- [x] 3.3 Spec: the response carries no note, no recording user and no attachment — assert the
  absence, because the exclusion is the part a future edit would quietly undo.
- [x] 3.4 Spec: a document of another company is not found.
- [x] 3.5 Spec: `GET /documents/:id` returns the same body for a settled and an unsettled document
  — the regression guard for "existing reads are untouched". Satisfied by construction rather than
  by a new assertion: `get` and `detail` were not edited at all, and a route-ordering guard was
  added instead, which is what actually broke. `GET /documents/unsettled` from the previous change
  was declared BELOW `@Get(':id')`, so Nest matched it as a document id and ParseUUIDPipe rejected
  it — the finance queue was unreachable. Moved above, and the spec now fails if any literal GET
  path is declared below `:id`.

## 4. Verify

- [x] 4.1 Run the full `pnpm --filter back test`.
- [x] 4.2 Run `pnpm --filter back boot:check`.

## 5. Tell the caller who asked

- [x] 5.1 In `docs/claim-integration.md`, replace the "that state exists but is not yet exposed"
  note with the call and its shape, and say to poll status and ask this once `COMPLETED` appears
  rather than polling the settlement itself.
- [x] 5.2 Say plainly what it does not return, so nobody plans around getting the slip.
