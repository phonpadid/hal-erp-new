## Context

The Create Document wizard (`front-end/src/views/documents/CreateDocumentView.vue`) drives the
single most consequential action a requester takes — it produces the document that budget
reservation and the approval workflow act on. It is built as a four-step `FormStepper`
(type → details → lines → review). The form is configuration-driven: document types, dynamic
fields (with `condition_json` visibility), the conditional vendor picker (`requires_vendor`),
and the conditional currency picker (money categories) all come from the server. Money is
carried as strings and formatted by the currency's `decimal_places`; the server is
authoritative for every rule.

Today the wizard works but reads as a prototype: the Review step shows only the type name and a
line count, the line editor is a single wrapping flex row, validation errors are easy to miss,
and spacing/responsiveness are uneven. This change is a presentation-layer polish — no backend,
DTO, API, or schema work — so the design is about component structure and UX behavior, not data.

## Goals / Non-Goals

**Goals:**
- A Review step that faithfully mirrors what will be submitted (type, currency + FX note,
  vendor when required, every visible field's value, all lines with amounts and a grand total).
- A line-item editor that is legible and aligned, has a running total and an explicit empty
  state, and gives per-line numeric feedback.
- Validation that is impossible to miss: inline field errors, a marked failing step, required
  indicators, and clear busy/disabled button states with the server error shown verbatim.
- A clean visual + responsive pass using only PrimeUI theme tokens (light/dark safe).

**Non-Goals:**
- No change to backend services, REST endpoints, DTOs, shared schemas, or the data model.
- No change to which fields/pickers appear (the existing `requires_vendor` / money-category /
  `condition_json` gating stays exactly as-is).
- No change to client validation *rules* — only how validity and errors are *presented*. The
  server remains the source of truth.
- Not introducing a new component library, table grid, or state-management pattern.

## Decisions

- **Keep the four-step `FormStepper`; enrich step content, not the flow.** The step sequence and
  navigation are familiar and already permission-aware. Rebuilding into a single long form or a
  different wizard library would be a larger, riskier change for no clear gain. *Alternative
  considered:* collapse to a one-page form — rejected; the stepped flow keeps the dynamic-field
  and lines sections digestible.
- **Build the Review step from the same reactive state the steps already bind.** The summary
  reads `selectedType()`, `currency`/`previewRate`, `vendorId`/`selectedVendor`,
  `fieldControls` (visible fields only), and `lines`/`docTotal` — so it cannot drift from what
  is submitted. *Alternative:* re-fetch a server-rendered preview — rejected as unnecessary
  round-trips and a new endpoint for a draft that may not exist yet.
- **Reuse existing formatting + visibility helpers.** Amounts go through the currency-format
  composable (`decimal_places`), and the summary lists only fields passing `isFieldVisible`, so
  hidden conditional fields never leak into the review. No new money math or number coercion.
- **Lines editor as an aligned grid with a header row + per-line rows + a totals footer.** Use a
  CSS grid / responsive utility layout rather than a heavy DataTable, because rows are editable
  inputs, not display cells. Column headers render once; each row aligns to them; the footer
  shows the running document total (and the advisory base preview when foreign).
- **Surface validation through the existing channels.** `FormStepper` already emits
  `step-error`; route per-step messages there and add inline `<Message>` next to fields and
  lines. Required fields keep their existing client checks but gain a visible `*` indicator.
  Button busy state comes from the existing `busy` ref; the server error is shown verbatim via
  the existing feedback path.
- **Theme tokens only.** All new styling uses Tailwind + `tailwindcss-primeui` tokens
  (`text-muted-color`, `surface-*`, severity colors) — no hex — so dark mode is automatic.

## Risks / Trade-offs

- **Review duplicating display logic could drift from the editor.** → Derive the summary from
  the *same* refs/computed the editor binds (not a parallel copy), and format through the shared
  composable, so there is one source of truth.
- **A denser lines grid may feel cramped on small screens.** → Define an explicit responsive
  breakpoint where columns stack with labels; verify the empty state and add-line affordance at
  mobile width.
- **Showing more on Review risks exposing hidden conditional fields.** → Filter strictly through
  `isFieldVisible` (the same evaluator used for rendering and for the submit payload).
- **i18n gaps.** New labels (review section headings, totals, empty state, required hint) must
  exist in both `en` and `la`. → Add keys to both locale files in the same task; treat a missing
  key as a blocker.
- **Scope creep into behavior.** → Hold the line: gating, validation rules, and payload shape
  are unchanged; only presentation moves. Any rule change would belong in a separate proposal.

## Migration Plan

Pure front-end, no data or contract change, so deployment is a standard frontend build. No
migration, no rollback coordination beyond reverting the commit. Verify by loading
`/documents/new`, walking all four steps for a money type (e.g. PR) and a non-money type
(e.g. LEAVE/MEMO), and confirming the Review summary, line totals, validation messages, and
dark-mode rendering. The existing Vitest/Playwright suites for the documents views should pass
unchanged except where assertions reference the Review step's contents.

## Open Questions

- Should the Review step's field/line sections be editable-in-place (click to jump back to the
  relevant step) or strictly read-only with "Back" navigation? Default: read-only + Back, with a
  per-section "Edit" link that jumps to that step if it is low-effort.
- Should the lines grid adopt the shared `AppDataTable` styling for visual consistency, or a
  bespoke editable grid? Default: bespoke editable grid (rows are inputs), styled with the same
  tokens as `AppDataTable` for consistency.
