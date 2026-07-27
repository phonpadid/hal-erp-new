import { Migration } from '@mikro-orm/migrations';

/**
 * Recognising a compensation when it is approved, not when it is paid.
 *
 * The GL posts when a disbursement settles. A damaged-parcel claim never settles one: its payee is
 * a customer rather than a vendor, so the type carries `requires_payee = false` and the money
 * leaves through finance's bank app. The budget report would show the year's claims and the
 * profit-and-loss would show nothing — one system answering the same question two ways.
 *
 * There is an accounting reason to post earlier regardless. Approving a claim is the moment the
 * obligation arises and its amount is fixed; payment only settles the liability it created. This
 * is the same shape `GRNI` already models for goods — a liability standing between an obligation
 * incurred and money paid — which is why `CLAIM_PAYABLE` joins it rather than inventing a
 * mechanism.
 *
 * `document_type.accrues_on_approval` is opt-in and defaults to false, so every existing type keeps
 * today's behaviour. It is deliberately its own flag: `post_action = CUT_BUDGET` would catch every
 * PR, and `requires_payee = false` would catch every requisition that simply does not know its
 * payee yet. Neither of them was asked about recognition.
 *
 * `account_role.role` is text with a CHECK listing the allowed roles, so admitting a new role means
 * replacing that constraint — the one part of this migration that is not a plain addition. The
 * rewritten list is the old one plus `CLAIM_PAYABLE`; no existing row can violate it.
 */
export class Migration20260805000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "document_type" add column "accrues_on_approval" boolean not null default false;`,
    );
    this.addSql(`alter table "account_role" drop constraint if exists "account_role_role_check";`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_role_check" check (` +
        `"role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS', 'VAT_INPUT', 'WHT_PAYABLE', ` +
        `'INVENTORY', 'GRNI', 'INVENTORY_ADJUSTMENT', 'INVENTORY_IN_TRANSIT', 'CLAIM_PAYABLE'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "account_role" drop constraint if exists "account_role_role_check";`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_role_check" check (` +
        `"role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS', 'VAT_INPUT', 'WHT_PAYABLE', ` +
        `'INVENTORY', 'GRNI', 'INVENTORY_ADJUSTMENT', 'INVENTORY_IN_TRANSIT'));`,
    );
    this.addSql(`alter table "document_type" drop column if exists "accrues_on_approval";`);
  }
}
