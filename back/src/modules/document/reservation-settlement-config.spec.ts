import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentTypeService } from './document-type.service';
import { RefChainService } from './ref-chain.service';
import {
  DeptDocType,
  DocumentCategory,
  DocumentType,
  DocumentTypeRef,
  FormTemplate,
} from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A reservation reduces a budget's available balance the moment it is taken, and is only given back
 * by a RELEASE or converted by an ACTUAL. A document type that reserves with no configured route to
 * either consumes the appropriation permanently while recognising nothing — and `budget_txn` is
 * append-only, so it cannot be undone afterwards.
 *
 * The seeded `CLAIM` was exactly that shape: `requires_budget` with no post-action and no reference
 * pairing. It reached COMPLETED holding 50,000 that nothing could release, with no journal entry and
 * no place in the payment queue.
 */
describe.skipIf(!hasDb)('reserving types must have a settlement (DB-backed)', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let chains: RefChainService;
  let deptTypes: DeptDocTypeService;
  let companyId = '';
  let deptId = '';
  let workflowId = '';

  function asCompany<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);
  }

  /** Create a type directly, bypassing the service, so a spec can build a graph to walk. */
  async function seedType(
    code: string,
    over: Partial<DocumentType> = {},
  ): Promise<DocumentType> {
    const em = orm.em.fork();
    const t = em.create(DocumentType, {
      company: em.getReference(Company, companyId),
      code,
      name: code,
      category: DocCategory.FINANCE,
      isActive: true,
      ...over,
    } as never);
    await em.flush();
    return t;
  }

  async function pair(predecessor: DocumentType, successor: DocumentType): Promise<DocumentTypeRef> {
    const em = orm.em.fork();
    const r = em.create(DocumentTypeRef, {
      company: em.getReference(Company, companyId),
      predecessorType: em.getReference(DocumentType, predecessor.id),
      successorType: em.getReference(DocumentType, successor.id),
      autoCreate: false,
    } as never);
    await em.flush();
    return r;
  }

  const create = (code: string, over: Record<string, unknown> = {}) =>
    asCompany(() =>
      types.create({ code, name: code, category: DocCategory.FINANCE, ...over } as never),
    );

  /**
   * Map a type to a department — the moment it becomes raisable, and so the moment the reachability
   * rule binds. Every mapping needs its own form template, since a template belongs to one type.
   */
  async function mapToDepartment(type: DocumentType): Promise<DeptDocType> {
    const em = orm.em.fork();
    const tmpl = em.create(FormTemplate, {
      documentType: em.getReference(DocumentType, type.id),
      version: 1, status: 'ACTIVE',
    } as never);
    await em.flush();
    return asCompany(() =>
      deptTypes.create({
        departmentId: deptId,
        documentTypeId: type.id,
        formTemplateId: tmpl.id,
        workflowId,
      } as never),
    );
  }

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
    const dept = em.create(Department, {
      company: c, deptCode: 'D1', name: 'D1', isActive: true,
    } as never);
    const wf = em.create(Workflow, { company: c, name: 'WF', isActive: true } as never);
    await em.flush();
    deptId = dept.id;
    workflowId = wf.id;
    types = new DocumentTypeService(orm.em);
    chains = new RefChainService(orm.em);
    deptTypes = new DeptDocTypeService(orm.em);
  });

  beforeEach(async () => {
    const em = orm.em.fork();
    await em.nativeDelete(DeptDocType, {}, FILTER_OFF);
    await em.nativeDelete(FormTemplate, {}, FILTER_OFF);
    await em.nativeDelete(DocumentTypeRef, {}, FILTER_OFF);
    await em.nativeDelete(DocumentType, {}, FILTER_OFF);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('refuses to make a reserving type with no settlement raisable', async () => {
    const dead = await seedType('DEADEND', { requiresBudget: true });
    await expect(mapToDepartment(dead)).rejects.toThrow(/no way to settle/i);
  });

  it('lets the type be created — the graph cannot exist yet', async () => {
    // The rule deliberately does NOT bind here. A pairing names two existing types, so a type
    // being created has no edges; refusing it would make the PROC shape unconfigurable, because
    // the pairing that would satisfy the rule needs the type the rule just rejected.
    const t = await create('LATER', { requiresBudget: true });
    expect(t.code).toBe('LATER');
  });

  it('accepts a type that settles its own reservation', async () => {
    const t = await seedType('SELF', { requiresBudget: true, postAction: 'CUT_BUDGET' });
    await expect(mapToDepartment(t)).resolves.toBeTruthy();
  });

  it('accepts a settlement several documents away', async () => {
    // PROC → PO → DISB: the requisition reaches its disbursement through an order, and only the
    // last link settles. A check that looked at direct pairings alone would refuse this.
    const disb = await seedType('DISB', { postAction: 'CUT_BUDGET' });
    const po = await seedType('PO');
    await pair(po, disb);
    const proc = await seedType('PROC', { requiresBudget: true });
    await pair(proc, po);

    await expect(mapToDepartment(proc)).resolves.toBeTruthy();
  });

  it('does not count a path through an inactive type', async () => {
    // Nobody can raise an inactive type, so nothing can arrive by that route.
    const disb = await seedType('DISB', { postAction: 'CUT_BUDGET' });
    const po = await seedType('PO', { isActive: false });
    await pair(po, disb);
    const proc = await seedType('PROC', { requiresBudget: true });
    await pair(proc, po);

    await expect(mapToDepartment(proc)).rejects.toThrow(/no way to settle/i);
  });

  it('leaves an inactive reserving type alone, and bites when it is activated', async () => {
    // An inactive type raises no documents, so it reserves nothing and holds nothing.
    const t = await seedType('SOMEDAY', { requiresBudget: true, isActive: false });
    await expect(asCompany(() => types.update(t.id, { name: 'still off' }))).resolves.toBeTruthy();
    await expect(asCompany(() => types.update(t.id, { isActive: true }))).rejects.toThrow(
      /no way to settle/i,
    );
  });

  it('terminates on a cyclic pairing graph', async () => {
    // Nothing forbids A → B → A in the table, and the naive recursion would not return. If this
    // test hangs rather than fails, the walk lost its `seen` set.
    const a = await seedType('CYC_A', { requiresBudget: true });
    const b = await seedType('CYC_B');
    await pair(a, b);
    await pair(b, a);

    await expect(mapToDepartment(a)).rejects.toThrow(/no way to settle/i);
  });

  it('refuses to remove the pairing that carries the only path', async () => {
    const disb = await seedType('DISB', { postAction: 'CUT_BUDGET' });
    const proc = await seedType('PROC', { requiresBudget: true });
    const edge = await pair(proc, disb);

    await expect(asCompany(() => chains.removePairing(edge.id))).rejects.toThrow(/PROC/);

    // Rolled back: the edge is still there, so the configuration is unchanged by the refusal.
    const em = orm.em.fork();
    expect(await em.findOne(DocumentTypeRef, { id: edge.id }, FILTER_OFF)).not.toBeNull();
  });

  it('allows removing a pairing while another path remains', async () => {
    const disb = await seedType('DISB', { postAction: 'CUT_BUDGET' });
    const alt = await seedType('ALT', { postAction: 'CUT_BUDGET' });
    const proc = await seedType('PROC', { requiresBudget: true });
    const edge = await pair(proc, disb);
    await pair(proc, alt);

    await asCompany(() => chains.removePairing(edge.id));
    const em = orm.em.fork();
    expect(await em.findOne(DocumentTypeRef, { id: edge.id }, FILTER_OFF)).toBeNull();
  });

  it('refuses to deactivate the only settling type on somebody else\'s path', async () => {
    // The graph breaks from either end. Checking only the type being reserved would leave this open.
    const disb = await seedType('DISB', { postAction: 'CUT_BUDGET' });
    const proc = await seedType('PROC', { requiresBudget: true });
    await pair(proc, disb);

    await expect(asCompany(() => types.update(disb.id, { isActive: false }))).rejects.toThrow(
      /PROC/,
    );
  });
});

