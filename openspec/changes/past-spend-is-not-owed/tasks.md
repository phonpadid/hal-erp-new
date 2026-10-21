## 1. Predicate

- [x] 1.1 `owedDocuments`: the CUT_BUDGET clause requires `!documentType.recordsPastEvents`; the accrual clause is unchanged
- [x] 1.2 Update the predicate's doc comment

## 2. Tests

- [x] 2.1 A completed CUT_BUDGET document of a past-event type is not in the ready-to-pay queue
- [x] 2.2 Recording a payment on it is refused as "not something the company owes"
- [x] 2.3 A past-event type whose document accrued a payable is still listed

## 3. Verify

- [ ] 3.1 Build shared/back/front; full backend and frontend suites green
- [ ] 3.2 Archive into `openspec/specs/payment-handoff/spec.md` after deploy
