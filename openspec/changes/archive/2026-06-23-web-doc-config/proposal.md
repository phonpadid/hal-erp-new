## Why

Everything the app does is driven by configuration — `document_type` flags decide whether a doc
reserves budget/quota and what its post-action is, `form_template`/`form_field` define the form,
`dept_doc_type` maps a department to a type's form + workflow, and `workflow`/`workflow_step`
define routing (invariant 7, configuration over code). But today that config only exists via the
seed: there's no UI to define a new document type, build its form, map it to a department, or set
up its approval workflow. This change adds the configuration admin so an admin can stand up a new
document end to end without code or re-seeding — the keystone that makes the platform
self-serviceable.

The write endpoints largely exist (`DOC_CONFIG_MANAGE` for types/forms/mappings,
`WORKFLOW_MANAGE` for workflows/steps), but the config backends are mostly write-only — they lack
the reads a UI needs (list a type's form templates, list department mappings, list workflows with
their steps). So this change adds those reads, then builds the screens.

## What Changes

- **New capability `web-doc-config`** — the configuration admin in the Vue shell, a tabbed area:
  Document Types · Forms · Mappings · Workflows.
- **Backend (document-engine delta)** — `DOC_CONFIG_MANAGE` reads:
  - `GET /document-config/form-templates?documentTypeId=` → a type's templates (version, status,
    field count).
  - `GET /document-config/dept-doc-types` → the active company's mappings (department, document
    type, template version, workflow).
  - (`GET /document-config/document-types` and `…/form-templates/:id/fields` already exist.)
- **Backend (approval-workflow delta)** — `WORKFLOW_MANAGE` read:
  - `GET /workflows` → the active company's workflows, each with its steps (step no, approver
    role/user, amount range, mode, SLA).
- **Document Types** (`DOC_CONFIG_MANAGE`): list, create (category + `requires_budget` /
  `requires_quota` / `post_action`), and edit (incl. activate/deactivate).
- **Forms** (`DOC_CONFIG_MANAGE`): per document type, create a form template (auto-versioned),
  add fields (name, label, type, required, order, options), and publish a template.
- **Mappings** (`DOC_CONFIG_MANAGE`): map a department to a (document type → published template +
  workflow) so that department can create that document.
- **Workflows** (`WORKFLOW_MANAGE`): list/create workflows and add steps (approver role or user,
  amount range, sequential/parallel mode, SLA hours).
- **Shell integration**: a "Configuration" nav entry (gated by `DOC_CONFIG_MANAGE`); a typed
  `api/docConfig.ts` + a Pinia store; all create/edit forms use `@primevue/forms` + `zodResolver`
  with schemas shared in `@erp/shared`.
- **Tests**: backend tests for the new reads; frontend unit tests for the doc-config store and the
  shared schemas.

## Capabilities

### New Capabilities
- `web-doc-config`: the Vue configuration admin — manage document types, form templates/fields,
  department mappings, and approval workflows, permission-gated and company-scoped.

### Modified Capabilities
- `document-engine`: adds config **read** endpoints (a type's form templates; the company's
  department mappings) so the configuration UI can be driven without `populate` guesswork.
- `approval-workflow`: adds a workflow **read** endpoint (workflows with their steps) for the
  configuration UI.

## Impact

- **Affected**: `front-end/` (tabbed config view, store, api, router/nav), `back/src/modules/
  document/` + `back/src/modules/approval/` (read endpoints), and `shared/` (Zod schemas), with
  tests.
- **Invariants reflected**: 7 (this is the UI that makes document behavior configuration, not
  code); 5 (types/forms/mappings gated by `DOC_CONFIG_MANAGE`, workflows by `WORKFLOW_MANAGE`;
  server enforces); 1 (roles, mappings, workflows scoped to the active company; document-type and
  permission catalogs are global); validation parity (shared Zod).
- **Consumes**: existing config writes + the new reads; the workflow-step approver-role picker
  reuses `GET /rbac/roles` (admin holds `RBAC_MANAGE`).
- **No schema change**; no new dependency.

## Out of Scope

- Approval **delegation** management — `web-approval-config` (delegation is a separate concern).
- A visual drag-and-drop form builder or workflow diagram — fields/steps are edited as ordered
  lists this slice.
- Editing a **published** template's fields in place — publishing is immutable; changes go to a
  new template version (matches the backend's auto-versioning).
- Conditional-field / conditional-routing rule editors (`conditionJson`) beyond storing a raw
  value — a later enhancement.
