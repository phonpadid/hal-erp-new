import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { STOCK_POST_ACTIONS } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { DocumentTypeService } from './document-type.service';
import { DocumentCategory, DocumentType } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Several `document_type` flags mean nothing unless another flag on the SAME row is set, and
 * nothing said so. Each of these was found by asking, for every flag, where it is read at runtime
 * and what that read is gated behind:
 *
 *   requires_payee          the submit check demands the payee belong to document.vendor, and the
 *                           client's picker loads from the vendor — so without requires_vendor the
 *                           required field can never be filled
 *   a stock post_action     the whole warehouse gate sits inside `if (docType.requiresWarehouse)`,
 *                           so without it the checks are SKIPPED and the reservation runs on an
 *                           undefined warehouse. Verified by experiment: 500, ValidationError,
 *                           rolled back
 *   accrues_on_approval     the accrual reads ACTUAL budget rows — its own without a vendor, the
 *                           charged ancestor's with one — so a type with neither has no source and
 *                           records a terminal skip
 */
describe.skipIf(!hasDb)('a flag needs its prerequisite (DB-backed)', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let companyId = '';

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);

  const create = (code: string, over: Record<string, unknown> = {}) =>
    asCompany(() =>
      types.create({ code, name: code, category: DocCategory.FINANCE, ...over } as never),
    );

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const c = em.create(Company, {
      code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true,
    } as never);
    await em.flush();
    companyId = c.id;
    for (const code of [DocCategory.FINANCE, DocCategory.PROCUREMENT, DocCategory.HR, DocCategory.ADMIN]) {
      em.create(DocumentCategory, { company: c, code, name: code, isActive: true } as never);
    }
    await em.flush();
    types = new DocumentTypeService(orm.em);
  });

  beforeEach(async () => {
    await orm.em.fork().nativeDelete(DocumentType, {}, FILTER_OFF);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('a payee needs a vendor', () => {
    it('refuses a payee requirement with no vendor requirement', async () => {
      await expect(create('PAYONLY', { requiresPayee: true })).rejects.toThrow(BadRequestException);
    });

    it('names the vendor requirement as what is missing', async () => {
      // Either flag could be the one the administrator meant; adding the prerequisite is the far
      // more common fix, so the message points at what is absent.
      await expect(create('PAYONLY2', { requiresPayee: true })).rejects.toThrow(/vendor/i);
    });

    it('accepts a payee alongside a vendor', async () => {
      const t = await create('DISB', { requiresPayee: true, requiresVendor: true });
      expect(t.requiresPayee).toBe(true);
    });
  });

  describe('a stock post-action needs a warehouse', () => {
    it.each([...STOCK_POST_ACTIONS])('refuses %s without a warehouse requirement', async (action) => {
      await expect(create(`NOWH_${action}`, { postAction: action })).rejects.toThrow(/warehouse/i);
    });

    it('refuses ADJUST_STOCK too, which reserves nothing', async () => {
      // The case a rule shaped around RESERVING_ACTIONS would wave through. An adjustment holds no
      // stock but must still say which shelf it corrects.
      expect(STOCK_POST_ACTIONS).toContain('ADJUST_STOCK');
      await expect(create('ADJ', { postAction: 'ADJUST_STOCK' })).rejects.toThrow(/warehouse/i);
    });

    it.each([...STOCK_POST_ACTIONS])('accepts %s once a warehouse is required', async (action) => {
      const t = await create(`WH_${action}`, { postAction: action, requiresWarehouse: true });
      expect(t.requiresWarehouse).toBe(true);
    });

    it('leaves a non-stock post-action alone', async () => {
      const t = await create('PLAIN', { postAction: 'UPDATE_EMPLOYEE' });
      expect(t.requiresWarehouse).toBe(false);
    });
  });

  describe('an accrual needs a source for the charge', () => {
    it('refuses accruing with neither budget nor vendor', async () => {
      await expect(create('NOSRC', { accruesOnApproval: true })).rejects.toThrow(BadRequestException);
    });

    it('names both sources it could have had', async () => {
      await expect(create('NOSRC2', { accruesOnApproval: true })).rejects.toThrow(/budget.*vendor|vendor.*budget/is);
    });

    it('accepts accruing on its own budget — the CLAIM shape', async () => {
      // requires_budget + accrues also needs a settling post-action, from the earlier change.
      const t = await create('CLAIM', {
        accruesOnApproval: true, requiresBudget: true, postAction: 'CUT_BUDGET',
      });
      expect(t.accruesOnApproval).toBe(true);
    });

    it('accepts accruing with a vendor and no budget of its own — the DISB shape', async () => {
      // Its charge comes from the ancestor its reference chain reaches. Whether that chain actually
      // reaches a reserving predecessor is a question about the pairing graph, not about this row,
      // and is deliberately not decided here.
      const t = await create('DISB2', {
        accruesOnApproval: true, requiresVendor: true, requiresPayee: true, postAction: 'CUT_BUDGET',
      });
      expect(t.requiresBudget).toBe(false);
    });
  });

  describe('binding', () => {
    it('refuses REMOVING a prerequisite, not only never setting one', async () => {
      const t = await create('BOTH', { requiresPayee: true, requiresVendor: true });
      await expect(
        asCompany(() => types.update(t.id, { requiresVendor: false } as never)),
      ).rejects.toThrow(/vendor/i);

      const after = await orm.em.fork().findOneOrFail(DocumentType, { id: t.id }, FILTER_OFF);
      expect(after.requiresVendor).toBe(true);
    });

    it('leaves an inactive type alone, and bites when it is activated', async () => {
      // An inactive type raises no documents, so an incoherent one harms nothing until it can.
      const em = orm.em.fork();
      const t = em.create(DocumentType, {
        company: em.getReference(Company, companyId),
        code: 'SOMEDAY', name: 'Someday', category: DocCategory.FINANCE,
        requiresPayee: true, isActive: false,
      } as never);
      await em.flush();

      await expect(asCompany(() => types.update(t.id, { name: 'still off' }))).resolves.toBeTruthy();
      await expect(asCompany(() => types.update(t.id, { isActive: true }))).rejects.toThrow(/vendor/i);
    });
  });
});
