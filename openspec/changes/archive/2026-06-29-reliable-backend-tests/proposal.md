## Why

Four DB-backed spec files report as failing, and the cause is **not** a flaky DB probe (the socket
probe connects in ~5 ms reliably) — their `beforeAll`/inserts throw, so the tests show as "skipped"
under a failed suite. The real causes are five test-setup bugs plus one genuine application bug:

- **`AttachmentService.list` (app bug):** it queries with the root EntityManager, so the company
  filter auto-joined from the (company-scoped) `Document` relation has no bound `companyId` and throws
  "No arguments provided for filter 'company'" — the attachment-list endpoint **500s in production**,
  not just in tests.
- **`employee.spec` (test bug):** its setup gives the same user the **same role in the same company
  twice** (one active, one expired) — violating the canonical `user_company_role (user, company,
  role)` unique.
- **`document-list-query.spec` (test bug):** it inserts `base_total_amount = 9007199254740993.01`,
  which **overflows the canonical `decimal(15,2)`** column (its "beyond MAX_SAFE_INTEGER" value can't
  fit a 15-digit decimal).
- **`document-engine-gaps.spec` (test bug):** `findOneOrFail(Workflow, {}, …)` — MikroORM 6 rejects an
  empty `where`.
- **`document-engine.service.spec` (test bug):** its reference-chain test uses a `MEMO→MEMO` pairing
  (which `REF_CHAIN` rejects) and a DRAFT predecessor (which `assertPredecessor` rejects).

The DBML confirms both the `(user, company, role)` unique and the `decimal(15,2)` precision are
intended, so the tests — not the schema — are wrong. Net: the suite can't be trusted green, and a real
attachment 500 hides behind the noise.

## What Changes

- **Fix the attachment-list bug (app code).** `AttachmentService.list` SHALL query through the
  active-company scope so the company filter binds its parameter (isolation stays enforced by the
  existing `requireDocument` check). Fixes the failing test **and** the production 500.
- **Fix the test-setup bugs** to respect the canonical constraints: a distinct role for the expired
  membership; a `decimal(15,2)`-fitting "large decimal string" value; a valid `Workflow` lookup; a
  permitted `REF_CHAIN` pairing with an APPROVED predecessor.
- **Harden the DB probe (minor robustness).** Keep a bounded-retry / longer-timeout `dbAvailable()` so
  a cold process never spuriously skips — a real improvement, though it was not the cause here.
- **Result:** the previously-failing files run deterministically and pass.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `platform-foundation`: backend test tooling — DB-backed specs SHALL probe availability robustly and
  set up fixtures consistent with the canonical schema constraints (unique keys, column precision) so
  the suite runs deterministically and passes.

## Impact

- **Backend (app fix):** `AttachmentService.list` → query via `CompanyScopeService.forActiveCompany()`.
- **Backend (test infra):** `src/test/test-orm.ts` `dbAvailable()` — bounded retry + longer timeout.
- **Tests:** `employee.spec.ts` (distinct role for the expired membership), `document-list-query.spec.ts`
  (decimal value within `decimal(15,2)`), `document-engine-gaps.spec.ts` (valid workflow lookup),
  `document-engine.service.spec.ts` (permitted pairing + APPROVED predecessor).
- **Invariants:** unchanged — company isolation preserved (attachment list still gated to the active
  company); no schema, money, or API-contract change. Test fixtures are brought into line with the
  canonical DBML, not the reverse.

## Out of Scope

- Broader test-isolation work (per-file databases, parallel-safe schema). Cross-file schema collisions
  under full parallel runs are a separate concern and are not addressed here.
