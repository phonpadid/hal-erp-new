---
name: dev-stack
description: Start, inspect, restart or stop this repo's local dev stack (postgres/MinIO + NestJS API + Vite web) and run the Playwright suites against it. Use whenever the task means running the project, seeing a change in the real app, driving the UI in a browser, or running e2e tests — "run the project", "start back and front", "run playwright", "เปิดโปรเจกต์", "รัน back front", "ลองในเบราว์เซอร์".
---

# Running this project

One script does all of it — `.claude/skills/dev-stack/dev-stack.sh`. Always use it instead of
starting servers by hand: the servers it starts are detached (they survive the tool call that
started them), it waits until each one actually answers, and it knows the two things that are
easy to get wrong here — the API port comes from `back/.env`, and the web app lives at
`/new/`, not at the root.

```bash
./.claude/skills/dev-stack/dev-stack.sh up          # infra + API + web, waits until both answer
./.claude/skills/dev-stack/dev-stack.sh status      # what is up, on which port, under which pid
./.claude/skills/dev-stack/dev-stack.sh logs api 80 # tail logs/api.log (or `logs web`)
./.claude/skills/dev-stack/dev-stack.sh restart api # after a change the watcher did not pick up
./.claude/skills/dev-stack/dev-stack.sh e2e         # back/ Playwright suite (starts the API first)
./.claude/skills/dev-stack/dev-stack.sh down        # stop API + web (`--all` also stops containers)
```

`up` takes `--api-only` / `--web-only`. Everything is idempotent — running `up` when the stack is
already up just reports it, so start there rather than checking first.

- **API** → `http://localhost:3000/api-new` (port from `PORT` in `back/.env`)
- **web** → `http://localhost:5173/new/` — the `/new/` prefix is vite's `base`; the bare root 404s
- **logs** → `logs/api.log`, `logs/web.log` (both gitignored; `up` truncates them per start)

## Which Playwright do you want

Two different things wear the name here. Pick by what is being checked.

**The API suite** — `back/e2e/*.e2e.spec.ts`, 83 tests over the real HTTP API, no browser.
Run it with `dev-stack.sh e2e`; pass any Playwright argument through:

```bash
./.claude/skills/dev-stack/dev-stack.sh e2e 60-concurrency.e2e.spec.ts
./.claude/skills/dev-stack/dev-stack.sh e2e --list -g "budget"
```

It runs `workers: 1` on purpose — the flows assert on ledger balances in one shared database.

> It **writes to whatever database `back/.env` points at**, which on this machine is a copy of the
> customer's data. Provisioning is idempotent and confined to the `E2E-SBX` sandbox department, so
> re-runs are safe — but say so before running the suite against an unfamiliar `DB_NAME`, and never
> "fix" a failing flow by mutating real departments or budgets.

**The browser** — the `mcp__playwright__*` tools, for seeing a UI change actually work. Bring the
stack up first, then:

1. `browser_navigate` to `http://localhost:5173/new/`.
2. Sign in. `.auth/admin.json`, `.auth/staff.json`, `.auth/accounting.json` are saved storage
   states for `http://localhost:5173` (an `erp_token` in localStorage) — `browser_set_storage_state`
   skips the login form when the token is still valid. If it has expired, log in through the form
   with `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` from `back/.env`. Read those out of the file
   when you need them; never echo credentials into the transcript.
3. `browser_console_messages` after the flow — a Vue render error shows up there and nowhere else.

The storage states are bound to origin `http://localhost:5173`, which is why the script pins vite
with `--strictPort` rather than letting it slide to 5174.

## When it will not start

- **`postgres reachable on :5432`** — this machine runs postgres natively, so docker is not needed.
  Only when nothing holds the DB port does the script fall back to `docker compose up -d`, and if
  the daemon is off it tells you to run `sudo systemctl start docker` rather than doing it for you.
- **MinIO down** — noted but not fatal; only attachment upload/preview breaks.
- **API never answers** — the script prints the tail of `logs/api.log`. A failure before the first
  log line is almost always `@erp/shared` (the backend imports its CommonJS `dist`, while vite
  aliases the TS source): `pnpm --filter @erp/shared build`.
- **Pending migrations** are never applied automatically — that DB holds real data. If the schema
  looks behind, say so and let the user run `pnpm --filter back migration:up`.
- **Port busy but not answering** — the script refuses to guess and shows the `lsof` line. `down`
  only ever kills node processes.
