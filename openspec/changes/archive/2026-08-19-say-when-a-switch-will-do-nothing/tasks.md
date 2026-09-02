# Tasks — Say when a switch will do nothing

## 1. The pairing editor

- [x] 1.1 `RefChainEditor.vue` states, beside the auto-create switch, that the predecessor does not
      create successors when its `post_action` is not the create-successor one. The predecessor is
      already in hand as `props.documentType`, and `DocType` already carries `postAction` — no fetch.
- [x] 1.2 ~~The same for the successor-department picker when auto-create is off.~~ **Not needed —
      the screen already never offers it.** The picker is behind `v-if="p.autoCreate"` on existing
      rows and `v-if="newSuccessorAuto"` on the new-pairing form, so a department cannot be set
      inertly in the first place. Recorded as a test that the picker stays hidden, and the spec
      scenario was rewritten to say what the screen actually guarantees rather than to demand a
      statement about a control nobody can reach.
- [x] 1.3 Both the existing rows and the new-pairing form. The new-pairing form has no row to ask
      about, which is one reason the condition is computed on the client rather than returned
      per-row by the server (D2).
- [x] 1.4 The condition is written once in the component, not repeated at each render site, so the
      rule and its wording move together.

## 2. The step form

- [x] 2.1 `WorkflowStepCreateView.vue` states, beside the escalation fields, that the step needs an
      SLA before escalation can fire — read from `slaHours` in the same form state.
- [x] 2.2 And that the approve mode is chased rather than reassigned, when it is `PARALLEL_ALL`.
- [x] 2.3 Both conditions live together, and neither disables the escalation controls (D3).

## 3. Wording and presentation

- [x] 3.1 Each statement names the **prerequisite**, not the symptom (D4) — "X does not create
      successors, so auto-create will not run", not "this switch does nothing". The service's
      refusal messages already do this; match them.
- [x] 3.2 i18n in all three locales, theme tokens only, no hardcoded colours.
- [x] 3.3 Placed beside the control it is about, not in a legend or a tooltip alone (D-risk) — a
      hint nobody reads did not work.
- [x] 3.4 Advisory styling, not error styling. Nothing is wrong; something is merely not yet live.

## 4. Tests

- [x] 4.1 Pairing: a predecessor that does not create successors shows the statement; one that does
      shows nothing. Both assertions matter — the second is what stops it appearing everywhere.
- [x] 4.2 Pairing: the successor-department statement appears only when auto-create is off.
- [x] 4.3 Step: the SLA statement appears with no SLA and not with one.
- [x] 4.4 Step: the mode statement appears for `PARALLEL_ALL` and not for `SEQUENTIAL`.
- [x] 4.5 The controls stay enabled in every case — this is the assertion that keeps a later
      "helpful" edit from turning the hint into a refusal.
- [x] 4.6 Assert what is RENDERED, not a computed property. `charge-the-budget-once` learned this
      the hard way: a test that read the computed passed while the template still did the wrong
      thing, and only a mutation of the binding exposed it.
- [x] 4.7 Each new test must fail with its feature removed. Check it, and record what was mutated.
      Restore from a scratch copy, never `git checkout`.

## 5. Verification

- [x] 5.1 front `npm run typecheck` (**not** bare `npx vue-tsc --noEmit`) and `npx vitest run`.
- [x] 5.2 back `npx vitest run` — nothing server-side changes, so this is a regression check only.
      **One suite at a time**; concurrent suites share the test database and the tell is the skip
      count leaving 36. Expect the known date-dependent attendance-correction failure.
- [x] 5.3 `openspec validate --all`.
- [x] 5.4 On the running app, in both themes: set auto-create on a type that does not create
      successors, and name an escalation target on a step with no SLA. Look at whether the statement
      is actually noticeable where it sits — that part is a judgement, not an assertion.

## 6. Scope deliberately left out

- [x] 6.1 **No server validation and no refusal.** Every combination that saves today still saves.
      Where a configuration genuinely costs something the rule belongs in the service, and
      `route-only-what-someone-can-approve` and `no-flag-without-its-prerequisite` have put five
      there. This is the other half of that line: refuse what harms a document, annotate what merely
      does nothing.
- [x] 6.2 **The controls are not disabled.** A disabled control is a refusal in disguise and would
      impose an order of work — naming an escalation target before enabling the SLA is reasonable.
- [x] 6.3 **No runtime behaviour changes**, including the deliberate refusal to escalate a
      `PARALLEL_ALL` step and the create-successor path that reads `auto_create`.
- [x] 6.4 **Tables the sweep did not cover.** It examined `document_type`, `document_type_ref` and
      `workflow_step`. The same pattern — a field read only under another field's value — is likely
      elsewhere and has not been looked for.
- [x] 6.5 **The client now restates two server-side conditions** (auto-create runs only under the
      create-successor post-action; escalation only for overdue non-`PARALLEL_ALL` steps). If either
      moves, the hint becomes a lie. Recorded as a risk in the design and stated in the spec this
      change adds, which is where the next person would look.
