## 1. Data model & migration

- [x] 1.1 Add the `account` table to `erp_approval_system.dbml`: `id`, `company_id`, `code`, `name`, `account_type` enum (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE), `parent_id` (self-FK, nullable), `is_postable` (default true), `is_active` (default true), with unique `(company_id, code)` and an index on `(company_id, parent_id)`.
- [x] 1.2 Add a nullable `account_id` FK column to `budget` in the DBML (referencing `account.id`), keeping the existing `gl_account` string column.
- [x] 1.3 Create the MikroORM `Account` entity (company relation, self-referencing parent, enum type) plus the `account_type` enum in `back/src/common/enums`.
- [x] 1.4 Add the `account` relation to the `Budget` entity (nullable ManyToOne) without removing the existing string property.
- [x] 1.5 Generate the migration: create `account`, add `account_id` to `budget`, add constraints/indexes. Run and verify it applies cleanly.

## 2. Permission codes

- [x] 2.1 Add `COA_VIEW` and `COA_MANAGE` permission codes (backend permission registry + `shared` if codes are shared) and grant them to the admin role in the seed.

## 3. Backend: account module

- [x] 3.1 Scaffold a `chart-of-accounts` (accounting) NestJS module: entity wiring, service, controller, DTOs.
- [x] 3.2 Implement `AccountService.resolvePostable(companyId, codeOrId)` — returns the account or throws a 400 when missing/inactive/non-postable/other-company. This is the shared resolver other modules call.
- [x] 3.3 Implement create/update in `AccountService` with company scope, `(company_id, code)` uniqueness, and hierarchy integrity: parent must be same company and same `account_type`, and cycles are rejected.
- [x] 3.4 Implement list/detail reads, company-scoped, returning only the active company's accounts.
- [x] 3.5 Implement deactivation (set `is_active = false`; never hard-delete).
- [x] 3.6 Add the controller endpoints with `COA_VIEW` / `COA_MANAGE` guards and `ParseUUIDPipe` on id params; add class-validator DTOs.

## 4. Backend: wire resolver into budget

- [x] 4.1 In budget-create, call `resolvePostable` for the `gl_account`; on success set both `gl_account` (code) and `account_id`; reject with a 400 naming the code when it does not resolve. (No `budget_txn` write is involved; keep the existing create transaction boundary — this adds only a read before insert.)

## 5. Seed & backfill

- [x] 5.1 Seed a minimal standard chart per company (including the existing `5000` expense account) with correct types and postable flags.
- [x] 5.2 Data migration/backfill: for each distinct existing `budget.gl_account`, set `account_id` from the seeded account matching the code within the same company; leave unmatched values null and log them for manual mapping.

## 6. Frontend

- [x] 6.1 Add a Chart of Accounts admin view (list + create/edit dialog) gated by `COA_VIEW` / `COA_MANAGE`, with a typed API client and Pinia wiring; account-type and parent are selectable, `is_postable` / `is_active` toggles.
- [x] 6.2 Add a shared Zod schema for the account form (mirroring the backend DTO) using `zodResolver` and `@primevue/forms`.
- [x] 6.3 Replace the free-text GL input on the budget form with a Select populated from active, postable accounts of the active company; show a field error when none is chosen.
- [x] 6.4 Add i18n keys (en + la) for the account admin view, account types, and the new GL Select labels/errors.

## 7. Tests

- [x] 7.1 Unit: `resolvePostable` returns the account for active+postable, and rejects missing / inactive / non-postable / other-company codes.
- [x] 7.2 Unit: account create/update enforces `(company_id, code)` uniqueness, same-company+same-type parent, and cycle rejection.
- [x] 7.3 Unit: company isolation — listing accounts returns only the active company's rows; company A cannot read or parent to company B's accounts.
- [x] 7.4 Unit: budget-create rejects an unresolved GL code and, on success, persists both the code and the resolved `account_id`.
- [x] 7.5 Unit: authorization — account endpoints reject requests lacking `COA_VIEW` / `COA_MANAGE` with 403 before the handler runs.
- [x] 7.6 Migration/backfill test: seeded chart maps the existing `5000` budgets to `account_id`; unmatched codes stay null and are reported.
- [x] 7.7 Frontend: account form validation and the GL Select on the budget form (offers only active postable accounts).
