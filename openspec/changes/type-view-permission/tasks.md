## 1. Schema and entity

- [x] 1.1 `erp_approval_system.dbml` — add `view_permission_code varchar [note: ...]` to
      `document_type` (nullable; note the soft code-ref rule and the "empty = null" rule)
- [x] 1.2 Migration `Migration20260916000000.ts`: `alter table "document_type" add column
      "view_permission_code" varchar null` (+ down)
- [x] 1.3 `DocumentType` entity: `viewPermissionCode?: string` with a comment explaining why it is
      a code and not a FK, and that it narrows reads only
      (`back/src/modules/document/document.entities.ts`)

## 2. Type configuration

- [x] 2.1 `shared/src/index.ts` document-type schema: `viewPermissionCode: z.string().max(64)
      .nullable().optional()` (mirrors `authoringRoute`)
- [x] 2.2 `dto/config.dto.ts` create + update DTOs: `viewPermissionCode?: string | null` with
      class-validator decorators matching the Zod schema
- [x] 2.3 `DocumentTypeService`: `requireViewPermissionCode(code)` — active `permission` row by
      `code`, else `BadRequestException` naming it; normalise `''` → null; apply on create and
      update; include the field in reads (`back/src/modules/document/document-type.service.ts`)
- [x] 2.4 `GET /document-config/permission-codes` under `DOC_CONFIG_MANAGE` → active
      `[{ code, name, module }]` ordered by module, code
      (`back/src/modules/document/document-config.controller.ts` + a service method)
- [x] 2.5 Tests in `back/src/modules/document/doc-config-read.spec.ts` (or a new
      `doc-type-view-gate.spec.ts`): default null on existing types; unknown/inactive code
      rejected naming it; empty string stored as null; permission-codes read returns active rows
      only and is guarded by `DOC_CONFIG_MANAGE`

## 3. Visibility predicate

- [x] 3.1 `DocumentService.visibleWhere`: load gated types of the active company on the same em
      (`viewPermissionCode: { $ne: null }`, fields `id`,`viewPermissionCode`); compute
      `gatedTypeIds` = those whose code is not in `RequestContext.grants()` codes; when non-empty,
      AND `{ $or: [{ documentType: { $nin: gatedTypeIds } }, { createdBy: userId }] }` onto the
      scope half BEFORE the party OR; COMPANY/GROUP `{}` short-circuit only when the set is empty
      (`back/src/modules/document/document.service.ts`)
- [x] 3.2 Extend `back/src/modules/document/document-visibility.spec.ts` with a gated type:
      DEPARTMENT reader without the code — gated doc hidden from list and not-found by id /
      `assertVisible`, ungated docs still listed; reader with the code at OWN scope sees the gated
      docs of their department only; creator without the code still sees their own; recorded step
      actor without the code sees it and reads detail; COMPANY reader without the code is gated;
      no gate → predicate unchanged
- [x] 3.3 Assert in the same file that the approval inbox and the approve action are not affected
      by the gate (reuse the existing inbox/approve tests with a gated type)

## 4. Frontend

- [x] 4.1 `front-end/src/api/docConfig.ts`: `viewPermissionCode?: string | null` on the type
      views/inputs; `listPermissionCodes()` for the new read
- [x] 4.2 `DocTypeFormFields.vue`: a `Select` (showClear) of permission codes labelled
      "`code` — name", bound to `viewPermissionCode`; hint text explaining creators and approvers
      always keep access; `DocTypeFormView.vue` initial value + `'' → null` on submit
- [x] 4.3 i18n `en` / `la` / `zh` `admin.docConfig.fields.viewPermissionCode` + `…Hint`
- [x] 4.4 Type list/detail shows the gate (code) when set
- [x] 4.5 Component/store spec for the form field (existing doc-config spec file)

## 5. Verify

- [x] 5.1 `pnpm --filter back test`, `pnpm --filter front-end test` green; `tsc` clean on both
- [x] 5.2 Dev stack: run the migration on the dev DB (`pnpm --filter back migration:up` — say so
      first, it holds real data), set `BUDGET_PLAN → BUDGET_VIEW` in the admin form as admin, then
      as Poupay (DEPARTMENT, no `BUDGET_VIEW`) confirm `GET /documents` lists 24 documents and no
      `BUDGET_PLAN`, and a `BUDGET_PLAN` id answers 404; as LATTANAPHONE (holds the code) confirm
      the plans are still listed
