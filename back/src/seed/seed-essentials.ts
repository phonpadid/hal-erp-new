import { Currency } from '../modules/currency/currency.entities';
import { NotificationTemplate } from '../modules/notification/notification.entities';
import { syncPermissionCatalog } from './seed-data';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * The rows a production database cannot function without, and nothing else.
 *
 * The test for inclusion is narrow and deliberate: a row belongs here only if the CODE ITSELF is
 * written in TypeScript and the running application resolves it by that code. Those are not a
 * customer's data — they are the application's own vocabulary, and an environment missing them is
 * broken in a way no administrator can fix from the product.
 *
 * Everything else `seedDatabase` creates is a DEMO: a company called "HAL Co" with a zeroed tax id,
 * departments, a fiscal year, work shifts, vendors, items, warehouses, workflows, document types,
 * a chart of accounts, a budget of 1,000,000, leave quotas — and users `admin` / `approver` /
 * `requester` / the seven approval-chain accounts, every one of them sharing a password committed
 * to this repository and pre-marked email-verified. On a real installation that is not a helpful
 * starting point; it is ten loginable accounts nobody created.
 *
 * So the two are separate functions, not one function with a flag. A flag can be passed wrongly.
 *
 * Idempotent and additive: an existing row is left exactly as it is, including one whose code no
 * longer appears in the source. An unattended command that runs on production should add what is
 * missing, never decide what should disappear.
 *
 *   pnpm --filter back seed:prod        # this function
 *   pnpm --filter back seed             # this function too — `seeder:run` refuses demo data
 *                                       # unless SEED_DEMO=true (see database.seeder.ts)
 */
export async function seedEssentials(em: EntityManager): Promise<EssentialsReport> {
  const permissions = await syncPermissionCatalog(em);
  const currencies = await seedCurrencies(em);
  const templates = await seedNotificationTemplates(em);

  await em.flush();

  return { permissions: permissions.size, currencies, templates };
}

export interface EssentialsReport {
  permissions: number;
  currencies: number;
  templates: number;
}

/**
 * The currencies this deployment transacts in.
 *
 * Reference data rather than a customer's choice: a company cannot be created without a base
 * currency, and `decimal_places` is what stops money being rendered — or worse, rounded — wrongly.
 * LAK at zero decimals is the one that bites if it is missing or guessed.
 *
 * Deliberately NOT the exchange rate the demo seeds. A rate is a VALUE, not vocabulary, and a made
 * up USD→THB of 35 on a production database would be stamped onto documents and then never
 * recomputed (invariant 6, locked FX). Rates are entered by whoever owns them.
 */
async function seedCurrencies(em: EntityManager): Promise<number> {
  const rows: Array<[string, string, string, number]> = [
    ['LAK', 'Lao Kip', '₭', 0],
    ['THB', 'Thai Baht', '฿', 2],
    ['USD', 'US Dollar', '$', 2],
  ];

  let created = 0;

  for (const [code, name, symbol, decimalPlaces] of rows) {
    const found = await em.findOne(Currency, { code }, { filters: { company: false } });

    if (found) continue;

    em.persist(em.create(Currency, { code, name, symbol, decimalPlaces, isActive: true }));
    created++;
  }

  return created;
}

/**
 * The notification templates the code addresses by code.
 *
 * `NotificationService` looks a template up by its code when a document changes hands. A missing
 * row means the approver is never told — which is indistinguishable, from the outside, from a
 * system that simply lost the document. Silence is the failure mode, so these have to exist before
 * the first submit, not after someone notices.
 *
 * The wording is a starting point and is meant to be edited in the product; this only guarantees a
 * row exists.
 */
async function seedNotificationTemplates(em: EntityManager): Promise<number> {
  const rows: Array<[string, string, string]> = [
    [
      'DOC_PENDING_APPROVAL',
      'Pending approval',
      'Document {doc_no} from {requester_name} awaits your approval.',
    ],
    ['DOC_REJECTED', 'Document rejected', 'Document {doc_no} was rejected.'],
    ['DOC_COMPLETED', 'Document approved', 'Document {doc_no} has been approved.'],
    ['SLA_OVERDUE', 'Approval overdue', 'Document {doc_no} is overdue for approval.'],
  ];

  let created = 0;

  for (const [code, subjectTemplate, bodyTemplate] of rows) {
    const found = await em.findOne(
      NotificationTemplate,
      { code },
      { filters: { company: false } },
    );

    if (found) continue;

    em.persist(
      em.create(NotificationTemplate, {
        code,
        channel: 'IN_APP',
        subjectTemplate,
        bodyTemplate,
        isActive: true,
      }),
    );
    created++;
  }

  return created;
}
