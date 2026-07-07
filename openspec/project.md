# Multi-Company ERP — Document Approval, Budget Control & Quota

## What this system is
A configuration-driven e-Approval platform for a group of companies. Users log in
once and switch company context; each company defines its own departments, roles,
document types, forms, and approval workflows. Documents may consume budget and/or
quota, route through configurable approval chains, and trigger post-approval actions
(create PO, cut budget, update employee records, etc.). Multi-currency is supported
for overseas subsidiaries.

## Capabilities (source-of-truth specs live in openspec/specs/<capability>/spec.md)
1. multi-company      — companies, departments, fiscal years, holiday calendars
2. rbac               — single login, per-company roles, permission codes, scopes
3. budget-control     — budgets, append-only transactions, transfer & adjust
4. quota-management   — company/department/personal quotas, entitlements, usage
5. document-engine    — document types, form builder, lines, attachments, numbering
6. approval-workflow  — workflows, steps, delegation, SLA/escalation, audit log
7. multi-currency     — currencies, exchange rates, locked rates on documents
8. master-data        — vendors, items, per-company enablement
9. notifications      — templates and multi-channel delivery

## Canonical data model
`erp_approval_system.dbml` (37 tables) is the authoritative schema. Import it into
dbdiagram.io to view. Generate migrations to match it; do not invent new tables
without a change proposal.

## Tech stack
Backend: NestJS + PostgreSQL + MikroORM (REST/JSON, JWT). Frontend: Vue 3 + PrimeVue 4
+ PrimeIcons + Tailwind/tailwindcss-primeui + @primevue/forms + Zod + Pinia. Full
details and conventions live in `openspec/config.yaml` and `CLAUDE.md`.

## How to build this with OpenSpec + Claude Code
1. Place the `openspec/` folder at the repo root and add `erp_approval_system.dbml`.
2. Review/adjust the tech stack in `openspec/config.yaml`.
3. The `specs/` folder is already populated as the source of truth. To implement a
   slice, create a change and let Claude Code generate tasks, e.g.:
   `/opsx:propose implement budget-control reserve-and-release`
4. Review proposal/design/tasks, then `/opsx:apply` to implement task-by-task.
5. Recommended build order: multi-company → rbac → master-data → multi-currency →
   budget-control → quota-management → document-engine → approval-workflow →
   notifications.

## Phase 1 (MVP) suggestion
Implement 4–5 document types covering all four behaviors (budget-only, quota-only,
both, neither): Purchase Requisition, Expense Claim, Leave Request, Resignation,
Internal Memo. Everything else becomes configuration, not new code.
