# web-settlement

## REMOVED Requirements

### Requirement: Unsettled Settlements Queue

**Reason**: there is one queue now, and it is Ready-to-Pay. This one listed documents by their type's
`accrues_on_approval` flag, which also matched the seeded disbursement — so it showed documents whose
only possible action there could not succeed. Replaced by *Ready-to-Pay List*, which lists every
obligation the ledger says is owed.

### Requirement: Record a Settlement With Evidence

**Reason**: recording a settlement is recording a payment. The evidence it required is required of
every hand-recorded payment now, by *Evidence Is Required Where No Bank File Exists*, and the form
that collects it is the payment form.

### Requirement: Read a Document's Settled State

**Reason**: a document's settled state is its payment, read where every payment is read.

### Requirement: Settlement Is Distinct From Ready-to-Pay

**Reason**: it existed to keep two surfaces from being confused with each other. One of them is gone,
so there is nothing left to distinguish — and a screen a user had to choose correctly before acting
is the confusion this capability was written to manage rather than remove.
