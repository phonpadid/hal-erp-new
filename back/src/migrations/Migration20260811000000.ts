import { Migration } from '@mikro-orm/migrations';

/**
 * Drop `budget.control_policy`.
 *
 * The tolerance ladder on `budget_control_point` decides how strictly spending is checked. Keeping
 * a per-budget policy alongside it would let the two disagree with no rule for which wins, and by
 * now nothing reads the column: the reservation path evaluates the control point's ladder, and
 * budget creation takes a ladder directly.
 *
 * ORDER MATTERS. Migration20260810000000 READ this column to build each seeded control point's
 * ladder — `HARD_STOP` became block-at-100, `SOFT_WARNING` became warn-at-100. Dropping it before
 * that migration has run would leave those control points unseeded, and the budgets they cover
 * unchecked. The migrator applies these in filename order, which is the only thing keeping that
 * safe, so it is written down here rather than left to the numbering.
 *
 * The `control_policy` ENUM TYPE stays. `quota.control_policy` (sick leave must warn, not block)
 * and `work_location.control_policy` (geofence) both still use it and are untouched.
 */
export class Migration20260811000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "budget" drop column if exists "control_policy";`);
  }

  override async down(): Promise<void> {
    // Restores the column and its original default, but not per-budget intent: by the time this
    // ran forward, that intent had already been copied into the control points, and a budget's
    // ladder can no longer be reduced to one of two values — a ladder may warn at 80 and block at
    // 110, which neither HARD_STOP nor SOFT_WARNING can express.
    this.addSql(
      `alter table "budget" add column "control_policy" text check ("control_policy" in ('HARD_STOP', 'SOFT_WARNING')) not null default 'HARD_STOP';`,
    );
  }
}
