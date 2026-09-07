## 1. What a company actually needs

- [x] 1.1 One derivation of "which roles does this company's configuration require", in a place both
      the API and the go-live inspection call — a second copy would disagree the first time either
      moved
- [x] 1.2 Unit tests per rule: a company with no VAT code needs no `VAT_INPUT`; one with a
      stock-moving type needs the inventory roles; one that settles payments needs `CASH_CLEARING`

## 2. Reading and recording a mapping

- [x] 2.1 `AccountRoleService`: list every `AccountRoleType` for the active company with its mapped
      account (or none) and whether the company requires it — the list comes from the enum, never a
      second table
- [x] 2.2 `AccountRoleService.set(role, accountId)`: replaces rather than duplicates; refuses an
      unknown role, another company's account, an inactive account, and a non-postable account, each
      by name
- [x] 2.3 Controller under the accounting module: `GET` on `COA_VIEW`, `PUT` on `COA_MANAGE`
- [x] 2.4 Tests: read is company-scoped; set stores, replaces, and refuses each bad case; mapping
      writes no `journal_entry` and no `budget_txn`

## 3. The go-live inspection reports it

- [x] 3.1 `UNMAPPED_ACCOUNT_ROLE` added to `FindingKind`, with a finding source using the shared
      derivation from 1.1
- [x] 3.2 The template generator explains the decision without proposing an account (design D3)
- [x] 3.3 Tests: a required-and-unmapped role is reported; an unneeded one is not; a mapped one is
      not; the inspection still writes nothing

## 4. The screen

- [x] 4.1 A roles panel ON the chart-of-accounts screen, on `COA_VIEW` — not a screen of its own
- [x] 4.2 Each role shown with its purpose in words, its mapped account, and a clear mark when it is
      required and missing
- [x] 4.3 An account picker over the company's active postable accounts; save on `COA_MANAGE`, and no
      control at all without it
- [x] 4.4 API client; no route and no sidebar entry — it is part of a screen that already has both
- [x] 4.5 i18n in `en`, `la`, `zh` — including a readable purpose for every role
- [x] 4.6 Component tests: missing-and-required stands out; a mapped role shows its account; a reader
      is offered no control; the picker offers only postable accounts; it renders inside the
      chart-of-accounts screen

## 5. Verification

- [x] 5.1 Backend and frontend suites, `tsc -p tsconfig.build.json` and `vue-tsc -b` — backend
      2136 passed, frontend 1128 passed, both typechecks clean (plus `tsconfig.scripts.json`)
- [x] 5.2 `golive:check` against the live database now names the roles it is missing — 5
      findings became 9: CASH_CLEARING, VAT_INPUT, FX_GAIN and FX_LOSS, each with its purpose
- [ ] 5.3 Map the roles the live company needs, requeue the parked payment postings, and confirm the
      journal shows the entries
