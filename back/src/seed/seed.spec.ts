import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../test/test-orm';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../common/storage/storage.service';
import { Budget } from '../modules/budget/budget.entities';
import { DeptDocType, DocumentType } from '../modules/document/document.entities';
import { WorkflowStep } from '../modules/approval/approval.entities';
import { MembershipService } from '../modules/rbac/membership.service';
import { PasswordService } from '../modules/rbac/password.service';
import { PermissionResolverService } from '../modules/rbac/permission-resolver.service';
import { RbacAuthService } from '../modules/rbac/rbac-auth.service';
import { AppUser, Permission } from '../modules/rbac/rbac.entities';
import { STOCK_POST_ACTIONS } from '@erp/shared';
import { reservationCanBeSettled } from '../modules/document/ref-chain.config';
import { DEMO_PASSWORD, seedDatabase } from './seed-data';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('seed-bootstrap-data (DB-backed)', () => {
  let orm: MikroORM;
  let jwt: JwtService;
  let auth: RbacAuthService;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    jwt = new JwtService({ secret: 'seed-test', signOptions: { expiresIn: '1h' } });
    auth = new RbacAuthService(
      orm.em,
      new PasswordService(),
      new PermissionResolverService(orm.em),
      new MembershipService(orm.em),
      new AuthService(jwt),
      new StorageService(),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('makes the system loginable with resolved permissions', async () => {
    const res = await auth.login('admin', DEMO_PASSWORD);
    expect(res.accessToken).toBeTruthy();
    const payload = jwt.verify<JwtPayload>(res.accessToken!);
    expect(payload.companyId).toBeTruthy();
    const codes = payload.grants.map((g) => g.code);
    expect(codes).toContain('DOC_APPROVE');
    expect(codes).toContain('BUDGET_MANAGE');
  });

  it('grants notification recipients NOTIFICATION_VIEW so they can see their inbox', async () => {
    const res = await auth.login('approver', DEMO_PASSWORD);
    const payload = jwt.verify<JwtPayload>(res.accessToken!);
    expect(payload.grants.map((g) => g.code)).toContain('NOTIFICATION_VIEW');
  });

  it('seeds a budget-controlled PR ready to submit and route', async () => {
    const em = orm.em.fork();
    const pr = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    expect(pr.requiresBudget).toBe(true);
    expect(pr.postAction).toBe('CUT_BUDGET');
    expect(await em.findOne(DeptDocType, { documentType: pr.id }, FILTER_OFF)).not.toBeNull();
    expect(await em.findOne(WorkflowStep, { stepNo: 1 }, FILTER_OFF)).not.toBeNull();
    expect(await em.find(Budget, {}, FILTER_OFF)).not.toHaveLength(0);
  });

  it('leaves every reserving type with a way to settle its reservation', async () => {
    // The seeded CLAIM used to reserve its own budget with no post-action and no reference pairing,
    // so an approved claim held its appropriation forever: no ACTUAL to release it, no accrual (the
    // accrual reads ACTUAL rows and terminally skips when there are none), and therefore no place in
    // the payment queue. Asserted over EVERY reserving type rather than CLAIM alone — the point is
    // the shape, not the one instance of it.
    const em = orm.em.fork();
    const reserving = await em.find(DocumentType, { requiresBudget: true, isActive: true }, FILTER_OFF);
    expect(reserving.length).toBeGreaterThan(0);
    for (const type of reserving) {
      const settleable = await reservationCanBeSettled(em, type.company.id, type);
      expect(settleable, `${type.code} reserves budget with no way to settle it`).toBe(true);
    }
  });

  it('settles a compensation claim at its own approval, so its accrual has rows to read', async () => {
    const em = orm.em.fork();
    const claim = await em.findOneOrFail(DocumentType, { code: 'CLAIM' }, FILTER_OFF);
    expect(claim.requiresBudget).toBe(true);
    expect(claim.accruesOnApproval).toBe(true);
    // Recognising at approval and converting the reservation at approval are one event in two
    // ledgers. Without the settling action the GL says "recognised" and the budget says "reserved".
    expect(claim.postAction).toBe('CUT_BUDGET');
  });

  it('ships no document type whose flags lack their prerequisite', async () => {
    // The reference configuration is what those rules were written against, so a rule that refuses
    // it is wrong. Asserted over every active type rather than the three that prompted each rule.
    const em = orm.em.fork();
    const active = await em.find(DocumentType, { isActive: true }, FILTER_OFF);
    expect(active.length).toBeGreaterThan(0);
    for (const t of active) {
      expect(!t.requiresPayee || t.requiresVendor, `${t.code}: payee without vendor`).toBe(true);
      expect(
        !(t.postAction && STOCK_POST_ACTIONS.includes(t.postAction)) || t.requiresWarehouse,
        `${t.code}: moves stock without requiring a warehouse`,
      ).toBe(true);
      expect(
        !t.accruesOnApproval || t.requiresBudget || t.requiresVendor,
        `${t.code}: accrues with no source for the charge`,
      ).toBe(true);
    }
  });

  it('is idempotent — re-running creates no duplicates', async () => {
    const count = async () => {
      const em = orm.em.fork();
      return {
        perms: (await em.find(Permission, {}, FILTER_OFF)).length,
        users: (await em.find(AppUser, {}, FILTER_OFF)).length,
      };
    };
    const before = await count();
    await seedDatabase(orm.em.fork());
    const after = await count();
    expect(after).toEqual(before);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[seed] no database reachable — skipping DB-backed spec');
}
