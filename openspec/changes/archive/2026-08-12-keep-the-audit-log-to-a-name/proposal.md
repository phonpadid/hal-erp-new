# Keep the audit log to a name

## Why

`AttendancePeriodService.log()` populates `actedBy` and returns the rows as they are, so every read
of a period's audit trail ships the acting user's whole account — including `email`.

```ts
return em.find(
  AttendancePeriodLog,
  { period: periodId },
  { ...FILTER_OFF, populate: ['actedBy'], orderBy: { actedAt: 'ASC' } },
);
```

`passwordHash` is `hidden` and never serialized, so the exposure is not a credential leak. It is
still more than the read needs, and more than its own client expects: `AttendancePeriodLogRow` in
the api client already declares

```ts
actedBy: { id: string; username: string };
```

and `AttendancePeriodDetailView` renders `data.actedBy?.username` and nothing else. The contract the
client writes down is the narrow one; the server is the only party that disagrees with it.

The accounting period log, added two changes ago, returns exactly that projection. That change
noted this endpoint as the precedent it was deliberately departing from, and said it would not be
edited there — a drive-by change to another capability is unreviewable inside one about accounting.
This is that edit, made where it can be reviewed on its own.

## What Changes

- `AttendancePeriodService.log()` projects to `{ id, action, actedAt, reason, actedBy: { id,
  username } }`, matching what its client already types and what the accounting log already returns.
- Nothing on the client. The type is already correct; this makes the server agree with it.

## What This Change Does NOT Do

- No change to what is logged, when, or by whom.
- No sweep of other endpoints that populate a user. There may be more — this one is fixed because a
  previous change identified it precisely and left it named. A survey of the rest is worth doing and
  is not this change.

## Impact

- Affected specs: `attendance-period`
- Affected code: `back/src/modules/attendance/attendance-period.service.ts`
- No migration, no API shape change from the client's point of view — the client's declared shape is
  what it now receives.
