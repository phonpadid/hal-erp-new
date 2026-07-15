import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { fakeUpload } from '../../test/fake-upload';
import { AppUser, UserSignature } from './rbac.entities';
import { SignatureService } from './signature.service';

const hasDb = await dbAvailable();

// A stub StorageService — putObject/getObject internals talk to S3 and are not under test here.
const storageStub = {
  buildUserSignatureKey: (userId: string, fileName: string) => `signatures/${userId}/${fileName}`,
  putObject: async () => undefined,
  presignDownload: async (key: string) => `https://bucket.example/get/${encodeURIComponent(key)}`,
} as any;

describe.skipIf(!hasDb)('SignatureService (DB-backed)', () => {
  let orm: MikroORM;
  let service: SignatureService;

  async function seedUser(username: string): Promise<AppUser> {
    const em = orm.em.fork();
    const user = em.create(AppUser, {
      username,
      email: `${username}@example.com`,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(user);
    return user;
  }

  beforeAll(async () => {
    orm = await initTestOrm();
    await orm.getSchemaGenerator().updateSchema();
    service = new SignatureService(orm.em as any, storageStub);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    // user_signature first (it FKs app_user); neither table is company-scoped.
    await orm.em.fork().nativeDelete(UserSignature, {});
    await orm.em.fork().nativeDelete(AppUser, {});
  });

  it('rejects a non-image upload with a validation error and creates no row', async () => {
    const user = await seedUser('sig-badtype');
    await expect(service.upload(user.id, fakeUpload('s.gif', 'image/gif'))).rejects.toBeInstanceOf(BadRequestException);
    expect(await orm.em.fork().count(UserSignature, { user: user.id })).toBe(0);
  });

  it('rejects an oversized signature (> 1 MB)', async () => {
    const user = await seedUser('sig-oversize');
    await expect(service.upload(user.id, fakeUpload('s.png', 'image/png', 2048))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('records the first upload and points current_signature_id at it', async () => {
    const user = await seedUser('sig-first');
    const result = await service.upload(user.id, fakeUpload('1.png', 'image/png'));

    expect(result.hasSignature).toBe(true);
    const reloaded = await orm.em.fork().findOne(AppUser, { id: user.id });
    expect(reloaded!.currentSignatureId).toBe(result.signature!.id);
  });

  it('keeps the previous signature row/file immutable when replacing', async () => {
    const user = await seedUser('sig-replace');
    const first = await service.upload(user.id, fakeUpload('1.png', 'image/png'));
    const second = await service.upload(user.id, fakeUpload('2.png', 'image/png'));

    expect(second.signature!.id).not.toBe(first.signature!.id);
    const em = orm.em.fork();
    // The old row still exists and its file_path is unchanged (never overwritten).
    const oldRow = await em.findOne(UserSignature, { id: first.signature!.id });
    expect(oldRow).not.toBeNull();
    expect(oldRow!.filePath).toBe(`signatures/${user.id}/1.png`);
    // current now points at the new row.
    const reloaded = await em.findOne(AppUser, { id: user.id });
    expect(reloaded!.currentSignatureId).toBe(second.signature!.id);
  });

  // Concurrency: the row lock serializes the two DB writes so current_signature_id ends up
  // pointing at one fully-written row (never a half-written one), and both rows are persisted.
  it('leaves current_signature_id pointing at a fully-written row under concurrent uploads', async () => {
    const user = await seedUser('sig-concurrent');
    const [a, b] = await Promise.all([
      service.upload(user.id, fakeUpload('a.png', 'image/png')),
      service.upload(user.id, fakeUpload('b.png', 'image/png')),
    ]);

    const em = orm.em.fork();
    const reloaded = await em.findOne(AppUser, { id: user.id });
    const winner = reloaded!.currentSignatureId;
    expect([a.signature!.id, b.signature!.id]).toContain(winner);
    // Both rows exist (neither upload was lost); the winner resolves to a real row.
    expect(await em.count(UserSignature, { user: user.id })).toBe(2);
    expect(await em.findOne(UserSignature, { id: winner! })).not.toBeNull();
  });

  it('returns an empty state when the user has no signature', async () => {
    const user = await seedUser('sig-none');
    const result = await service.getCurrent(user.id);
    expect(result).toEqual({ hasSignature: false, signature: null });
  });

  it('reads only the signed-in user (unknown id is rejected)', async () => {
    await expect(service.getCurrent('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