describe.skipIf(!hasDb)('accruing types settle their own reservation (DB-backed)', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let companyId = '';

  function asCompany<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);
  }
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
    em.create(DocumentCategory, { company: c, code: DocCategory.FINANCE, name: 'F', isActive: true } as never);
    await em.flush();
    types = new DocumentTypeService(orm.em);
  });

  beforeEach(async () => {
    const em = orm.em.fork();
    await em.nativeDelete(DocumentTypeRef, {}, FILTER_OFF);
    await em.nativeDelete(DocumentType, {}, FILTER_OFF);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('refuses an accruing self-reserving type with no settlement of its own', async () => {
    await expect(
      create('CLAIM', { requiresBudget: true, accruesOnApproval: true }),
    ).rejects.toThrow(/settle that reservation itself/i);
  });

  it('accepts it once it settles at its own approval', async () => {
    const t = await create('CLAIM', {
      requiresBudget: true,
      accruesOnApproval: true,
      postAction: 'CUT_BUDGET',
    });
    expect(t.postAction).toBe('CUT_BUDGET');
  });

  it('is not satisfied by a settlement further down the chain', async () => {
    // THE test that proves this rule earns its place beside the reachability one. A paired settler
    // makes the reservation reachable, so reachability alone would wave this configuration through
    // — and it would still be broken, because the accrual runs at THIS approval, before any
    // successor exists, finds no ACTUAL, and records a terminal skip.
    const em = orm.em.fork();
    const settler = em.create(DocumentType, {
      company: em.getReference(Company, companyId),
      code: 'SETTLER', name: 'SETTLER', category: DocCategory.FINANCE,
      isActive: true, postAction: 'CUT_BUDGET',
    } as never);
    const claim = em.create(DocumentType, {
      company: em.getReference(Company, companyId),
      code: 'CLAIM', name: 'CLAIM', category: DocCategory.FINANCE,
      isActive: true, requiresBudget: true, accruesOnApproval: true,
    } as never);
    await em.flush();
    em.create(DocumentTypeRef, {
      company: em.getReference(Company, companyId),
      predecessorType: em.getReference(DocumentType, claim.id),
      successorType: em.getReference(DocumentType, settler.id),
      autoCreate: false,
    } as never);
    await em.flush();

    await expect(asCompany(() => types.update(claim.id, { name: 'CLAIM v2' }))).rejects.toThrow(
      /settle that reservation itself/i,
    );
  });

  it('leaves settling-without-accruing permitted', async () => {
    // PR is one: it settles its own reservation and books nothing until payment. Coherent, and the
    // rule is stated in one direction so it stays allowed.
    const t = await create('PR', { requiresBudget: true, postAction: 'CUT_BUDGET' });
    expect(t.accruesOnApproval).toBe(false);
  });
});
