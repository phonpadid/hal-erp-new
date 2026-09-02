# document-engine

## REMOVED Requirements

### Requirement: A Document Accrued At Approval Is Settled Once, With Evidence

**Reason**: it described a second way to pay, for documents owed to a person rather than a vendor.
There is one way now. Everything it required — one clearing per document, evidence, immutability, a
finance permission, no API key, the ledger effect written with the record — is required of a payment
in `payment-handoff` and `payment-slip`, and the ledger path it used was already generic: the payment
posting clears whatever account the accrual credited, `CLAIM_PAYABLE` included. Replaced by *Record
Payment and FX Gain/Loss* and *Evidence Is Required Where No Bank File Exists*.

### Requirement: A Settled Document Can Be Read Back As Settled

**Reason**: a document's settled state is now its payment, read where every other payment is read.
A second read answering the same question from a table that no longer exists has nothing to return.
