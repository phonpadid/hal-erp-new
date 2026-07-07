## 1. Fix the attachment-list bug (app code)

- [x] 1.1 `AttachmentService.list` queries through `this.scope.forActiveCompany()` so the auto-joined `Document` company filter binds its `companyId` (isolation still enforced by `requireDocument`).
- [x] 1.2 Confirm `document-engine-gaps.spec`'s attachment test ("registers attachment metadata and lists it, scoped to the active company") passes.

## 2. Fix the test-setup bugs

- [x] 2.1 `employee.spec.ts`: give the expired membership a **second, distinct role in company A** (a fresh `Role`) so it no longer collides on `user_company_role (user, company, role)`; confirm the active/expired-resolution, salary-masking, and resignation-scope assertions still hold.
- [x] 2.2 `document-list-query.spec.ts`: replace the `> MAX_SAFE_INTEGER` value (`9007199254740993.01`) with the largest decimal that fits `decimal(15,2)` (e.g. `9999999999999.99`) and adjust the range bounds/assertions so the "decimal-string amount filter" test passes within the canonical precision.
- [x] 2.3 `document-engine-gaps.spec.ts`: replace `findOneOrFail(Workflow, {}, FILTER_OFF)` with a concrete lookup (by company, or `find(..., { limit: 1 })[0]`).
- [x] 2.4 `document-engine.service.spec.ts`: rewrite the reference-chain test to use a permitted `REF_CHAIN` pairing with an APPROVED predecessor, keeping the refDocument and form-template-version assertions.

## 3. DB probe robustness (minor)

- [x] 3.1 `src/test/test-orm.ts` `dbAvailable()` uses a bounded retry + longer timeout (robustness against cold-start latency).

## 4. Verification

- [x] 4.1 Run each previously-failing file in isolation — `employee.spec`, `document-list-query.spec`, `document-engine.service.spec`, `document-engine-gaps.spec` — and confirm all pass.
- [x] 4.2 Run the touched modules together and confirm green (any remaining failures must be unrelated cross-file parallel-schema collisions, explicitly noted, not the issues addressed here).
