import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityManager } from '@mikro-orm/postgresql';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus, TaxKind } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Workflow } from '../approval/approval.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AccountRoleService } from '../gl/account-role.service';
import { JournalEntry, JournalLine } from '../gl/gl.entities';
import { SOURCE_WHT_REMITTANCE } from '../gl/gl-posting.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { TaxCode } from './tax.entities';
import { WhtCertificate } from './wht.entities';
import { WhtService } from './wht.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The tax withheld from vendors: the certificate the payee is owed, and the money the authority is.
 *
 * `WHT_PAYABLE` was credited at every withholding payment and debited nowhere, so the liability grew
 * for the life of the system while the company was in fact paying it over every month.
 */
describe.skipIf(!hasDb)('withholding tax (DB-backed)', () => {
  let orm: MikroORM;
  let wht: WhtService;
  let companyId = '';
  let userId = '';
  let whtCodeId = '';
  let seq = 0;

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId, departmentId: 'd', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    wht = new WhtService(
      orm.em as EntityManager,
      scope,
      new AccountRoleService(orm.em),
      new PeriodGuardService(),
    );

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
    // Reuse the seeded WHT code rather than minting one: `(company, code)` is unique, and a fixture
    // that duplicates a seeded code tests the fixture.
    whtCodeId = (await em.findOneOrFail(
      TaxCode, { company: companyId, kind: TaxKind.WHT }, { ...FILTER_OFF, orderBy: { code: 'ASC' } },
    )).id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  /** A settled payment that withheld `amount` on a base of `baseLocked` minus its VAT. */
  async function paid(baseLocked: string, whtAmount: string, baseTaxTotal = '0'): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const type = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(
      DeptDocType,
      { department: dept.id, documentType: type.id },
      { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] },
    );
    const doc = em.create(Document, {
      docNo: `WHT-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: type, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId), status: DocStatus.COMPLETED,
      baseTotalAmount: baseLocked, baseTaxTotal, createdAt: new Date(),
    } as never);
    await em.flush();
    const payment = em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked, baseActual: baseLocked,
      fxDelta: '0.00', fxKind: 'NONE', whtAmount,
      whtTaxCode: Number(whtAmount) > 0 ? em.getReference(TaxCode, whtCodeId) : undefined,
      paidAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    return payment.id;
  }

  const remittanceEntry = (remittanceId: string) =>
    orm.em.fork().findOne(
      JournalEntry,
      { sourceType: SOURCE_WHT_REMITTANCE, sourceId: remittanceId },
      { ...FILTER_OFF, populate: ['lines', 'lines.account'] },
    );

  describe('certifying', () => {
    it('issues a certificate carrying the rate, the base and the amount', async () => {
      const paymentId = await paid('107000.00', '3000.00', '7000.00');
      const cert = await asCompany(() => wht.certify(paymentId, '2026-04-05'));

      expect(cert.certificateNo).toMatch(/^WHT-2026-\d{4}$/);
      expect(cert.whtAmount).toBe('3000.00');
      // The base is the pre-VAT net, which is the basis the withholding was computed on.
      expect(Number(cert.baseAmount)).toBe(100000);
      expect(Number(cert.rate)).toBe(0.03);
      expect(cert.issuedOn).toBe('2026-04-05');
    });

    it('refuses a payment that withheld nothing', async () => {
      const paymentId = await paid('50000.00', '0');
      await expect(asCompany(() => wht.certify(paymentId))).rejects.toThrow(/withheld no tax/i);
    });

    it('certifies a payment once', async () => {
      const paymentId = await paid('20000.00', '600.00');
      const first = await asCompany(() => wht.certify(paymentId));
      await expect(asCompany(() => wht.certify(paymentId))).rejects.toThrow(
        new RegExp(first.certificateNo),
      );
    });

    it('gives concurrent issues different numbers', async () => {
      // The repository rule for anything that issues a number: the counter row is taken under a
      // write lock, so two issues cannot read the same value.
      const ids = await Promise.all([paid('1000.00', '30.00'), paid('2000.00', '60.00')]);
      const [a, b] = await Promise.all(ids.map((id) => asCompany(() => wht.certify(id))));
      expect(a.certificateNo).not.toBe(b.certificateNo);
    });

    it('refuses a payment of another company', async () => {
      const em = orm.em.fork();
      const base = await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF);
      const other = em.create(Company, {
        code: 'WHTO', nameTh: 'Other', taxId: '7', branchCode: '00000',
        baseCurrency: base.baseCurrency, isActive: true, createdAt: new Date(),
      } as never);
      await em.flush();

      const paymentId = await paid('9000.00', '270.00');
      const foreign = <T>(fn: () => Promise<T>) =>
        RequestContext.run({ userId, companyId: other.id, departmentId: 'd', grants: [] }, fn);
      await expect(foreign(() => wht.certify(paymentId))).rejects.toThrow(/not found/i);
    });
  });

  describe('remitting', () => {
    it('clears the payable by the certificates total, and stamps them', async () => {
      const certs = await Promise.all(
        ['100.00', '250.00', '400.00'].map(async (amount, i) => {
          const paymentId = await paid(`${(i + 1) * 10000}.00`, amount);
          return asCompany(() => wht.certify(paymentId));
        }),
      );

      const result = await asCompany(() =>
        wht.remit({ certificateIds: certs.map((c) => c.id), remittedOn: '2026-05-07' }),
      );
      expect(Number(result.total)).toBe(750);

      const entry = await remittanceEntry(result.remittanceId);
      const side = (s: 'debit' | 'credit') =>
        entry!.lines.getItems().reduce((t: number, l: JournalLine) => t + Number(l[s]), 0);
      // Balanced, and equal to what was filed rather than to whatever sat in the account.
      expect(side('debit')).toBe(750);
      expect(side('credit')).toBe(750);
      expect(entry!.entryDate).toBe('2026-05-07');

      const stamped = await orm.em.fork().find(
        WhtCertificate, { id: { $in: certs.map((c) => c.id) } }, FILTER_OFF,
      );
      expect(stamped.every((c) => c.remittanceId === result.remittanceId)).toBe(true);
      expect(stamped.every((c) => c.remittedOn === '2026-05-07')).toBe(true);
    });

    it('refuses a certificate already remitted', async () => {
      const paymentId = await paid('30000.00', '900.00');
      const cert = await asCompany(() => wht.certify(paymentId));
      await asCompany(() => wht.remit({ certificateIds: [cert.id], remittedOn: '2026-05-08' }));

      await expect(
        asCompany(() => wht.remit({ certificateIds: [cert.id], remittedOn: '2026-06-08' })),
      ).rejects.toThrow(new RegExp(cert.certificateNo));
    });

    it('posts once when the same remittance is delivered twice', async () => {
      const paymentId = await paid('40000.00', '1200.00');
      const cert = await asCompany(() => wht.certify(paymentId));
      const remittanceId = '11111111-2222-3333-4444-555555555555';

      await asCompany(() =>
        wht.remit({ certificateIds: [cert.id], remittedOn: '2026-05-09', remittanceId }),
      );
      // A retry hits the already-remitted refusal, and the entry stays single either way.
      await asCompany(() =>
        wht.remit({ certificateIds: [cert.id], remittedOn: '2026-05-09', remittanceId }),
      ).catch(() => undefined);

      const entries = await orm.em.fork().find(
        JournalEntry, { sourceType: SOURCE_WHT_REMITTANCE, sourceId: remittanceId }, FILTER_OFF,
      );
      expect(entries).toHaveLength(1);
    });

    it('reports what is still owed as the certificates not yet stamped', async () => {
      const before = await asCompany(() => wht.outstanding());
      const paymentId = await paid('60000.00', '1800.00');
      const cert = await asCompany(() => wht.certify(paymentId));

      const after = await asCompany(() => wht.outstanding());
      expect(after.items.map((c) => c.id)).toContain(cert.id);
      expect(Number(after.total)).toBe(Number(before.total) + 1800);

      await asCompany(() => wht.remit({ certificateIds: [cert.id], remittedOn: '2026-05-10' }));
      const settled = await asCompany(() => wht.outstanding());
      expect(settled.items.map((c) => c.id)).not.toContain(cert.id);
      expect(Number(settled.total)).toBe(Number(before.total));
    });

    it('refuses an empty remittance', async () => {
      await expect(
        asCompany(() => wht.remit({ certificateIds: [], remittedOn: '2026-05-11' })),
      ).rejects.toThrow(/at least one certificate/i);
    });
  });
});
