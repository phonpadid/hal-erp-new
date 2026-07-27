import { BadRequestException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { fakeUpload } from '../../test/fake-upload';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import { ProfileService } from './profile.service';
import { AppUser } from './rbac.entities';

const hasDb = await dbAvailable();

// Storage stub — records the written key so a test can assert put/download wiring without S3.
const storageStub = {
  buildProfileImageKey: (kind: string, id: string, file: string) => `profile-images/${kind}/${id}/${file}`,
  putObject: async () => undefined,
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
    // refreshDatabase, not updateSchema — same reason as signature.spec.ts: `beforeEach` wipes
    // app_user, and a document left behind by an earlier run holds a foreign key to a user, so
    // the wipe fails and takes this whole file with it.
    await orm.schema.refreshDatabase();
    service = new ProfileService(orm.em as any, new PasswordService(), new PermissionResolverService(orm.em), storageStub);
  });
  afterAll(async () => orm.close(true));
  beforeEach(async () => orm.em.fork().nativeDelete(AppUser, {}));

  it('uploads and sets the profile image under the user-scoped key, exposed via the profile read', async () => {
    const user = await seedUser('img-upload');
    const res = await service.uploadProfileImage(user.id, fakeUpload('a.png', 'image/png'));
    const key = `profile-images/user/${user.id}/a.png`;
    expect(res.profileImageUrl).toContain(key);

    const reloaded = await orm.em.fork().findOne(AppUser, { id: user.id });
    expect(reloaded!.profileImagePath).toBe(key);

    const profile = await service.getProfile(user.id, null);
    expect(profile.profileImageUrl).toContain(key);
  });

  it('rejects a non-image upload and leaves the profile image path unchanged', async () => {
    const user = await seedUser('img-badtype');
    await expect(service.uploadProfileImage(user.id, fakeUpload('a.pdf', 'application/pdf'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const reloaded = await orm.em.fork().findOne(AppUser, { id: user.id });
    expect(reloaded!.profileImagePath).toBeFalsy();
  });

  it('rejects an oversized upload', async () => {
    const user = await seedUser('img-oversize');
    await expect(
      service.uploadProfileImage(user.id, fakeUpload('a.png', 'image/png', 6 * 1024)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a null profile image URL when none is set', async () => {
    const user = await seedUser('img-none');
    const profile = await service.getProfile(user.id, null);
    expect(profile.profileImageUrl).toBeNull();
  });
});
