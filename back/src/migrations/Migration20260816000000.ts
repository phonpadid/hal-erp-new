import { Migration } from '@mikro-orm/migrations';

/**
 * Let a period's log record the act that creates it.
 *
 * `accounting_period_log` recorded closes and reopens because those were the only acts that existed
 * when it was written. The declare — the act that fixes a company's book calendar, and the one whose
 * range every later figure depends on — wrote nothing, so a period's history began at its first
 * close and could never say who set its dates.
 *
 * The constraint is widened and NO data is written. Periods declared before this could have a row
 * fabricated from `accounting_period.created_at`, and deliberately do not: the actor is unknown —
 * the period carries no created_by — so the row would have to name somebody who may not have done
 * it. An audit trail whose oldest entries are guesses is worse than one that begins where the
 * recording began.
 */
export class Migration20260816000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "accounting_period_log" drop constraint if exists "accounting_period_log_action_check";`,
    );
    this.addSql(
      `alter table "accounting_period_log" add constraint "accounting_period_log_action_check" ` +
        `check ("action" in ('DECLARE', 'CLOSE', 'REOPEN'));`,
    );
  }

  /**
   * Narrowing back refuses if any DECLARE row exists, rather than dropping the constraint and
   * leaving rows the schema forbids. A down migration that cannot honestly reverse should say so
   * where it runs, not fail later somewhere else.
   */
  override async down(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if exists (select 1 from "accounting_period_log" where "action" = 'DECLARE') then
          raise exception 'Cannot narrow accounting_period_log.action: DECLARE rows exist. Remove them first, knowing that doing so destroys audit records.';
        end if;
      end $$;
    `);
    this.addSql(
      `alter table "accounting_period_log" drop constraint if exists "accounting_period_log_action_check";`,
    );
    this.addSql(
      `alter table "accounting_period_log" add constraint "accounting_period_log_action_check" ` +
        `check ("action" in ('CLOSE', 'REOPEN'));`,
    );
  }
}
