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
 * `document_type.records_past_events` — editable, not create-only.
 *
 * `create` has always honoured it, but `update` assigned every other flag and skipped this one, so
 * a type could be born with it set and never have it changed: the edit form's toggle moved, saved,
 * and came back exactly as it was. The flag decides whether a document may state the day its money
 * moved, so a type wrongly born without it had no way back short of an UPDATE by hand.
 */
describe.skipIf(!hasDb)('document-type config: recordsPastEvents round-trip', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let companyId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const c = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    // Document-type create validates its category against an active document_category; seed one.
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

  it('defaults to false and turns on and off again through update', async () => {
    await RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, async () => {
      const created = await types.create({ code: 'HIST', name: 'Historic', category: DocCategory.FINANCE });
      expect(created.recordsPastEvents).toBe(false);

      expect((await types.update(created.id, { recordsPastEvents: true })).recordsPastEvents).toBe(true);
      // Back off again: the flag is a toggle, not a one-way door.
      expect((await types.update(created.id, { recordsPastEvents: false })).recordsPastEvents).toBe(false);
    });
  });

  it('leaves the flag alone when the update does not mention it', async () => {
    await RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, async () => {
      const created = await types.create({
        code: 'HIST2', name: 'Historic 2', category: DocCategory.FINANCE, recordsPastEvents: true,
      });
      const renamed = await types.update(created.id, { name: 'Historic two' });
      expect(renamed.recordsPastEvents).toBe(true);
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[doc-type-records-past-events] no database reachable — skipping DB-backed spec');
}
