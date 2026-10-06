import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { DocumentTypeService } from './document-type.service';
import { DocumentCategory } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * `document_type.letter_addressee` — the column behind "who is this type's letter addressed to".
 *
 * These are about STORAGE, not about printing: what the renderer does with the value is pinned in
 * `document-pdf.spec.ts`. The one rule worth a database to prove is that blank is an absence —
 * "cleared" and "never set" must be a single state, or the letter has two spellings of "address the
 * managing director" and only one of them prints it.
 */
describe.skipIf(!hasDb)('document-type config: letterAddressee round-trip', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let companyId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const c = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    em.create(DocumentCategory, { company: c, code: DocCategory.FINANCE, name: 'Finance', isActive: true });
    await em.flush();
    companyId = c.id;
    types = new DocumentTypeService(orm.em.fork());
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);

  it('is absent on a type that names nobody, which is every type by default', async () => {
    await asUser(async () => {
      const created = await types.create({ code: 'PR1', name: 'Request', category: DocCategory.FINANCE });
      expect(created.letterAddressee).toBeUndefined();
    });
  });

  it('stores an addressee, and clears it again through update', async () => {
    await asUser(async () => {
      const created = await types.create({
        code: 'PRFI1', name: 'Data request', category: DocCategory.FINANCE,
        letterAddressee: 'ພະແນກພັດທະນາເທັກໂນໂລຊີ',
      });
      expect(created.letterAddressee).toBe('ພະແນກພັດທະນາເທັກໂນໂລຊີ');

      // Clearing is a state the admin form can reach, so it has to return the type to the default
      // wording rather than to a blank recipient.
      expect((await types.update(created.id, { letterAddressee: null })).letterAddressee).toBeUndefined();
    });
  });

  it('treats blank and whitespace as "not set", on create and on update alike', async () => {
    await asUser(async () => {
      // A field cleared to a single space would otherwise store a value, and the letter would print
      // `ຮຽນ: .` — set in the form, nothing on the page.
      const created = await types.create({
        code: 'PRFI2', name: 'Blank', category: DocCategory.FINANCE, letterAddressee: '   ',
      });
      expect(created.letterAddressee).toBeUndefined();

      await types.update(created.id, { letterAddressee: 'ພະແນກພັດທະນາເທັກໂນໂລຊີ' });
      expect((await types.update(created.id, { letterAddressee: '  ' })).letterAddressee).toBeUndefined();
    });
  });

  it('trims what it stores, so leading space never reaches the page', async () => {
    await asUser(async () => {
      const created = await types.create({
        code: 'PRFI3', name: 'Padded', category: DocCategory.FINANCE,
        letterAddressee: '  ພະແນກພັດທະນາເທັກໂນໂລຊີ  ',
      });
      expect(created.letterAddressee).toBe('ພະແນກພັດທະນາເທັກໂນໂລຊີ');
    });
  });

  it('leaves the value alone when the update does not mention it', async () => {
    await asUser(async () => {
      const created = await types.create({
        code: 'PRFI4', name: 'Kept', category: DocCategory.FINANCE,
        letterAddressee: 'ພະແນກພັດທະນາເທັກໂນໂລຊີ',
      });
      const renamed = await types.update(created.id, { name: 'Kept two' });
      expect(renamed.letterAddressee).toBe('ພະແນກພັດທະນາເທັກໂນໂລຊີ');
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[doc-type-letter-addressee] no database reachable — skipping DB-backed spec');
}
