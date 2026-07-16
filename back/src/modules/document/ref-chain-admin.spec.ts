import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { DocCategory } from '../../common/enums';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { RefChainService } from './ref-chain.service';
import { DocumentType } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('ref-chain admin: pairing management (DB-backed)', () => {
  let orm: MikroORM;
  let refChain: RefChainService;
  let companyA = '';
  let companyBType = ''; // a document type owned by another company
  const t = { PR: '', PO: '', PROC: '', DISB: '', MEMO: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    refChain = new RefChainService(orm.em);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    for (const code of Object.keys(t) as (keyof typeof t)[]) {
      t[code] = (await em.findOneOrFail(DocumentType, { code }, FILTER_OFF)).id;
    }
    // A second company with its own document type, to prove cross-company pairings are rejected.
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const companyB = em.create(Company, { code: 'OTHER', nameTh: 'Other', taxId: '9', branchCode: '00000', baseCurrency: thb, isActive: true });
    const bType = em.create(DocumentType, { company: companyB, code: 'PR', name: 'PR-B', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, isActive: true });
    await em.flush();
    companyBType = bType.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  function asA<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);
  }

  it('lists a type as both a predecessor (successors) and a successor (predecessors)', async () => {
    // Seed baseline: PR→PO and PROC→PO and PO→DISB exist.
    const po = await asA(() => refChain.listForType(t.PO));
    expect(po.predecessors.map((p) => p.predecessorCode).sort()).toEqual(['PR', 'PROC']);
    expect(po.successors.map((p) => p.successorCode)).toEqual(['DISB']);
  });

  it('adds a new pairing (MEMO→PO) and it appears in the listing', async () => {
    const created = await asA(() => refChain.addPairing({ predecessorTypeId: t.MEMO, successorTypeId: t.PO }));
    expect(created.id).toBeDefined();
    const po = await asA(() => refChain.listForType(t.PO));
    expect(po.predecessors.map((p) => p.predecessorCode).sort()).toEqual(['MEMO', 'PR', 'PROC']);
    // Clean up so the seed baseline is unaffected for other assertions.
    await asA(() => refChain.removePairing(created.id));
    const after = await asA(() => refChain.listForType(t.PO));
    expect(after.predecessors.map((p) => p.predecessorCode).sort()).toEqual(['PR', 'PROC']);
  });

  it('creates a pairing with auto_create and toggles it', async () => {
    const created = await asA(() => refChain.addPairing({ predecessorTypeId: t.MEMO, successorTypeId: t.PO, autoCreate: true }));
    expect(created.autoCreate).toBe(true);
    // The successor listing for MEMO reflects the flag.
    const memo = await asA(() => refChain.listForType(t.MEMO));
    expect(memo.successors.find((p) => p.successorCode === 'PO')?.autoCreate).toBe(true);
    // Toggle it off via PATCH.
    const updated = await asA(() => refChain.setAutoCreate(created.id, { autoCreate: false }));
    expect(updated.autoCreate).toBe(false);
    const memo2 = await asA(() => refChain.listForType(t.MEMO));
    expect(memo2.successors.find((p) => p.successorCode === 'PO')?.autoCreate).toBe(false);
    await asA(() => refChain.removePairing(created.id));
  });

  it('rejects a duplicate pairing with a conflict', async () => {
    await expect(
      asA(() => refChain.addPairing({ predecessorTypeId: t.PR, successorTypeId: t.PO })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a self-pairing', async () => {
    await expect(
      asA(() => refChain.addPairing({ predecessorTypeId: t.PR, successorTypeId: t.PR })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a pairing whose successor belongs to another company (isolation)', async () => {
    await expect(
      asA(() => refChain.addPairing({ predecessorTypeId: t.PR, successorTypeId: companyBType })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not find a type from another company when listing', async () => {
    await expect(asA(() => refChain.listForType(companyBType))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not remove a pairing from another company', async () => {
    await expect(asA(() => refChain.removePairing('00000000-0000-0000-0000-000000000000'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
