# No flag without its prerequisite

## Why

`document_type` carries eighteen columns, and several of them only mean anything when another
column on the same row is set a particular way. Nothing states those dependencies, and nothing
enforces them. A configuration that cannot work is accepted, stored, and discovered later by
somebody else.

Three of them, found by sweeping every flag for where it is read at runtime and asking what that
read is gated behind.

**A type may require a payee it can never be given.** `requires_payee` is enforced at submit like
this:

```
if (docType.requiresPayee) {
    the document must carry a vendorBankAccount
    ...and it must belong to document.vendor
}
```

A payee IS a vendor's bank account: the client's picker loads from `usePayeeAccounts(vendorId, …)`,
and the server rejects a payee that does not belong to the document's vendor. So a type with
`requires_payee` and without `requires_vendor` asks for a value the wizard never collects the
prerequisite for — the picker has nothing to offer, and every submit is refused for a field the user
was given no way to fill. This is the shape the warehouse 403 had: a required field whose list is
permanently empty.

**A type may move stock without being asked where.** The whole warehouse gate — source warehouse,
and for a transfer the destination and the two-must-differ rule — sits inside
`if (docType.requiresWarehouse)`. A type whose `post_action` is `ISSUE_STOCK` or `TRANSFER_STOCK`
but whose `requires_warehouse` is false skips all three checks, then reaches the stock reservation
with an undefined warehouse, held together by a non-null assertion:

```
if (docType.requiresWarehouse) { ...every warehouse check... }
                    ⋮
if (reservesStock) { demandFor(tem, document, stockWarehouseId!) }   ← the ! covers the hole
```

**Tested rather than reasoned about.** A `TRANSFER_STOCK` type with `requires_warehouse = false`,
one line, one stock-tracked item, submitted through the API:

```
POST /documents/:id/submit  →  500 Internal Server Error
log: ValidationError: Value for Warehouse.id is required, 'undefined' found
```

No data was harmed — `stock_txn.warehouse_id` is NOT NULL, MikroORM validates on flush, and the
transaction rolls back with stock and the document untouched. So this is a legibility failure, not
a corruption one: the user is told "Internal server error" when the truth is that the document type
is misconfigured, and the person who misconfigured it is not there.

**A type may recognise an expense it has no way to measure.** `accrues_on_approval` posts an entry
debiting the expense accounts named by the document's `ACTUAL` budget rows. Which rows depends on
whether the document names a vendor: a purchase follows its reference chain to the ancestor that
reserved, and a compensation reads its own. A type that sets `accrues_on_approval` with neither
`requires_budget` nor `requires_vendor` has neither source — no budget of its own, and no vendor to
make it a purchase — so the accrual finds nothing, logs `Accrual skipped`, and records a **terminal**
outcome that is never retried. The document is approved and its books say nothing happened.

The reference configuration gets this right by accident of having only two accruing types, each
covering one branch: `DISB` has a vendor and a chain, `CLAIM` has its own budget. Nothing stops a
third that has neither.

**Both remaining halves have precedent.** `DocumentTypeService` already refuses a second active
`POST_JOURNAL` type and an unknown category, and — since
`reserve-only-what-something-can-settle` — refuses a reserving type with no settlement and an
accruing self-reserving type that does not settle at its own approval. This continues that work
rather than starting something new.

**And this is the same defect the last several changes have closed, in the place configuration is
written.** A wizard offering a document it could not finish; a card routing to a screen the user
could not open; a picker calling an endpoint the role could not reach; a type reserving budget
nothing could settle; a workflow step nobody could approve. Each time the system accepted something
it would not honour.

## What Changes

**A type that requires a payee SHALL require a vendor.** The payee is that vendor's bank account,
in the picker and in the submit check alike; asking for one without the other is asking for a value
the document has no way to produce.

**A type whose post-action moves stock SHALL require a warehouse.** Stock moves out of somewhere and
into somewhere, and every check that establishes where sits behind `requires_warehouse`. Without it
the guards do not merely fail to apply — they are skipped, and the reservation proceeds on a
warehouse that does not exist.

**A type that recognises its expense at approval SHALL have somewhere to recognise it from** —
either its own budget, or a vendor that makes it a purchase whose chain carries the charge. A type
with neither can only ever record a skipped accrual.

**All three are checked on the resulting state when the type is written**, active types only,
joining the rules already in `DocumentTypeService`. None of them changes any runtime behaviour: each
describes a configuration that is already broken, and refuses to store it.

## Who this answers

| party | today | after |
| --- | --- | --- |
| whoever raises a payee-requiring type with no vendor | a required field with an empty picker, and a submit that always refuses | the type could not have been saved that way |
| whoever raises a stock document of a misconfigured type | `500 Internal server error`, naming nothing | cannot happen |
| whoever reads the books after such an approval | an approved expense recorded nowhere, with a terminal skip in the posting log | the type must have a source for the charge |
| whoever configures a document type | may save any of these three and hear nothing | told at the moment of saving, naming the flag that is missing |
| whoever debugs it later | a 500 with a stack trace, or silence | the case does not arise |

## What This Change Does NOT Do

- **Does not change any runtime behaviour.** The warehouse gate, the payee check, the accrual and
  its terminal skip all behave exactly as they do now. What changes is which configurations can
  reach them.
- **Does not make `ValidationError` answer 400 instead of 500.** The stock case exposed that escape
  and it is worth fixing, but it is fault handling rather than configuration, and closing this
  configuration hole removes only one of its causes. Two instances are known — this one and
  `PUT /documents/:id/lines` without `lineAmount`.
- **Does not require an accruing type to prove its chain reaches a reserving ancestor.** A vendor
  type with no reference pairing would also find nothing, but that is reachability over the pairing
  graph and depends on configuration this rule cannot see from one row. Only the case decidable
  from the type's own flags — neither budget nor vendor — is refused here.
- **Does not retro-validate stored types.** The rules bind on write; a type nobody edits is never
  re-examined. `XFER_NOWH` on the test database, created to prove the stock case, is one such type
  and is left as it is.
- **Does not touch `document_type_ref`.** `auto_create` on a predecessor that never creates
  successors, and `successor_department` without `auto_create`, are the same class in a different
  table and are the next change.
