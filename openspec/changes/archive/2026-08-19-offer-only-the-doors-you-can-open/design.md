# Design — Offer only the doors you can open

## Context

A routed document type sends the user to another screen. That screen is permission-guarded, the card
is not, and nothing keeps the two in step: `requester` is offered Budget Plan, the wizard navigates
to `budgets`, and `router/index.ts:32` redirects to `home` because they lack `BUDGET_VIEW`.

The same mismatch runs one level deeper: two of the wizard's own pickers read endpoints that role
cannot call, so the required field renders empty. The card half is a UX guard; the picker half adds
two narrow server reads. No schema is touched.

## Decisions

### D1. The reachability question is answered by the view, the answer is rendered by the picker

`CreateDocumentView` already holds the router and the auth store; `DocumentTypePicker` already owns
the cards and their ARIA semantics. Splitting it the other way — giving the picker a router and a
store — would make a presentational component depend on both and would make it untestable without
mounting a router.

So the view computes, per type, whether this user can reach its destination, and passes that down.
The picker learns nothing about permissions; it renders a card as reachable or not.

### D2. The required permission is read from the route, never copied

`authoring_route` names the destination. The destination already declares what it needs, in the same
`meta.permission` the navigation guard reads:

```
router.resolve({ name: authoringRoute }).meta.permission   →   auth.can(code)
```

The alternative — a `required_permission` column on `document_type`, or a lookup table in the client
— states the same fact twice. The copy would be free to drift from the guard that actually enforces
it, and the first symptom of the drift would be this same defect wearing a different hat.

### D3. Disabled and stated, not hidden

Hiding is less code and worse. A requester told to raise a budget plan, who cannot find the card,
learns only that the system is confusing; there is nothing to report and nothing to ask for. A card
shown disabled, naming the permission it needs, converts a dead end into a request someone can act
on.

It also matches how the rest of the app already gates: the client hides or disables by permission
code as a UX guard while the server stays authoritative (`auth.can`, the `v-can` directive,
`AppTopbar`, `DashboardView`).

**The permission is shown as its code**, not a translated phrase. Codes are the vocabulary the system
authorizes on (invariant 5) and the thing an administrator searches for; there are 75 of them, and a
prose paraphrase would be one more string to keep in step with a list that already exists.

### D4. An unknown route is reachable, because the wizard keeps it

The previous change made a card whose `authoring_route` names no known route fall through to the
wizard's own steps rather than dead-end. That rule stays, and it decides this one: if the route
cannot be resolved, there is no other screen involved, so there is no other permission to hold. Such
a card is reachable and stays enabled.

Getting this backwards — treating an unresolvable route as unreachable — would disable a card that
works, turning a misconfiguration into a lockout.

### D5. A disabled card stays focusable, so its reason can be read

WAI-ARIA allows a disabled radio to be either skipped or focusable. Skipping is the usual default and
is wrong here: the whole point is to tell the user why, and a keyboard or screen-reader user who can
never land on the card can never hear it.

So arrow keys still move to an unreachable card and it exposes `aria-disabled`; activating it does
nothing. The information is reachable by every input method, and the card cannot be chosen by any of
them.

### D6. Only routed types are affected

A type with no `authoring_route` is authored by the wizard itself. Its permissions are the document
permissions the wizard and the server already check, and nothing about this change touches them. The
check runs only where a second screen is involved, which is the only place the two decisions can
disagree.

### D7. The pickers get their own reads rather than a wider grant

The wizard's warehouse and employee pickers call endpoints the document-raising role cannot:
`GET /warehouses` needs `INV_VIEW`, `GET /employees` needs `EMPLOYEE_MANAGE`, and `requester` holds
neither. Three ways out:

| | what it costs |
| --- | --- |
| grant the role `INV_VIEW` + `EMPLOYEE_MANAGE` | `EMPLOYEE_MANAGE` is full HR administration — salary, onboarding, termination — handed over so a form can show a name |
| relax the existing endpoints | the admin lists carry stock figures and employment records; every reader of those screens would gain them |
| **a selection read per resource (chosen)** | two small endpoints, `DOC_CREATE`, selection fields only |

The third is what this codebase already does twice, and it wrote down why:
*"Budget picker for the Create Document wizard. Authorized by DOC_CREATE (not BUDGET_VIEW) and
returns only {id, budgetName, glAccount} — no amounts."* `GET /quotas/selectable` follows it, and
`quota-management` specifies it as a requirement in its own right. Two more of the same shape is the
conventional answer, not a new idea.

`/employees` carries its permission at the class level. The guard resolves with
`getAllAndOverride([handler, class])`, so a handler-level `DOC_CREATE` replaces it rather than adding
to it — which is what makes the narrower read possible without splitting the controller.

**The failure was silent because the client swallows it.** Both picker loads end in
`.catch(() => [])`, so a 403 became an empty required dropdown. That fallback is right for a picker
whose absence should not block the whole wizard, and it is also why nothing surfaced until someone
tried the form as a requester. The lesson recorded here: a walkthrough done as `admin` proves the
mechanism works and proves nothing about who can use it.

## Risks

- **A route whose guard changes later** silently changes which cards are enabled. That is the
  intended coupling — the card follows the guard — and it is the reason the permission is read from
  the route rather than stored beside the type.
- **A user with a partial grant** may hold the route's permission but still be refused something the
  destination screen does for them. This change only promises what the guard promises: that the
  screen will open. Anything past that is that screen's business.
- **A picker that fails soft still fails.** `.catch(() => [])` keeps one broken reference read from
  taking down the wizard, and it also hides the reason. This change removes the cause rather than the
  fallback; if another picker is added against an endpoint the role cannot call, it will be just as
  quiet. Naming it here so the next one is caught by looking, not by luck.
- **Seeded roles are what surfaced this**, and it would be tempting to widen `requester` instead. The
  proposal rejects that: widening a demo role hides the mismatch while leaving it reachable for any
  real company whose roles differ.
