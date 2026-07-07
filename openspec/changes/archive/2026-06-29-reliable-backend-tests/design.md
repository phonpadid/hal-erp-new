## Context

Running each failing file alone reveals the true causes (the DB probe is fine — it connects in ~5 ms;
the "skips" are `beforeAll`/insert failures surfacing as a failed suite):

- `AttachmentService.list` calls `this.em.find(DocumentAttachment, { document }, …)` on the **root**
  EntityManager. `DocumentAttachment.document → Document` is company-scoped, so MikroORM auto-joins
  `Document` to apply the default `company` filter — but the root em has no `companyId` filter param,
  so it throws "No arguments provided for filter 'company'". A real bug: the endpoint 500s in prod.
- `employee.spec`'s setup creates `target` with `(companyA, adminRoleA)` **twice** — once active, once
  `validTo` in the past — violating `user_company_role`'s `@Unique(['user','company','role'])` (the
  DBML's `(user_id, company_id, role_id)` unique).
- `document-list-query.spec` inserts `base_total_amount = '9007199254740993.01'` to test "beyond
  MAX_SAFE_INTEGER", but `base_total_amount` is `decimal(15,2)` (max ~9.99e12) → numeric overflow. You
  cannot have a value both `> MAX_SAFE_INTEGER` (≈9.0e15) and `≤ decimal(15,2)`, so the test premise is
  impossible against the canonical column.
- `document-engine-gaps.spec` uses `findOneOrFail(Workflow, {}, FILTER_OFF)`; MikroORM 6 rejects empty
  `where` on `findOneOrFail`.
- `document-engine.service.spec`'s ref-chain test references a DRAFT `MEMO` from another `MEMO`;
  `assertPredecessor` requires an APPROVED/COMPLETED predecessor and a permitted `REF_CHAIN` pairing.

## Goals / Non-Goals

**Goals:** fix the attachment app bug; bring the four test files into line with the canonical
constraints; keep a robust DB probe; the previously-failing files pass deterministically.

**Non-Goals:** no schema change (the DBML constraints are correct); no per-file test DB / parallel
isolation; no behaviour change beyond the attachment-list fix.

## Decisions

**1. Attachment list via the active-company scope.** Query through `this.scope.forActiveCompany()`
(already injected) so the auto-joined `Document` company filter has its `companyId` bound;
`requireDocument` already asserts active-company ownership, so isolation holds. Chosen over disabling
the filter, which would silently drop isolation.

**2. Fix tests to the canonical schema, not vice-versa.**
- `employee.spec`: the expired membership uses a **second, distinct role in company A** (e.g. a fresh
  `Role`), so it's a real expired `user_company_role` row that the "drops expired" assertions still
  exercise, without colliding on `(user, company, role)`.
- `document-list-query.spec`: replace the overflow value with the **largest decimal that fits
  `decimal(15,2)`** that still exercises "decimal string, not a JS number" (e.g. `9999999999999.99`),
  and adjust the range bounds/assertions accordingly. The test keeps its point (string-based amount
  filtering) within the column's real precision.
- `document-engine-gaps.spec`: replace `findOneOrFail(Workflow, {}, …)` with a concrete lookup
  (by company, or `find(..., { limit: 1 })[0]`).
- `document-engine.service.spec`: use a permitted pairing with an APPROVED predecessor (seed/lookup a
  predecessor type that is a valid `REF_CHAIN` predecessor of the successor, set it APPROVED), keeping
  the refDocument and form-template-version assertions.

**3. Keep the probe hardening.** A bounded retry + longer timeout in `dbAvailable()` is a low-risk
robustness improvement against cold-start latency; harmless even though it wasn't the cause.

## Risks / Trade-offs

- [Changing the `document-list-query` value weakens the "big number" intent] → It still uses a value
  far beyond typical magnitudes and exercises exact decimal-string comparison; the column simply can't
  hold > MAX_SAFE_INTEGER, so the original premise was untestable against the canonical schema.
- [employee.spec second-role change alters assertions] → Verify each `employee.spec` test still asserts
  what it intends (active vs expired resolution, salary masking, resignation scope) after the role
  split.
- [Attachment scope change affects other callers] → Only `list` had the unbound-filter path;
  `register`/`presign` already fork/scope. Localized, covered by the now-passing attachment test.

## Migration Plan

No schema or data migration — code + test fixes only. Verify by running each previously-failing file
in isolation (green) and the touched modules together.

## Open Questions

- None blocking. If the full parallel suite still shows cross-file schema collisions after these fixes,
  that is separate test-isolation work, explicitly out of scope.
