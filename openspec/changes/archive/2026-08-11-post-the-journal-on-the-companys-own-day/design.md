## Context

`journal_entry.entry_date` is a `date`, not a timestamp — it is the day the books say the event
happened, and every financial report ranges over it. `financial-reports` filters the trial balance,
the account ledger and the income statement on `journal_entry.entry_date`, and derives the balance
sheet from `entry_date <= asOf`. It is therefore the single field that decides which period a
figure belongs to.

Four places produce it, all the same way:

```
gl-posting.service.ts:175   payment settlement   (payment.paidAt ?? payment.createdAt ?? now)
gl-posting.service.ts:262   approval accrual     (document.approvedAt ?? now)
gl-posting.service.ts:353   claim settlement     (now)
gl-posting.service.ts:483   stock movement       (txn.createdAt ?? now)
                            ─── all: .toISOString().slice(0, 10) ───
```

The instant chosen differs per path and is correct in each. The conversion from instant to day is
UTC in all four, and is wrong in all four for every company this system serves.

The repository already contains the fix, in the wrong place:

```ts
// back/src/modules/attendance/company-clock.ts
export function localDateIn(instant: Date, timezone: string): string   // 'YYYY-MM-DD'
export function localMidnightInstant(date: string, timezone: string): Date
```

Its header comment records why it exists — a missing `timezone` "silently moved every punch near a
midnight boundary onto a different day" — which is the same failure, on a different ledger.

## Goals / Non-Goals

**Goals:**

- An entry is dated the day its event happened where the company is, not where the server is.
- The rule is stated in the spec, so a fifth posting path cannot reintroduce the defect by copying
  the fourth.
- One seam produces every `entry_date`, so the future period guard has one place to sit.

**Non-Goals:**

- Changing which *instant* any path picks. `paidAt ?? createdAt ?? now` and its siblings stay
  exactly as they are; the fallback ladders encode real knowledge about each source.
- Correcting entries already written. Append-only means a correction is a new entry, and which
  historical entries deserve one is a decision per company.
- Introducing per-user or per-branch timezones. `company.timezone` is the unit the DBML defines and
  the unit reports aggregate over.

## Decisions

### D1 — One helper, taking the company, not the timezone string

```ts
private entryDateFor(company: Company, instant: Date): string
```

rather than threading `timezone` through each call site. Each posting path already has the company
— `payment.company` is populated, the accrual and settlement paths load `document.company`, the
stock path resolves `companyId` before building lines — and passing the entity keeps the rule
"the *posting company's* day" visible at the call site instead of leaving a bare string that could
come from anywhere.

The helper resolves `company.timezone` and calls `localDateIn`. It does not default the timezone:
the column is `not null` with a default, so a company without one is a data fault worth surfacing,
not one to paper over with UTC — which is the behaviour being removed.

### D2 — `company-clock.ts` moves to `common/`, unchanged

The GL importing from `modules/attendance/` would be wrong twice over: a dependency from an
accounting capability onto an HR one, and a signal that the function is attendance-specific when it
is the repository's general answer to "which calendar day is this instant on for this company".

It moves to `back/src/common/time/company-clock.ts` with **no edit to either function** — same
names, same signatures, same body, same comments. Five importers are repointed. A move plus a
behaviour change in one commit would make the attendance day-boundary logic impossible to review,
and that logic is load-bearing for shift dates, OT windows and period membership.

Re-exporting from the old path was considered and rejected: two import paths for one function is
how the next reader concludes there are two functions.

### D3 — The spec fixes the rule, not the four call sites

The requirement says what `entry_date` means for any posting, present or future:

> the calendar day the posted event fell on in the posting company's own `company.timezone`

rather than enumerating the four paths. Enumerating them would make a fifth path — the AP accrual
and the period-close accrual are both coming — silently exempt, which is exactly how four copies of
one derivation came to exist.

The scenarios pin the boundary case explicitly (an event at 06:30 local in a UTC+7 company dating
to that day, not the day before), because a scenario using a midday instant passes under either
implementation and would pin nothing — the same trap `Derived Budget Figures` fell into with its
zero-ACTUAL utilization example.

### D4 — The two missing roles are a spec fix only

`VAT_INPUT` and `WHT_PAYABLE` are in `account_role_type` in the DBML, are resolved by
`gl-posting.service.ts`, and are exercised by `Posting on Payment Settlement`'s scenarios. Only
`Config-Driven System Account Roles`' enumeration omits them. No code changes; the list gains the
two names and a sentence each, in the same shape the inventory roles already have.

It rides along with this change rather than waiting for its own because both defects are the same
kind — `gl-journal`'s spec not describing the GL that exists — and because the consequence of the
omission (a silently unpostable company) is severe relative to the size of the fix.

## Risks / Trade-offs

**A reporting seam at the deploy.** Entries written before the change are dated by UTC, after it by
company day. A trial balance spanning both shows a handful of entries in the neighbouring period.
There is no correct automated remedy — moving an append-only entry means reversing and re-posting
it — so this is a release note, not a migration.

**Moving a file the attendance module depends on.** Mitigated by moving it verbatim and by the
attendance suite, which exercises day boundaries directly. If the diff shows any change inside
either function, the move is wrong.

**`now` as a fallback is still `now`.** Where a source carries no timestamp the entry is dated the
day the *posting* ran, not the day the event did. Post-commit posting normally runs seconds later,
so the two agree except across midnight — and after this change, across the company's midnight
rather than UTC's, which is the improvement available without changing what each path records.

## Migration Plan

None. No schema and no data change. `company.timezone` is `not null` with a default, so every
existing company already resolves.

## Open Questions

None.
