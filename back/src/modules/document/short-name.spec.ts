import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { DepartmentService } from '../multi-company/department.service';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from '../multi-company/dto/department.dto';
import { DocumentTypeService } from './document-type.service';
import { DocumentCategory } from './document.entities';
import { CreateDocumentTypeDto, UpdateDocumentTypeDto } from './dto/config.dto';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * `short_name` on `document_type` and `department`: the abbreviation stamped in a paper document
 * number (`1034/ຈຊຈ/ບຫ`). Optional, trimmed, at most 20 characters; an unset one reads null so a
 * renderer knows to fall back to the code rather than printing an empty stamp.
 */
describe('short_name DTO bounds', () => {
  const cases: Array<[string, new () => object, Record<string, unknown>]> = [
    [
      'CreateDocumentTypeDto',
      CreateDocumentTypeDto,
      { code: 'X', name: 'X', category: 'FINANCE' },
    ],
    ['UpdateDocumentTypeDto', UpdateDocumentTypeDto, {}],
    ['CreateDepartmentDto', CreateDepartmentDto, { deptCode: 'X', name: 'X' }],
    ['UpdateDepartmentDto', UpdateDepartmentDto, {}],
  ];

  for (const [name, cls, base] of cases) {
    it(`${name}: trims, accepts 20, refuses 21, and reads blank as null`, async () => {
      const ok = plainToInstance(cls, { ...base, shortName: '  ຈຊຈ ' }) as {
        shortName?: unknown;
      };
      expect(await validate(ok)).toHaveLength(0);
      expect(ok.shortName).toBe('ຈຊຈ');

      expect(
        await validate(
          plainToInstance(cls, { ...base, shortName: 'a'.repeat(20) }),
        ),
      ).toHaveLength(0);
      const long = await validate(
        plainToInstance(cls, { ...base, shortName: 'a'.repeat(21) }),
      );
      expect(long.map((e) => e.property)).toContain('shortName');

      const blank = plainToInstance(cls, { ...base, shortName: '   ' }) as {
        shortName?: unknown;
      };
      expect(await validate(blank)).toHaveLength(0);
      expect(blank.shortName).toBeNull();
    });
  }
});

describe.skipIf(!hasDb)(
  'short_name round-trips through the type and department services',
  () => {
    let orm: MikroORM;
    let types: DocumentTypeService;
    let departments: DepartmentService;
    let companyId = '';

    beforeAll(async () => {
      orm = await initTestOrm(ALL_ENTITIES);
      await orm.schema.refreshDatabase();
      const em = orm.em.fork();
      const c = em.create(Company, {
        code: 'A',
        nameTh: 'A',
        taxId: '1',
        branchCode: '00000',
        isActive: true,
      });
      em.create(DocumentCategory, {
        company: c,
        code: DocCategory.FINANCE,
        name: 'Finance',
        isActive: true,
      });
      await em.flush();
      companyId = c.id;
      types = new DocumentTypeService(orm.em.fork());
      departments = new DepartmentService(new CompanyScopeService(orm.em));
    });

    afterAll(async () => {
      if (orm) {
        await orm.schema.dropSchema();
        await orm.close(true);
      }
    });

    const run = <T>(fn: () => Promise<T>) =>
      RequestContext.run(
        { userId: 'u', companyId, departmentId: 'd', grants: [] },
        fn,
      );

    it('a document type stores, reads back, and clears its abbreviation', async () => {
      await run(async () => {
        const created = await types.create({
          code: 'PR',
          name: 'ໃບສະເໜີ',
          category: DocCategory.FINANCE,
        });
        expect(created.shortName ?? null).toBeNull();

        expect(
          (await types.update(created.id, { shortName: 'ຈຊຈ' })).shortName,
        ).toBe('ຈຊຈ');
        // The code is untouched by the stamp.
        expect((await types.get(created.id)).code).toBe('PR');
        // An update that does not mention it leaves it alone; null clears it.
        expect(
          (await types.update(created.id, { name: 'renamed' })).shortName,
        ).toBe('ຈຊຈ');
        expect(
          (await types.update(created.id, { shortName: null })).shortName ??
            null,
        ).toBeNull();
      });
    });

    it('a department stores, reads back, and clears its abbreviation', async () => {
      await run(async () => {
        const created = await departments.create({
          deptCode: 'ADM',
          name: 'ພະແນກບໍລິຫານ',
        });
        expect(created.shortName ?? null).toBeNull();

        expect(
          (await departments.update(created.id, { shortName: 'ບຫ' })).shortName,
        ).toBe('ບຫ');
        expect((await departments.get(created.id)).deptCode).toBe('ADM');
        expect(
          (await departments.update(created.id, { name: 'renamed' })).shortName,
        ).toBe('ບຫ');
        expect(
          (await departments.update(created.id, { shortName: null }))
            .shortName ?? null,
        ).toBeNull();
      });
    });
  },
);

if (!hasDb) {
  console.warn('[short-name] no database reachable — skipping DB-backed spec');
}
