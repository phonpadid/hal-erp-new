## 1. Data model & migration

- [x] 1.1 Add the `api_key` table to `erp_approval_system.dbml` (company_id, user_id, name, prefix, secret_hash, created_by, expires_at, revoked_at, last_used_at, created_at + indexes on prefix, (company_id, revoked_at), user_id)
- [x] 1.2 Create the MikroORM `ApiKey` entity mirroring the DBML, with the `company` scope filter consistent with other company-scoped entities
- [x] 1.3 Generate and check in the migration creating `api_key` (table + unique prefix + indexes)

## 2. RBAC permission

- [x] 2.1 Add the `API_KEY_MANAGE` permission row to the permission master seeder (idempotent), module RBAC/MASTER
- [x] 2.2 Grant `API_KEY_MANAGE` to admin roles in the seed/fixtures

## 3. Key issuance & custody

- [x] 3.1 Implement secret generation: `<prefix>.<random>` with ≥32 bytes CSPRNG entropy; unique prefix with retry on collision
- [x] 3.2 Implement `secret_hash` computation (SHA-256) and a constant-time verify helper
- [x] 3.3 Implement `ApiKeyService.issue()`: validate target user is a member (`UserCompanyRole`) of the active company, persist the row, return the raw secret exactly once
- [x] 3.4 Implement `list()`, `revoke()` (set `revoked_at`, company-scoped), and a best-effort `touchLastUsed()` that never enlists in the request transaction

## 4. Authentication guard

- [x] 4.1 Implement `ApiKeyGuard` (CanActivate): parse `Authorization: Api-Key <prefix>.<secret>` (fallback `X-Api-Key`), look up by prefix, constant-time verify, reject revoked/expired
- [x] 4.2 Resolve the principal via `PermissionResolverService.resolve(userId, companyId)` and attach the identical `AuthUser` shape plus `authSource: 'api-key'` and `apiKeyId`
- [x] 4.3 Add a composed `JwtOrApiKeyGuard` so endpoints accept either source without changing their permission decorators
- [x] 4.4 Fire best-effort `touchLastUsed()` after successful auth, out of band

## 5. Operation cap (no approve via key)

- [x] 5.1 Implement a channel deny-guard that rejects requests with `authSource === 'api-key'` on approval-class routes (approve/reject/delegate), returning 403 regardless of grants
- [x] 5.2 Apply the deny-guard at the approval-workflow controller/route-group boundary
- [x] 5.3 Ensure key-originated writes attribute the bound user (`created_by`, `approval_log` actor) while recording `apiKeyId`/`authSource`

## 6. Management endpoints

- [x] 6.1 `POST /api-keys` (issue) — guarded by `API_KEY_MANAGE`, company-scoped, returns raw secret once
- [x] 6.2 `GET /api-keys` (list) — guarded by `API_KEY_MANAGE`, returns non-secret metadata only (name, prefix, bound user, status, expires_at, last_used_at)
- [x] 6.3 `DELETE /api-keys/:id` (revoke) — guarded by `API_KEY_MANAGE`, company-scoped, ParseUUIDPipe
- [x] 6.4 class-validator DTOs for issue (name, targetUserId, optional expiresAt)

## 7. Backend tests

- [x] 7.1 Issue → authenticate → resolves to bound user's live grants; company isolation holds
- [x] 7.2 Invalid/revoked/expired secret is rejected with 401
- [x] 7.3 Key create/submit succeeds with the bound user's permission code
- [x] 7.4 Key is denied approve/reject/delegate with 403 even when the bound user holds the approval code
- [x] 7.5 Management endpoints enforce `API_KEY_MANAGE` and cross-company revoke/issue is rejected
- [x] 7.6 Concurrency/uniqueness test: concurrent issuance never yields duplicate prefixes

## 8. Frontend (admin key management)

- [x] 8.1 Keys list view (PrimeVue DataTable) showing prefix, bound user, status, expiry, last-used — gated by `API_KEY_MANAGE` from the active-company Pinia context
- [x] 8.2 Issue-key dialog (`@primevue/forms` + Zod, mirroring the backend DTO) that reveals the raw secret once with a copy affordance and a "won't be shown again" warning
- [x] 8.3 Revoke action with confirmation; reflect status changes in the list

## 9. Docs

- [x] 9.1 External API authentication guide: how to present the key, the read+create/submit scope, the no-approve rule, and revocation
