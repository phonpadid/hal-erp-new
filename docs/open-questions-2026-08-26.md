# Open questions — 2026-08-26

Everything here is **blocked on a person, not on code**. Both changes that carried these were
archived complete on this date: their artifacts were done, their deltas were folded into the main
specs, and every task that could be finished without an answer was finished. These are what was
left, lifted out so that archiving does not bury them.

---

## 1. Go-live configuration — three decisions the customer has not recorded

From `make-the-configuration-usable-before-go-live` (tasks 6.1–6.3). The tooling to ask and to
record the answers is built and shipped: `pnpm --filter back golive:check` produces the question
list, `golive:check --template <path>` produces the file to fill in, and `golive:apply <file>`
records it. What no command can supply is the answers.

**1.1 Which department raises each of the eleven `REC*` types, and under which workflow?**
Nothing routes them today. A type mapped to no department cannot be raised by anyone — the create
wizard does not offer it. These eleven are the disbursement types the system was bought for.

**1.2 Should the approval chains target roles, and which roles?**
Two chains name individuals rather than roles, so nobody else can approve when those people are
away and there is no role for a delegation to resolve against. One is the sandbox's own; the other
is the customer's real chain. The roles that exist are `ພະນັກງານ` (84 holders — too broad to
approve anything), `Administrator` (4), and two single-holder finance roles. A role-targeted chain
probably needs roles that do not exist yet.

**1.3 Will USD documents continue to be raised?**
Seven exist and no `USD→LAK` rate resolves, so a new one is refused at submit — the rate is stamped
on the document (invariant 6) and there is nothing to stamp. If yes, a rate source and a
`BUDGET_RATE` policy are needed. If no, deactivating the currency makes the finding go away
honestly.

**Also blocked by 1.1:** applying a *complete* config file to a scratch copy and running the whole
`back/e2e` suite against the customer's own configuration rather than a sandbox the suite builds
for itself. That is the check that go-live configuration actually works, and it cannot be written
until 1.1 has an answer.

Detail, and the baseline the check reported: [`golive-check-2026-08-26.md`](./golive-check-2026-08-26.md).

---

## 2. Does the grouped budget picker actually help a requester?

From `choose-a-budget-without-guessing` (task 3.3).

The picker now groups ninety-odd budgets under their category headings, with a filter that searches
both the label and the group. The codes and their order are unchanged; **the shape of the list is
not**, and that is the part only a person can judge.

The task was written as "confirm before this ships". It has since shipped — the change is in
`master` and deployed. So the question is no longer whether to release it but whether it earned its
place: **ask a requester who uses this screen daily whether the headings help them pick, or whether
they now scroll past a heading looking for a code they used to find by position.**

If the answer is no, the fix is small and the evidence for it is that conversation.

---

## Why these are worth keeping

Each is a decision that changes what the software does for a real person, and none of them has a
technical answer. Three of the four have a wrong answer that is invisible once applied: a document
routed to the wrong department is approved by somebody with no authority over that budget, and
nothing downstream catches it, because every downstream rule is *about* the route.
