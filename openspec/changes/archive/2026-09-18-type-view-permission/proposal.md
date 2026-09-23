## Why

Every member of ພະແນກບໍລິຫານ at DEPARTMENT scope sees 106 `BUDGET_PLAN` documents — the
department's own budget plans, raised by the budget officer and filed under the department they
fund — mixed into the same list as their purchase requests. The read scope only knows *whose*
department a document belongs to, not *what kind* of document it is, so there is no way to say
"budget plans are for people who work with budgets" without either widening the budget officer's
grants or narrowing every requester to OWN and taking away the department view the spec argues
for. The same applies to any type a company would rather keep to its owning function: payroll
journals, HR terminations, service-account API-key requests.

## What Changes

- **document-engine — Configurable Document Type.** `document_type` gains an optional
  `view_permission_code`. When set, a reader SHALL hold that permission code (at any scope) for
  documents of the type to fall inside their default scope-visibility. Null — the default, and the
  value of every existing type — changes nothing. The code MUST be an active row of the
  `permission` catalog, validated as a soft code reference exactly like `category` and
  `default_gl_account` (configuration, not a hard FK).
- **document-engine — Document Reads Are Narrowed To The Reader's Scope.** The scope half of the
  visibility predicate additionally excludes documents whose type carries a gate the reader lacks.
  The gate narrows a default only: it never hides a document the reader created, and it never
  withdraws access the reader has by being party to the document (an approver who holds no
  `BUDGET_VIEW` still opens the budget plan the workflow put in their queue).
- The document-config admin form gets a "who may see this type" picker, fed by a small read of
  active permission codes under `DOC_CONFIG_MANAGE` (the existing catalog read sits under
  `RBAC_MANAGE`, which a document-config administrator need not hold).
- Not changed: creating, submitting, approving. The gate is a read filter, never an action rule
  (the pending-visibility principle). The `mine` filter and every list filter still compose inside
  the predicate.

Not breaking: the column is nullable and defaults to null; no existing type is gated until an
administrator sets one.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `document-engine` — *Configurable Document Type* gains `view_permission_code` and its
  validation; *Document Reads Are Narrowed To The Reader's Scope* gains the type gate.

## Impact

Touches **document-engine** (type config, visibility predicate) and reads the **rbac** permission
catalog without changing it. Budget-control is the first beneficiary (set `BUDGET_PLAN` →
`BUDGET_VIEW`) but nothing in it moves.

Code:
- `erp_approval_system.dbml` `document_type` + migration: `view_permission_code varchar null`.
- `back/src/modules/document/document.entities.ts` `DocumentType`, `dto/config.dto.ts`,
  `document-type.service.ts` (create/update + catalog validation), `shared/src/index.ts` Zod
  schema.
- `back/src/modules/document/document.service.ts` `visibleWhere` — gated-type exclusion on the
  scope half.
- `back/src/modules/document/document-config.controller.ts` — permission-codes read.
- `front-end`: `api/docConfig.ts`, `components/doc-config/DocTypeFormFields.vue`,
  `views/admin/doc-config/DocTypeFormView.vue`, i18n.

Invariants: company isolation (1) untouched — the gate is a predicate inside the company-filtered
em, and the type ids it names are the active company's. Permission codes not role names (5) — the
gate IS a permission code. Configuration over code (7) — which types are gated, and by which code,
is data on `document_type`; no service branches on a type code. Ledgers and budget math not in the
path.

Risk: an administrator who gates a type with a code nobody holds hides it from everyone but its
creators and approvers. Mitigated by the same rule that already exists for scope — party access is
never withdrawn — so the workflow keeps working; and by the admin form showing the code's name.
