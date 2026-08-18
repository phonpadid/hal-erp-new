import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { DocumentTypeService } from './document-type.service';
import { DocumentType } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The set is closed, spelled one way, and the dispatcher agrees with it.
 *
 * Before this, `post_action` was a free-form varchar: a misspelling configured a document type that
 * approved through every step and did nothing, and the sentinel `'NONE'` was a second stored
 * spelling of "does nothing" that took the same silent branch.
 */
describe.skipIf(!hasDb)('post_action is a closed set (DB-backed)', () => {
  let orm: MikroORM;
  let docTypes: DocumentTypeService;
  let companyA = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    docTypes = new DocumentTypeService(orm.em);
    companyA = (await orm.em.fork().findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  const base = (code: string) => ({ code, name: code, category: 'FINANCE' });

  it('refuses a post-action outside the set, at the database', async () => {
    // The DTO's @IsIn is the first refusal; this is the one underneath it, which survives a seed,
    // a hand-written update, or a migration's down().
    await expect(
      orm.em.fork().getConnection().execute(
        `insert into "document_type" ("id", "company_id", "code", "name", "category", "post_action")
         values (gen_random_uuid(), '${companyA}', 'TYPO', 'Typo', 'FINANCE', 'CUT_BUDET')`,
      ),
    ).rejects.toThrow(/post_action/i);
  });

  it('stores null, not a sentinel, when a type has no post-action', async () => {
    const created = await asA(() => docTypes.create(base('NOACT')));
    const row = await orm.em.fork().findOneOrFail(DocumentType, { id: created.id }, FILTER_OFF);
    expect(row.postAction).toBeNull();

    // And the sentinel the form used to submit is refused like any other non-member.
    await expect(
      orm.em.fork().getConnection().execute(
        `update "document_type" set "post_action" = 'NONE' where "id" = '${created.id}'`,
      ),
    ).rejects.toThrow(/post_action/i);
  });

  it('clears a post-action back to null on update', async () => {
    const created = await asA(() => docTypes.create({ ...base('CLEARME'), postAction: 'CUT_BUDGET' }));
    await asA(() => docTypes.update(created.id, { postAction: null }));
    const row = await orm.em.fork().findOneOrFail(DocumentType, { id: created.id }, FILTER_OFF);
    expect(row.postAction).toBeNull();
  });

  it('refuses a second active POST_JOURNAL type, and allows one once the first is off', async () => {
    // The seed already gives the company its JV type, so this create is the second.
    await expect(asA(() => docTypes.create({ ...base('JV2'), postAction: 'POST_JOURNAL' }))).rejects.toThrow(
      /already has an active 'POST_JOURNAL'/,
    );

    const jv = await orm.em.fork().findOneOrFail(DocumentType, { code: 'JV', company: companyA }, FILTER_OFF);
    await asA(() => docTypes.update(jv.id, { isActive: false }));
    const second = await asA(() => docTypes.create({ ...base('JV3'), postAction: 'POST_JOURNAL' }));
    expect(second.postAction).toBe('POST_JOURNAL');

    // Reactivating the original would give the company two — refused from the other direction.
    await expect(asA(() => docTypes.update(jv.id, { isActive: true }))).rejects.toThrow(
      /already has an active 'POST_JOURNAL'/,
    );
  });

  it('allows two active types carrying the same movement action', async () => {
    // Deliberate, unlike POST_JOURNAL: resolveMovementDocType answers 0/1/many and asks the caller
    // to choose between them.
    const a = await asA(() => docTypes.create({ ...base('TRF2'), postAction: 'TRANSFER' }));
    const b = await asA(() => docTypes.create({ ...base('TRF3'), postAction: 'TRANSFER' }));
    expect([a.postAction, b.postAction]).toEqual(['TRANSFER', 'TRANSFER']);
  });
});
