# ERP Frontend — Vue 3 + PrimeVue 4

Vue 3 (`<script setup>`, TS) · PrimeVue 4 (Aura, `.dark` selector) · PrimeIcons ·
Tailwind + `tailwindcss-primeui` · `@primevue/forms` + Zod · Pinia · Vue Router.

## Setup & run

```bash
# from the repo root
pnpm install
pnpm --filter @erp/shared build     # form schemas come from @erp/shared

cd front-end
pnpm dev                            # http://localhost:5173
pnpm build                          # vue-tsc type-check + production build
```

Set `VITE_API_URL` (defaults to `http://localhost:3000`) to point at the backend.

## Conventions

- **Forms**: `@primevue/forms` (`<Form :resolver :initialValues @submit>` + `<FormField>`),
  validated by a Zod schema via `zodResolver`. Schemas come from `@erp/shared` so the
  form and the backend DTO share one source of truth (see `views/CompanyFormView.vue`).
- **Permissions**: `stores/auth.ts` holds the active company + permission codes;
  `v-can="'CODE'"` (`directives/can.ts`) gates affordances by code. UX only — the
  server still enforces.
- **API**: `api/client.ts` (axios) attaches the company-context JWT on every request.
- **Theming**: PrimeUI tokens via `tailwindcss-primeui` only — no hardcoded colors.
  The header toggle flips the `.dark` class PrimeVue watches, so light/dark both work.
