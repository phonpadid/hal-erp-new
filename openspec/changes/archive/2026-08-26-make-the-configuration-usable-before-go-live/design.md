## Context

A migrated database with a bootstrapped admin — everything `production-bootstrap` promises — is
still a database in which nobody can do anything. Routing lives in `dept_doc_type`, and the
customer's copy holds none for the eleven `REC*` types:

```
active document types                     13
  raisable by some department              2   (BUDGET_PLAN, SPEND_HIST — both import artifacts)
form templates still DRAFT                12 of 14
exchange rates                             0   (7 documents are already in USD)
APPROVE rows written by a person           0
```

None of that is a defect; each is a decision nobody has recorded. What is missing is any way to ask
which decisions are outstanding, and any way to record one except hand-written SQL.

The decisions themselves are not available. The customer has not said which department raises
`RECWH`, which workflow approves it, or above what amount a second signature is needed. That shapes
this change more than anything else: **the deliverable is the question and the ledger for the
answer, not the answer.**

## Goals / Non-Goals

**Goals:**
- Ask an environment what it still lacks, without changing it, and exit non-zero so a pipeline can
  gate on it.
- Turn that report into a file the customer can fill in.
- Reconcile a database to such a file, idempotently and all-or-nothing.
- Make "nobody can raise anything" impossible to discover by accident.

**Non-Goals:**
- **Inferring any mapping.** Discussed under Decisions; refused on principle, not effort.
- Vendors and payee bank accounts. No active type sets `requires_vendor` or `requires_payee`, so
  neither blocks go-live — an earlier assessment of mine said otherwise and was wrong.
- Accounting periods. A date no declared period covers posts normally, and no active type posts a
  journal, so zero periods blocks nothing.
- Designing the customer's approval chains. This change reports that one workflow with two named
  people currently serves everything; what should replace it is theirs to say.
- Removing the `E2E-SBX` sandbox from a database before promotion. Worth doing, separate concern.

## Decisions

### 1. Two commands, not one with a flag

`golive:check` reads; `golive:apply` writes. The split copies `permissions:check` /
`permissions:sync`, whose own note gives the reason: *"what is this environment missing?" is a
question worth being able to ask without changing the answer.*

It matters more here. The check is useful **today**, with no config file in existence, because its
output is the list of questions to put to the customer. A flag on a writing command would make
asking feel like a step toward applying.

### 2. The applier refuses to default

The tempting shortcut is to map every unmapped type to some department — the one that raised
similar documents, or the requester's own — and let people fix it afterwards. It is refused.

Eleven wrong routes reach production faster than one right one, and a wrong route is not visibly
wrong: a document appears in an approver's queue and gets approved by somebody with no authority
over that budget. Nothing downstream catches it, because every downstream rule is *about* the route.
`document-engine` already states the principle for the neighbouring case — an authoring route
"SHALL NOT be derived from `post_action` … deriving one from the other puts the answer in code
rather than configuration (invariant 7)". The same reasoning covers a department.

So: a type the file omits is left untouched **and reported**. Silence would be the same defaulting
by another name.

### 3. Written through the owning services, not SQL

`DeptDocTypeService.create` refuses a retired template, refuses a cross-company pair, and asserts
the type's reservation can be settled. `WorkflowConfigService` validates step targets.
`ExchangeRateService` owns rate resolution. A script writing rows directly would bypass every one of
those and could install configuration the screens would have refused.

The cost is that the script must run inside a Nest context to obtain them. `boot-check` already does
exactly this, so the pattern and its cost are established.

### 4. All-or-nothing per company, validated before the first write

Every reference in the file — department, workflow, template, currency, document type — is resolved
and checked **before** anything is written, and one company's reconciliation runs in one
transaction.

A half-applied routing table is the worst outcome available here: some types raisable and some not,
with no screen that shows the difference and no error left on the console. This is the same reason
`production-bootstrap` requires its own bootstrap to be all-or-nothing.

### 5. The file is data, reviewable as a diff

Shape (illustrative; settled when the template generator is written):

```jsonc
{
  "company": "HAL",
  "documentTypes": {
    "RECWH": {
      "authoringRoute": null,
      "mappings": [
        { "department": "<deptCode>", "formTemplate": "<version>", "workflow": "<name>" }
      ]
    }
  },
  "workflows": {
    "<name>": {
      "steps": [
        { "stepNo": 1, "approverRole": "<roleCode>", "amountMin": null, "amountMax": null }
      ]
    }
  },
  "exchangeRates": [{ "from": "USD", "to": "LAK", "rate": "0", "rateDate": "", "rateType": "" }]
}
```

Money stays a string throughout, as everywhere else. `approverRole` sits where the template puts a
slot rather than `approverUser`, because the check reports person-targeted chains as a finding — the
existing workflow's two named approvers are a single point of failure, and the file should not make
repeating that the path of least resistance.

**Note on the available roles.** This company's roles are `ພະນັກງານ` (84 holders — too broad to be
an approver), `Administrator` (4), and two single-holder finance roles. A role-targeted chain
probably needs roles that do not exist yet. The check reports the problem; creating those roles is a
customer decision and out of this change's scope.

### 6. `boot:check` counts but does not fail

A company mid-rollout legitimately has unmapped types, so failing a deploy on them would make the
check something operators route around. Counting them at every deploy is enough to stop
"nobody can raise anything" being a silent state — which is precisely how it survived until an
end-to-end run went looking.

## Risks / Trade-offs

**A config file becomes a second source of truth beside the screens.** → It is a reconciler, not an
owner: it states a desired end state and the screens remain authoritative for day-to-day edits. The
risk is a stale file re-applied later undoing a deliberate change made on screen — mitigated by the
check reporting drift, and by the file living in review alongside the change that introduced it.

**Running inside a Nest context makes the script slower and heavier than raw SQL.** → Accepted for
decision 3's reasons; `boot-check` already pays it.

**The check could become noise if it reports things that are fine.** → Every finding is a state in
which some user cannot do something. A company legitimately mid-rollout will see findings, which is
why `boot:check` counts rather than fails; the standalone command exits non-zero because its caller
asked the question deliberately.

## Migration Plan

No migration and no data change by default: `golive:check` writes nothing, and `golive:apply` writes
only what a file states.

Order of use:
1. Run `golive:check` against the customer's database. Its output is the question list.
2. Generate the template, take it to the customer, fill in the decisions.
3. Apply against staging, run the check again, confirm it is quiet.
4. Review the file as a diff; apply against production; run the check as the last deploy step.

Rollback is reverting the commit for the tooling. Configuration already applied is undone the way
any configuration is — through the screens, or by applying a corrected file.

## Open Questions

- **Which department raises each of the eleven `REC*` types, and under which workflow?** The
  question this change exists to put in front of the customer.
- **Should approval chains be role-targeted, and if so which roles?** The existing roles do not look
  like a fit (see decision 5), so the answer probably creates roles.
- **Do they raise USD documents going forward?** Seven exist and no rate resolves, so a new one is
  refused at submit today. If yes, a rate source and a `BUDGET_RATE` policy are needed; if no, the
  finding is noise and the check should be able to be told so.
