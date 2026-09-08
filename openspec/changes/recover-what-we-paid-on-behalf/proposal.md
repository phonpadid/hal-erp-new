## Why

The claim system is changing shape: the company will pay every claimant, always, and then recover
from whoever was at fault — a branch, a transport line — outside any system. What it needs from us is
a second document type whose approval leaves a note behind saying *this one has to be collected*, and
the note has to say **from whom**.

The mechanism exists: a type carrying `CREATE_SUCCESSOR` records its obligation atomically with the
approval and a sweeper raises the successor with `createFrom`. What is missing is the sentence on the
successor. `createFrom` copies the money — currency, total, lines with their budget and tax — and does
not copy `doc_field_value`, so a recovery arrives carrying an amount and nothing that says who owes
it. The claim system will not fill it in: by design it stops when the claimant is paid. The person who
opens the recovery is left clicking through to the predecessor to find out what they are collecting.

There is a second thing this surfaces, and it is not a bug: a type that requires budget **cannot**
carry `CREATE_SUCCESSOR`, because `post_action` is single-valued and only `CUT_BUDGET` settles a
reservation. The configuration guards already refuse the combination. That refusal is the ERP telling
the business something true about money it fronts for other people, and the design faces it rather
than working around it.

## What Changes

- **A successor inherits the field values its own form asks for.** When `createFrom` raises a
  successor, each field on the successor's published form whose `field_name` matches a field on the
  predecessor's form is filled with the predecessor's value. Fields the successor's form does not ask
  for are not carried, and a value that is no longer permitted by the successor's own field
  definition is not written.
- **The claim recovery chain is configured**, not coded: a second claim type for money fronted on
  someone else's behalf, a recovery type, and the `document_type_ref` pairing between them with
  `auto_create` set. Which flags each type carries is the decision this change has to make, and the
  budget guard constrains it — see design.
- **`docs/claim-integration.md` gains the second type**: how an integrator chooses between them, the
  fields that name the liable party, and a statement that the recovery is ours and is never reported
  back to them.

No breaking change. Inheritance fills fields that are empty today; every existing chain (PR→PO,
advance→clearing) gains it and none depended on the fields being blank.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: adds what a successor carries from its predecessor. Today's reference-chain
  requirement speaks about header fields and lines and says nothing about `doc_field_value`; this adds
  that, bounded by the successor's own form.

## Impact

- **Code**: `DocumentService.createFrom` (read the predecessor's field values, write those the
  successor's form declares), and a spec for it.
- **Configuration**: two document types, their forms, the pairing, and the workflow the recovery
  routes through — all through the existing doc-config screens, in each company that files claims.
- **Contract**: `docs/claim-integration.md`.
- **Consumers**: the HAL claim line, whose own change (`pay-every-claim-through-the-erp`) picks the
  type from the party it assessed and then stops looking.
- **Invariants**: untouched. Inheritance writes no `budget_txn`, no `quota_usage`, and no approval
  row; the successor still takes its own holds at its own submit.
