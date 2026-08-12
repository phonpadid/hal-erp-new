import { MikroORM } from '@mikro-orm/postgresql';
import { Socket } from 'node:net';
import { LedgerGuardSubscriber } from '../common/ledger/ledger-guard.subscriber';
import * as accounting from '../modules/accounting/accounting.entities';
import * as accountingPeriod from '../modules/accounting/period/accounting-period.entities';
import * as gl from '../modules/gl/gl.entities';
import * as glPosting from '../modules/gl/gl-posting.entities';
import * as journalVoucher from '../modules/gl/journal-voucher.entities';
import * as tax from '../modules/tax/tax.entities';
import * as wht from '../modules/tax/wht.entities';
import * as jobLevel from '../modules/job-level/job-level.entities';
import * as approval from '../modules/approval/approval.entities';
import * as attendance from '../modules/attendance/attendance.entities';
import * as budget from '../modules/budget/budget.entities';
import * as currency from '../modules/currency/currency.entities';
import * as document from '../modules/document/document.entities';
import * as externalApi from '../modules/external-api/external-api.entities';
import * as inventory from '../modules/inventory/inventory.entities';
import * as masterData from '../modules/master-data/master-data.entities';
import * as multiCompany from '../modules/multi-company/multi-company.entities';
import * as notification from '../modules/notification/notification.entities';
import * as payment from '../modules/payment-handoff/payment.entities';
import * as quota from '../modules/quota/quota.entities';
import * as rbac from '../modules/rbac/rbac.entities';
import * as userPreferences from '../modules/user-preferences/user-setting.entities';
import type { EntityClass } from '@mikro-orm/core';

/** All entities as an explicit array (robust under Vitest/SWC). */
export const ALL_ENTITIES = [
  multiCompany,
  rbac,
  currency,
  accounting,
  accountingPeriod,
  gl,
  glPosting,
  journalVoucher,
  tax,
  wht,
  jobLevel,
  attendance,
  budget,
  quota,
  document,
  approval,
  externalApi,
  inventory,
  masterData,
  notification,
  payment,
  userPreferences,
].flatMap((m) => Object.values(m).filter((v) => typeof v === 'function')) as EntityClass<object>[];

const dbConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'erp',
  password: process.env.DB_PASSWORD ?? 'erp',
  // A dedicated, isolated test database. Specs run refreshDatabase() (drop + recreate every
  // table) each run, so this must never default to a database shared with the running app —
  // point DB_NAME elsewhere only at a database reserved for tests.
  dbName: process.env.DB_NAME ?? 'erp_test',
};

/** One TCP connect attempt to the DB port; resolves true on connect, false on timeout/error. */
function probeOnce(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(dbConfig.port, dbConfig.host);
  });
}

/**
 * True when the DB port is reachable, so DB-backed specs run (and skip gracefully when not).
 * A cold Node process can be slow to make its first connection, so we use a generous timeout
 * and a few bounded retries with a short backoff before deciding the DB is absent — this avoids
 * spuriously skipping/failing whole spec files on a fresh process.
 */
export async function dbAvailable(attempts = 3, timeoutMs = 3000): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await probeOnce(timeoutMs)) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Init a MikroORM for tests, optionally with a custom (test-only) entity set. */
export function initTestOrm(entities: EntityClass<object>[] = ALL_ENTITIES) {
  return MikroORM.init({
    ...dbConfig,
    entities,
    entitiesTs: [],
    debug: false,
    allowGlobalContext: true,
    // Mirror the app: enforce append-only ledgers (budget_txn / approval_log).
    subscribers: [new LedgerGuardSubscriber()],
  });
}
