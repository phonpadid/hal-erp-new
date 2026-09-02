# Offer only the doors you can open

## Why

`finish-every-document-the-wizard-offers` gave a document type an `authoring_route`: the wizard keeps
the card and, when the type's content lives elsewhere, sends the user to the screen that writes it.
That change was archived, and re-testing it on a fresh seed found the half it did not think about.

**Who sees the card and who may open the screen are decided by two unrelated things.**

```
who sees the card        dept_doc_type — the department may raise this type
who opens the screen     the route's meta.permission — this user holds that code
```

Nothing keeps them in step. On the seeded database:

```
requester   BUDGET_* permissions: 0   (8 permissions in total)
routes.ts   { path: 'budgets', name: 'budgets', meta: { permission: 'BUDGET_VIEW' } }
```

So a requester is offered **Budget Plan**, clicks it, and the wizard navigates to `budgets` exactly
as designed — where `router/index.ts:32` refuses it:

```ts
if (route.meta.permission && !state.can(route.meta.permission)) return 'home';
```

They land on the dashboard. No message, no explanation, and the document they were trying to raise
is not started. Verified by hand: choosing the card as `requester` ends on `/new/`.

**This is worse than what it replaced, in one specific way.** Before the change, a requester choosing
Budget Plan got a form — a form that produced an empty document nobody could approve, which is why
it was fixed. Now they get bounced to the home page with nothing said at all. The old failure was
late and wasteful; this one is immediate and mute. A user who does not know the permission model
cannot tell a bug from a misclick.

**The design missed it because it reasoned about the type, not the person.** The rule it wrote down
was *"a type the wizard cannot carry to a working document must not present itself as one it can"* —
about the type. The real rule has a second half: **whether this particular user can get there**. A
card whose destination this user cannot open is exactly as much a door onto a wall as a card with no
destination, which is the case that change already refused to ship (overtime was deactivated rather
than pointed at a screen that does not exist).

**Everything needed is already on the client.** `auth.can(code)` exists and is the established gate
(`v-can`, `AppTopbar`, `DashboardView` all use it), and the permission a route requires is readable
from the route itself — the same `meta.permission` the navigation guard reads. No new configuration,
and no second copy of the rule that could drift from the guard.

Two of the three seeded routes are guarded by codes a requester lacks:

| type | route | route requires | requester holds it |
| --- | --- | --- | --- |
| BUDGET_PLAN, BUDGET_ADJ ×2, BUDGET_TRANSFER | `budgets` | `BUDGET_VIEW` | no |
| JV | `journal-voucher` | `GL_JV_POST` | no |
| LEAVE | `request-leave` | `DOC_CREATE` | yes |

So five of the six routed types currently dead-end for the very role most likely to be raising
documents.

**The same mismatch exists one level down, in the fields.** Two of the pickers the wizard was just
given read endpoints the document-raising role cannot call:

```
GET /warehouses   requires INV_VIEW          requester holds: MASTER_VIEW, ATTEND_PUNCH_SELF,
GET /employees    requires EMPLOYEE_MANAGE   ATTEND_DAY_SELF, DOC_VIEW, DOC_CREATE, DOC_SUBMIT,
                                             DOC_CANCEL, NOTIFICATION_VIEW  — neither of them
```

Both calls fail soft (`.catch(() => [])`), so the required field renders as an empty dropdown with
no explanation, and the document can never be submitted. A goods issue and a promotion are both
unraisable by `requester` for this reason. It went unnoticed because the walkthrough that verified
those pickers was done as `admin`, who holds everything — the same mistake as the card-level defect,
made again one layer down.

This is not a permission to widen: `EMPLOYEE_MANAGE` is full HR administration, and handing it to
everyone who fills in a form so they can read a name is far more than the form needs. The codebase
already answers this exact question — a requester-facing read authorized by `DOC_CREATE` returning
selection fields only, as `GET /budgets/selectable` and `GET /quotas/selectable` already do.

## What Changes

**A card SHALL NOT be offered to a user who cannot reach the screen that authors it.** The wizard
resolves each routed type's destination, reads the permission that route requires, and treats a type
the user cannot reach as one they may not raise.

**It disables rather than hides.** A hidden card teaches nothing: a requester who has been told to
raise a budget plan and cannot find it learns only that the system is confusing. A card shown
disabled, saying which permission it needs, tells them what to ask for and whom to ask. This mirrors
the existing UX-guard convention — the client gates on permission code, the server stays
authoritative — and it is the reason the change is a disabled state rather than a filter.

**The permission comes from the route, not from a new column.** `authoring_route` already names the
destination; the destination already declares what it needs. Copying that requirement into
`document_type` would be a second statement of the same fact, free to drift from the guard that
actually enforces it.

**The wizard's pickers read requester-facing endpoints.** `GET /warehouses/selectable` and
`GET /employees/selectable` join the pickers that already exist, authorized by `DOC_CREATE` and
returning selection fields only — no stock figures, no salary, no employment history. The
administration reads keep their own permissions untouched.

**Nothing changes for a type the wizard authors itself.** A type with no `authoring_route` stays
exactly as it is: the wizard owns it, and its permissions are the document permissions the wizard
already checks.

## Who this answers

| party | what happens today | after |
| --- | --- | --- |
| a requester choosing Budget Plan | lands on the dashboard, nothing said, nothing created | sees the card disabled and which permission it needs |
| a requester choosing Leave | works — the route needs only `DOC_CREATE` | unchanged |
| whoever grants permissions | a support question with no evidence attached | the user can name the code they were refused |
| whoever adds the next routed type | no reason to think about who can reach it | the wizard checks, and an unreachable card cannot ship silently |
| a requester raising a goods issue | a required warehouse field with an empty list | the warehouses of their company, from a read `DOC_CREATE` may call |
| a requester raising a promotion | a required employee field with an empty list | the employees of their company, without granting HR administration |

## What This Change Does NOT Do

- **Does not change who may raise what.** `dept_doc_type` still decides which types a department
  raises, and the route guard still decides who may open a screen. This stops the two from
  contradicting each other in front of the user; it does not move either decision.
- **Does not change the navigation itself.** Choosing a reachable routed type navigates exactly as it
  does now.
- **Does not add a permission column to `document_type`.** The route already declares its
  requirement, and a copy would be free to drift from the guard.
- **Does not re-grant anything in the seed.** Whether a demo requester *should* hold `BUDGET_VIEW` is
  a question about the seeded role, and answering it by widening a role would hide the defect rather
  than fix it — the mismatch would still be reachable for any real company whose roles differ.
- **Does not weaken any existing endpoint.** `GET /warehouses` keeps `INV_VIEW` and `GET /employees`
  keeps `EMPLOYEE_MANAGE`; the two selection reads are additional, narrower, and return only what a
  picker needs. The card-level half of this change is a UX guard alone — the screens behind those
  routes still enforce their own permissions.
