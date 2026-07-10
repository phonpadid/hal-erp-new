import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { CompanyService } from './company.service';
import { Company } from './multi-company.entities';

const hasDb = await dbAvailable();

const storageStub = {
  buildProfileImageKey: (kind: string, id: string, file: string) => `profile-images/${kind}/${id}/${file}`,
  presignUpload: async () => 'https://bucket/put',
  presignDownload: async (key: string) => `https://bucket/get/${key}`,
} as any;

describe.skipIf(!hasDb)('CompanyService — profile image (DB-backed)', () => {
  let orm: MikroORM;
  let service: CompanyService;
  let seq = 0;
  const run = Date.now().toString(36); // run-unique so codes don't collide with leftovers

  async function seedCompany(): Promise<Company> {
    return service.create({ code: `CIMG-${run}-${seq++}`, nameTh: 'Co', taxId: '1234567890123', branchCode: '00000', baseCurrency: 'THB' });
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

  it('presigns an upload under the company-scoped key', async () => {
    const c = await seedCompany();
    const res = await service.presignProfileImage(c.id, { fileName: 'logo.png', contentType: 'image/png' });
    expect(res.key).toBe(`profile-images/company/${c.id}/logo.png`);
  });

  it('sets the company image path and returns/reads a view URL', async () => {
    const c = await seedCompany();
    const set = await service.setProfileImage(c.id, { filePath: 'profile-images/company/x/logo.png', mimeType: 'image/png' });
    expect(set.profileImageUrl).toContain('profile-images/company/x/logo.png');

    const reloaded = await orm.em.fork().findOne(Company, { id: c.id });
    expect(reloaded!.profileImagePath).toBe('profile-images/company/x/logo.png');

    expect((await service.profileImageUrl(c.id)).profileImageUrl).toContain('profile-images/company/x/logo.png');
  });

  it('reports a null URL when the company has no image', async () => {
    const c = await seedCompany();
    expect((await service.profileImageUrl(c.id)).profileImageUrl).toBeNull();
  });
});
