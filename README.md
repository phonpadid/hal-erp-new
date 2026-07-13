# Multi-Company ERP — Approval + Budget + Quota

Configuration-driven e-Approval platform for a group of companies. Specs are the
source of truth in `openspec/specs/<capability>/`; the data model is
`erp_approval_system.dbml` (37 tables). See `CLAUDE.md` for the non-negotiable
invariants and `openspec/config.yaml` for the full stack.

## Repository layout (pnpm workspace)

| Package      | Stack                                              |
| ------------ | -------------------------------------------------- |
| `back/`      | NestJS · MikroORM · PostgreSQL · JWT · Vitest/Playwright |
| `front-end/` | Vue 3 · PrimeVue 4 · Tailwind/primeui · @primevue/forms + Zod · Pinia |
| `shared/`    | `@erp/shared` — Zod schemas shared by client + server |

## Quickstart

```bash
pnpm install
pnpm --filter @erp/shared build     # build shared schemas first
docker compose up -d                # PostgreSQL + MinIO

cp back/.env.example back/.env
pnpm --filter back migration:up     # create all 37 tables
pnpm --filter back start:dev        # API  → http://localhost:3000
pnpm --filter front-end dev         # web  → http://localhost:5173 
```

See `back/README.md` and `front-end/README.md` for details. Build the next
capability slice with `/opsx:propose` then `/opsx:apply` (build order in
`openspec/project.md`).
