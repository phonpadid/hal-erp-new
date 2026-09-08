## 0. Decisions before the chain is configured

- [ ] 0.1 FINANCE — shape A, B or C (design.md): does money fronted for somebody else charge the
      claim budget, and is the recovery raised automatically or by hand
- [ ] 0.2 FINANCE — if A, the GL account fronted money sits in, so what branches owe is answerable
      from the ledger even though no recovery workflow exists
- [ ] 0.3 Who approves a recovery, and what their approval means — "yes, this is owed"
- [ ] 0.4 How a transport line is identified on the form: route + trip as two text fields, or a list
- [ ] 0.5 Confirm with the claim owner which field names the two forms share, so inheritance carries
      what they expect (`claimRef`, `trackingNo`, the liable-party fields)

## 1. Successor field inheritance

- [x] 1.1 In `createFrom`, read the predecessor's `doc_field_value` rows with their `form_field` names
- [x] 1.2 Resolve the successor's published form and write a value for each field whose `field_name`
      matches, skipping names the successor's form does not declare
- [x] 1.3 Refuse to write a value the successor's own field definition would reject — a dropdown value
      outside its `options_json` above all — leaving the field empty instead
- [x] 1.4 Keep the creation free of holds: no `budget_txn`, no `quota_usage`, no approval row
- [x] 1.5 Spec tests (DB-backed, `DB_NAME=erp_test`): a shared field carried, a field only the
      predecessor declares dropped, a narrowed dropdown left empty, an empty predecessor field left
      empty, and no ledger rows written
- [x] 1.6 Check the existing chains that now inherit — PR→PO and advance→clearing — and note the
      behaviour change in the release note

## 2. Configure the claim recovery chain (per company, through doc-config)

- [ ] 2.1 Create the advance claim type with the flags decided in 0.1, and its form: the claim's own
      fields plus the liable party (kind + reference, and the transport line's route/trip per 0.4)
- [ ] 2.2 Create the recovery type — no budget, no post-action — and its form, declaring the liable
      party field names so inheritance fills them
- [ ] 2.3 Create the `document_type_ref` pairing between them, with `auto_create` per 0.1 and the
      department the recovery should land in
- [ ] 2.4 Map both types to the claim-intake department and publish their forms
- [ ] 2.5 Attach the workflow the recovery routes through, per 0.3
- [ ] 2.6 Walk it once in a test company: approve an advance claim, watch the outbox raise the
      recovery, and confirm the recovery opens with the party already on it

## 3. Contract

- [ ] 3.1 `docs/claim-integration.md`: two document types, how the caller chooses, and the fields that
      name the liable party
- [ ] 3.2 Say plainly that the recovery is ours: not returned by any read, not reported back, and not
      something the caller waits for
- [ ] 3.3 State the budget behaviour of each type, since it is what the caller's own budget refusals
      will read like
