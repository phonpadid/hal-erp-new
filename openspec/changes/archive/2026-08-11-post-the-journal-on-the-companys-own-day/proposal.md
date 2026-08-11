## Why

Two things in `gl-journal` do not match the system they describe.

**The journal dates entries in UTC.** All four posting paths derive `journal_entry.entry_date` the
same way:

```ts
entryDate: (payment.paidAt ?? payment.createdAt ?? new Date()).toISOString().slice(0, 10)
```

`toISOString()` is UTC. Every company this system serves runs at UTC+7 — the `company.timezone`
column defaults to `Asia/Bangkok` and exists precisely so that "which day did this happen on" is
answered per company. Its DBML note is explicit: *"ทุก capability ที่ต้องตอบว่า 'เวลานี้อยู่วันไหน'
ต้อง resolve จากคอลัมน์นี้ ไม่ใช่สมมติเป็น UTC"* — every capability that must answer which day an
instant falls on resolves it from this column and does not assume UTC. The GL is the one capability
that assumes UTC.

The consequence is a seven-hour window each day in which entries are dated to the previous day:

```
payment recorded 1 Aug 06:30 in Vientiane (UTC+7)
  = 31 Jul 23:30 UTC
  → entry_date 2026-07-31
  → an August payment lands in the July income statement, July trial balance,
    and July input-VAT summary
```

Inside a month this is a one-day misplacement nobody notices. Across a month-end or a year-end it
moves the figure into the wrong period, and month-end cut-off is the first thing an auditor tests.
It is also the exact class of bug the attendance capability already solved: `company-clock.ts`
exists because *"punch 06:30 ที่ UTC+7 คือ 23:30 UTC ของเมื่อวาน"* silently moved every punch near
midnight onto a different day. The GL has the same bug and none of the fix.

Nothing in `gl-journal`'s spec says what `entry_date` should be, which is why the implementation
was free to be wrong and no scenario caught it.

**The spec's list of system account roles is missing two of the roles it uses.**
`Config-Driven System Account Roles` enumerates `CASH_CLEARING`, `FX_GAIN`, `FX_LOSS`, `INVENTORY`,
`GRNI`, `INVENTORY_ADJUSTMENT`, `INVENTORY_IN_TRANSIT` and `CLAIM_PAYABLE` — but not `VAT_INPUT` or
`WHT_PAYABLE`, which `Posting on Payment Settlement` names two requirements earlier, which
`gl-posting.service.ts` resolves, and which `account_role_type` has carried in the DBML from the
start. An administrator seeding roles from that list gets a company where every VAT-bearing or
WHT-bearing payment fails to post — and by the same requirement's own rule, fails *silently*, as a
logged skip. The list is the checklist for onboarding a company, and it is incomplete.

## What Changes

- `gl-journal` gains a requirement stating that `journal_entry.entry_date` is the calendar day the
  posted event fell on **in the posting company's own `company.timezone`**, never the UTC day, for
  every posting path. The rule is stated once and applies to settlement, approval accrual, claim
  settlement and stock movement alike, because the defect is one derivation repeated four times.
- All four posting paths in `gl-posting.service.ts` resolve their date through a single helper
  instead of `toISOString().slice(0, 10)`.
- `localDateIn` / `localMidnightInstant` move from `back/src/modules/attendance/company-clock.ts` to
  a shared location. The GL must not import from the attendance module, and the function was never
  attendance-specific — it is the repo's answer to "which day is this instant on for this company".
- `Config-Driven System Account Roles` lists `VAT_INPUT` and `WHT_PAYABLE` alongside the other
  roles, with a sentence on what each is for, matching how the inventory roles are already
  described. No behaviour changes — this aligns the spec with the DBML and the code.

Deliberately **out of scope**:

- **Back-dating or correcting entries already posted in the wrong period.** Entries are append-only;
  a correction is a reversing entry plus a re-post, and deciding which historical entries are worth
  moving is a bookkeeping judgement per company, not a migration. This change stops the bleeding
  and states plainly that it does not clean up behind itself.
- **Refusing to post into a closed period.** There is no accounting period yet. When there is, the
  guard belongs at the same seam this change creates, which is one reason to create the seam now.
- **Where `entry_date` comes from when the source carries no timestamp.** The fallbacks
  (`paidAt ?? createdAt ?? now`) are kept exactly as they are; only the timezone the chosen instant
  is read in changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gl-journal`: a new requirement fixes `entry_date` to the company's own calendar day;
  `Config-Driven System Account Roles` lists the two roles it was missing.

## Impact

**Backend**

- `back/src/common/time/company-clock.ts` (moved from
  `back/src/modules/attendance/company-clock.ts`) — `localDateIn` and `localMidnightInstant`, both
  unchanged. Five files import it today; all are updated.
- `back/src/modules/gl/gl-posting.service.ts` — the four `entryDate` derivations at lines 175
  (payment settlement), 262 (approval accrual), 353 (claim settlement) and 483 (stock movement) go
  through one private helper that takes the company and the instant. The company is already loaded
  or referenceable on every path.
- `back/src/modules/gl/gl-posting.service.spec.ts`, `approval-accrual.spec.ts`,
  `stock-posting.spec.ts` — a company at `Asia/Vientiane` with an event instant inside the
  UTC-offset window.

**Specs**

`openspec/specs/gl-journal/spec.md`. No DBML change: `company.timezone` and every
`account_role_type` value this change names already exist.

**Invariants**

None are touched. The entry stays balanced, append-only, company-scoped and idempotent per source;
only the date written on it changes. Invariant 6 (locked FX) is unaffected — no rate is re-read.

**Risk**

Low and one-directional: entries posted after this ships are dated correctly, entries posted before
it are not, so a report spanning the deploy shows both conventions. Worth stating in the release
note. The move of `company-clock.ts` is mechanical but touches the attendance module, whose day
boundaries are load-bearing — the functions must move unchanged, with no signature or behaviour
edit riding along.
