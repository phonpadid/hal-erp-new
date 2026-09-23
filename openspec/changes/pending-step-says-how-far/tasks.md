## 1. The read

- [x] 1.1 In `approval.controller.ts`, `await this.documents.assertVisible(id)` before `pendingApprovers`, as the `matching` route already does — inject `DocumentService` (exported by `DocumentEngineModule`, already used in this module by `pending-summary.service.ts`)
- [x] 1.2 In `approval-routing.service.ts`, delete the participant gate and the loop that resolved eligible actors for EVERY step to compute it; resolve the current step's actors alone
- [x] 1.3 Add `totalSteps` to `PendingStep`, from the `steps` array already loaded — the LIVE recorded route, since `routeSteps` filters `supersededAt: null`
- [x] 1.4 Add `totalSteps` to the frontend `PendingStep` type

## 2. The label

- [x] 2.1 `documents.detail.pending.stepOf` / `stepNamedOf` in `en`, `la` and `zh` — ລາວ reads `ຂັ້ນທີ {no} ຈາກ {total}`
- [x] 2.2 `DocumentDetailView.vue` uses them, falling back to the bare step when no total came back

## 3. Tests

- [x] 3.1 Turn `pending-approvers.spec.ts` "rejects a non-participant DOC_VIEW user as not found" into its opposite, and add that seeing the step grants no authority to act
- [x] 3.2 A controller test that a caller who may not read the document is refused BEFORE the read runs
- [x] 3.3 `totalSteps` is the recorded route's count, and a route missing a configured step counts fewer
- [x] 3.4 A frontend test for the position, the named-step form, and the no-total fallback
- [x] 3.5 Every other pending-approvers case stays green

## 4. Verification

- [ ] 4.1 Backend and frontend suites green
- [ ] 4.2 Re-run the live check that found it: as `Poupay`, `PO-HAL-2026-0001` (raised by Jiji) returns the step and its approvers, and `can-act` still answers false

## 5. Owed, agreed to follow later

- [ ] 5.1 A DB-backed test with TWO companies: a reader in company A asking for a company B document id is refused. The rule is enforced (`assertVisible` runs on a company-scoped em and `Document` is a `CompanyScopedEntity`), and was verified by hand as far as this database allows — but it holds only ONE company, so the cross-company path has no test standing over it. Agreed with the user to add this separately rather than hold the fix.
