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
 * `print_templates` is an ordered list drawn from a closed set, with one spelling of "the default".
 *
 * The column decides which layouts the exporter renders, so a value nobody renders would be a
 * document type that prints nothing — the same silent failure a free-form `post_action` used to
 * allow. The DTO's `@IsIn` refuses first; these cover the refusal underneath it, the default that
 * keeps every pre-existing type printing the letter it printed before, and the ordering that keeps
 * a receipt from printing ahead of the request it settles.
 */
describe.skipIf(!hasDb)('print_templates configuration (DB-backed)', () => {
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

  it('defaults a type that names no template to the official letter', async () => {
    const created = await asA(() => docTypes.create(base('PT_DEFAULT')));
    const row = await orm.em.fork().findOneOrFail(DocumentType, { id: created.id }, FILTER_OFF);
    expect(row.sheets()).toEqual(['LETTER']);
  });

  it('stores the chosen sheet', async () => {
    const created = await asA(() => docTypes.create({ ...base('PT_PR'), printTemplates: ['PR'] }));
    const row = await orm.em.fork().findOneOrFail(DocumentType, { id: created.id }, FILTER_OFF);
    expect(row.sheets()).toEqual(['PR']);
  });

  it('lets two types of one company print the same sheet', async () => {
    await asA(() => docTypes.create({ ...base('PT_PR_A'), printTemplates: ['PR'] }));
    await asA(() => docTypes.create({ ...base('PT_PR_B'), printTemplates: ['PR'] }));
    const rows = await orm.em
      .fork()
      .find(DocumentType, { company: companyA, code: { $in: ['PT_PR_A', 'PT_PR_B'] } }, FILTER_OFF);
    expect(rows.map((r) => r.sheets())).toEqual([['PR'], ['PR']]);
  });

  it('changes the sheet on update without touching anything else', async () => {
    const created = await asA(() => docTypes.create(base('PT_UPD')));
    await asA(() => docTypes.update(created.id, { printTemplates: ['RECEIPT'] }));
    const row = await orm.em.fork().findOneOrFail(DocumentType, { id: created.id }, FILTER_OFF);
    expect(row.sheets()).toEqual(['RECEIPT']);
    expect(row.code).toBe('PT_UPD');
  });

  it('prints several sheets for one type, in print order', async () => {
    // HAL's purchase request is filed as the official letter AND as the purchase-request form.
    const created = await asA(() =>
      docTypes.create({ ...base('PT_MULTI'), printTemplates: ['PR', 'LETTER'] }),
    );
    const row = await orm.em.fork().findOneOrFail(DocumentType, { id: created.id }, FILTER_OFF);
    // Stored in print order, not in the order they were ticked.
    expect(row.sheets()).toEqual(['LETTER', 'PR']);
  });

  it('refuses a template outside the set, at the database', async () => {
    // Underneath the DTO's @IsIn: this refusal survives a seed, a hand-written update, or a
    // migration that puts a value back.
    await expect(
      orm.em.fork().getConnection().execute(
        `insert into "document_type" ("id", "company_id", "code", "name", "category", "print_templates")
         values (gen_random_uuid(), '${companyA}', 'PT_TYPO', 'Typo', 'FINANCE', 'INVOICE')`,
      ),
    ).rejects.toThrow(/print_templates/i);
  });

  it('refuses a list containing a template outside the set', async () => {
    await expect(
      orm.em.fork().getConnection().execute(
        `insert into "document_type" ("id", "company_id", "code", "name", "category", "print_templates")
         values (gen_random_uuid(), '${companyA}', 'PT_TYPO2', 'Typo', 'FINANCE', 'LETTER,INVOICE')`,
      ),
    ).rejects.toThrow(/print_templates/i);
  });

  it('never stores null for the sheet', async () => {
    await expect(
      orm.em.fork().getConnection().execute(
        `insert into "document_type" ("id", "company_id", "code", "name", "category", "print_templates")
         values (gen_random_uuid(), '${companyA}', 'PT_NULL', 'Null', 'FINANCE', null)`,
      ),
    ).rejects.toThrow(/print_templates/i);
  });
});
