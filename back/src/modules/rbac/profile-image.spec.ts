import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import { ProfileService } from './profile.service';
import { AppUser } from './rbac.entities';

const hasDb = await dbAvailable();

// Storage stub — echoes keys so a test can assert presign/download wiring without S3.
const storageStub = {
  buildProfileImageKey: (kind: string, id: string, file: string) => `profile-images/${kind}/${id}/${file}`,
  presignUpload: async () => 'https://bucket/put',
  presignDownload: async (key: string) => `https://bucket/get/${key}`,
} as any;

describe.skipIf(!hasDb)('ProfileService — profile image (DB-backed)', () => {
  let orm: MikroORM;
  let service: ProfileService;

  async function seedUser(username: string): Promise<AppUser> {
    const em = orm.em.fork();
    const user = em.create(AppUser, { username, email: `${username}@x`, status: 'ACTIVE', emailVerifiedAt: new Date() });
    await em.persistAndFlush(user);
    return user;
  }

  beforeAll(async () => {
    orm = await initTestOrm();
    await orm.getSchemaGenerator().updateSchema();
    service = new ProfileService(orm.em as any, new PasswordService(), new PermissionResolverService(orm.em), storageStub);
  });
  afterAll(async () => orm.close(true));
  beforeEach(async () => orm.em.fork().nativeDelete(AppUser, {}));

  it('presigns an upload under the user-scoped key', async () => {
    const user = await seedUser('img-presign');
    const res = await service.presignProfileImage(user.id, { fileName: 'a.png', contentType: 'image/png' });
    expect(res.key).toBe(`profile-images/user/${user.id}/a.png`);
    expect(res.uploadUrl).toBe('https://bucket/put');
  });

  it('sets the profile image path and exposes it via the profile read', async () => {
    const user = await seedUser('img-set');
    const set = await service.setProfileImage(user.id, { filePath: 'profile-images/user/x/a.png', mimeType: 'image/png' });
    expect(set.profileImageUrl).toContain('profile-images/user/x/a.png');

    const reloaded = await orm.em.fork().findOne(AppUser, { id: user.id });
    expect(reloaded!.profileImagePath).toBe('profile-images/user/x/a.png');

    const profile = await service.getProfile(user.id, null);
    expect(profile.profileImageUrl).toContain('profile-images/user/x/a.png');
  });

  it('reports a null profile image URL when none is set', async () => {
    const user = await seedUser('img-none');
    const profile = await service.getProfile(user.id, null);
    expect(profile.profileImageUrl).toBeNull();
  });
});
