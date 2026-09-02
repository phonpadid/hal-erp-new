import { BadRequestException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { fakeUpload } from '../../test/fake-upload';
import { Currency } from '../currency/currency.entities';
import { CompanyService } from './company.service';
import { Company } from './multi-company.entities';

const hasDb = await dbAvailable();

const storageStub = {
  buildProfileImageKey: (kind: string, id: string, file: string) => `profile-images/${kind}/${id}/${file}`,
  putObject: async () => undefined,
  presignDownload: async (key: string) => `https://bucket/get/${key}`,
} as any;

describe.skipIf(!hasDb)('CompanyService — profile image (DB-backed)', () => {
  let orm: MikroORM;
  let service: CompanyService;
  let seq = 0;
  const run = Date.now().toString(36); // run-unique so codes don't collide with leftovers

  async function seedCompany(): Promise<Company> {
    return service.create({ code: `CIMG-${run}-${seq++}`, nameTh: 'Co', taxId: '1234567890123', branchCode: '00000', baseCurrency: 'THB', timezone: 'Asia/Bangkok' });
  }

  beforeAll(async () => {
    orm = await initTestOrm();
    await orm.getSchemaGenerator().updateSchema();
    const em = orm.em.fork();
    if (!(await em.findOne(Currency, { code: 'THB' }))) {
      await em.persistAndFlush(em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true }));
    }
    service = new CompanyService(orm.em as any, storageStub);
  });
  afterAll(async () => orm.close(true));

  it('uploads and sets the company image under the company-scoped key, readable as a view URL', async () => {
    const c = await seedCompany();
    const key = `profile-images/company/${c.id}/logo.png`;
    const set = await service.uploadProfileImage(c.id, fakeUpload('logo.png', 'image/png'));
    expect(set.profileImageUrl).toContain(key);

    const reloaded = await orm.em.fork().findOne(Company, { id: c.id });
    expect(reloaded!.profileImagePath).toBe(key);

    expect((await service.profileImageUrl(c.id)).profileImageUrl).toContain(key);
  });

  it('rejects a non-image upload and leaves the company image path unchanged', async () => {
    const c = await seedCompany();
    await expect(service.uploadProfileImage(c.id, fakeUpload('logo.pdf', 'application/pdf'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const reloaded = await orm.em.fork().findOne(Company, { id: c.id });
    expect(reloaded!.profileImagePath).toBeFalsy();
  });

  it('reports a null URL when the company has no image', async () => {
    const c = await seedCompany();
    expect((await service.profileImageUrl(c.id)).profileImageUrl).toBeNull();
  });
});
