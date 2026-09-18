## Context

Backend refusals are `throw new BadRequestException('English sentence')`; `CodedExceptionFilter`
adds a `code` (own or status-derived) and passes the body through. The web app has one seam —
`utils/apiError.ts#messageOf` — that every toast and inline error reads, and an i18n catalog with
en/la/zh namespaces. The two are not connected: `messageOf` returns `message` verbatim.

The settle guard (`ref-chain.config.ts`): `assertReservationCanBeSettled(type)` runs on mapping
and on type update; `assertNoReservingTypeStranded(companyId)` runs after every type update and
after every pairing removal, over *every* active budget-requiring type — mapped or not, faulty
before the write or not. The production copy has `CLAIM_RECOVERY` (unmapped, `requires_budget`,
`ADJUST_INCREASE`), so every type write in HAL is refused with a sentence about it.

## Goals / Non-Goals

**Goals:**
- Every configuration refusal reaches the screen in en/la/zh, naming things by code, never by id.
- One mechanism (`messageKey` + `params`) any future refusal can adopt with one line.
- The settle guard refuses exactly the writes the spec describes and no others.

**Non-Goals:**
- Translating refusals outside the configuration area (documents, budgets, payments) — the
  mechanism is general, the catalog is filled for configuration first; others follow as separate
  changes.
- Server-side locale negotiation (`Accept-Language`). The client owns the language; the server
  supplies the key and the facts.
- Changing any `code` value or adding codes for translation's sake — `code` stays a reaction
  contract (platform-foundation).

## Decisions

### 1. `messageKey` + `params` on the error body, separate from `code`
`error-code.ts` gains `explained(key, params, message, status?)` beside `coded(...)`: it builds the
same Nest exception and attaches `messageKey` and `params` as enumerable own properties (the pattern
`coded` already uses for `code`). `CodedExceptionFilter` copies them onto the body when present.
`coded` and `explained` compose: `explained(...)` on an exception that also needs a `code` takes an
optional `code` argument. Keys are dot-paths under one namespace, `config.*`, e.g.
`config.type.cannotSettle`, `config.step.noApprover`, `config.notFound.workflow`.
*Alternative:* reuse `code` as the translation key — rejected; the platform spec forbids adding codes
nobody branches on, and the two change for different reasons.

### 2. The client translates in `messageOf`
`messageOf(e, fallback)` reads `e.response.data.messageKey`; if `i18n.global.te('errors.' + key)`
it returns `i18n.global.t('errors.' + key, params)`, else the current behaviour. `apiError.ts` is
plain TS, so it imports the app's `i18n` instance rather than `useI18n()` (no component context);
tests stub it. A new namespace `errors` per locale (`locales/{en,la,zh}/errors.ts`) holds
`config.*`. Because the change is in the seam, `useFeedback().error`, the wizard's refusal panel,
`stores/*.error` and inline messages all pick it up without edits.

### 3. Keyed refusals in the six configuration services
Each `throw new BadRequestException/NotFoundException/ConflictException('…')` in
`document-type.service.ts`, `document-category.service.ts`, `form-template.service.ts`,
`dept-doc-type.service.ts`, `ref-chain.service.ts`, `ref-chain.config.ts` and
`workflow-config.service.ts` becomes `throw explained('config.…', { … }, '…same English…', status)`.
The English text is kept verbatim where it is already good and tightened where it printed an id
(`Workflow ${id} not found` → params carry nothing; the Lao/English sentence says "the workflow was
not found"). Param names are a fixed vocabulary: `typeCode`, `categoryCode`, `stepNo`, `status`,
`field`, `postAction`, `existingCode`.

### 4. The settle guard: raisable types, judged on the write's delta
`ref-chain.config.ts`:
- `reservingTypes(em, companyId)` returns active, budget-requiring types that have at least one
  active `dept_doc_type` row — the spec's "raisable".
- `strandedReservingTypes(em, companyId)` = those without a path (existing walk).
- `assertNoReservingTypeStranded(em, companyId, before: Set<typeId>)`: callers snapshot
  `strandedReservingTypes` *before* mutating, and the guard refuses only for types in
  `after − before`, naming the first by code via `explained('config.type.wouldStrand', {typeCode})`.
  `document-type.service.update` snapshots before applying the dto; `ref-chain.service.removePairing`
  snapshots before `tem.remove`. `assertReservationCanBeSettled(type)` (the gate on mapping and on
  making a type active/reserving) is unchanged in strictness — it is the write to *that* type, which
  the spec says is where a pre-existing fault is repaired — but its message becomes
  `config.type.cannotSettle`.
*Alternative:* keep the company-wide check and just reword — rejected; the wording was never the
bug, the blame was.

### 5. A refused action never empties the screen
Found while writing the switch test: `docConfig.run()` put an action's refusal into `store.error`,
the same field every configuration view binds to `<ErrorState v-if="cfg.error">` — so one refused
toggle swapped the whole list for the page-load error panel until "retry". That is the second half
of "the switch always errors". The store now keeps `actionError` for refused writes and `error` for
failed reads; the 24 `fb.error(cfg.error)` sites read `actionError`. `DocTypesView.toggleActive`
re-reads the types on refusal so the switch shows the stored value. No new component.

## Risks / Trade-offs

- [A key without a translation in one locale] → `te()` falls back to the English `message`; a spec
  test iterates the en catalog and asserts la/zh have every `errors.config.*` key.
- [`CLAIM_RECOVERY` stays `requires_budget = true`] → harmless once the guard reads mappings; the
  moment someone maps it to a department, `assertReservationCanBeSettled` refuses *that* write with
  the keyed, translated sentence — which is where the spec wants the fault surfaced.
- [Server text and translation drift] → both are written at the same throw site in the same change;
  the key is the join, not the sentence.

## Migration Plan

1. `explained()` + filter pass-through + filter test.
2. Guard rewrite + tests (unmapped type; pre-existing fault; the two spec'd refusals still fire).
3. Key the six services; write en/la/zh `errors.config.*`; parity test.
4. `messageOf` translation + test; `DocTypesView` switch revert.
5. Deploy both targets. No migration, no announcement.

## Open Questions

- None.
