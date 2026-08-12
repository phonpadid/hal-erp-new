# Record when a period was declared

## Why

A period's log answers who closed it and who reopened it. It cannot answer who declared it, or
when, or with what range — because a declare writes nothing.

`PeriodAction` holds `CLOSE` and `REOPEN`; the migration constrains the column to those two
(`check ("action" in ('CLOSE', 'REOPEN'))`); and `AccountingPeriodService.declare()` creates the
period and flushes without touching the log.

The declare is what fixes a company's book calendar. A period declared 1–31 August when the
company's books run the 26th to the 25th puts every entry in the wrong month, and the correction
leaves no evidence of who set it or when — there is not even an update endpoint, so the only remedy
is direct database surgery, which is invisible by definition.

Every other act on a period is recorded. The one that creates it is not, and the omission is not a
decision anyone made: `period_action` was written when the close was the only act that existed.

The previous change found this and deliberately did not fix it — closing it needs an enum value, a
migration and a DBML change, and that change had promised to alter nothing about what is logged.

## What Changes

- `PeriodAction.DECLARE` in `common/enums` and `period_action` in the DBML.
- A migration widening `accounting_period_log.action`'s check constraint to admit `DECLARE`.
- `declare()` writes its log row in the same transaction that creates the period, so a period can
  never exist without the record of who declared it.
- The log's range is recorded in the reason column, because a declare has no other way to say what
  range was set and the range is the thing worth auditing. See design D2.
- `DECLARE` labels in the three locales; the screen already renders whatever actions it receives.

## What This Change Does NOT Do

- **No backfill.** Periods declared before this change have no declare row and will not get an
  invented one. See design D3.
- No update or delete of a period. There is still no endpoint for either, and this change does not
  add one — it makes the creation auditable, not editable.
- No change to close or reopen.

## Impact

- Affected specs: `accounting-period`, `web-accounting`
- Affected code: `back/src/common/enums/index.ts`, `erp_approval_system.dbml`, a new migration,
  `accounting-period.service.ts`, `front-end/src/api/accountingPeriods.ts`,
  `i18n/locales/{en,la,zh}/gl.ts`
- Migration: yes — one `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT`, no data change.
