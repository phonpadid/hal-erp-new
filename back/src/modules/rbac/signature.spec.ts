import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { AppUser, UserSignature } from './rbac.entities';
import { SignatureService } from './signature.service';
import { PresignSignatureDto, RegisterSignatureDto } from './dto/signature.dto';

const hasDb = await dbAvailable();

// A stub StorageService — the presign/getObject internals talk to S3 and are not under test
// here; register() never touches storage (it only records the object key + metadata).
const storageStub = {
  buildUserSignatureKey: (userId: string, fileName: string) => `signatures/${userId}/${fileName}`,
  presignUpload: async () => 'https://bucket.example/put',
  presignDownload: async (key: string) => `https://bucket.example/get/${encodeURIComponent(key)}`,
} as any;

// DTO-boundary rules (the global ValidationPipe enforces these before the service runs).
describe('Signature DTO rules (image allow-list)', () => {
  it('rejects a non-image contentType on presign', async () => {
    const dto = plainToInstance(PresignSignatureDto, { fileName: 's.pdf', contentType: 'application/pdf' });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('accepts png/jpeg on presign', async () => {
    for (const contentType of ['image/png', 'image/jpeg']) {
      const dto = plainToInstance(PresignSignatureDto, { fileName: 's.png', contentType });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rejects a non-image mimeType on register', async () => {
    const dto = plainToInstance(RegisterSignatureDto, { filePath: 'signatures/u/s.gif', mimeType: 'image/gif' });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejects an oversized signature on register', async () => {
    const dto = plainToInstance(RegisterSignatureDto, {
      filePath: 'signatures/u/s.png',
      mimeType: 'image/png',
      fileSizeKb: 999_999,
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});

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

  it('records the first upload and points current_signature_id at it', async () => {
    const user = await seedUser('sig-first');
    const result = await service.register(user.id, { filePath: 'signatures/a/1.png', mimeType: 'image/png' });

    expect(result.hasSignature).toBe(true);
    const reloaded = await orm.em.fork().findOne(AppUser, { id: user.id });
    expect(reloaded!.currentSignatureId).toBe(result.signature!.id);
  });

  it('keeps the previous signature row/file immutable when replacing', async () => {
    const user = await seedUser('sig-replace');
    const first = await service.register(user.id, { filePath: 'signatures/a/1.png', mimeType: 'image/png' });
    const second = await service.register(user.id, { filePath: 'signatures/a/2.png', mimeType: 'image/png' });

    expect(second.signature!.id).not.toBe(first.signature!.id);
    const em = orm.em.fork();
    // The old row still exists and its file_path is unchanged (never overwritten).
    const oldRow = await em.findOne(UserSignature, { id: first.signature!.id });
    expect(oldRow).not.toBeNull();
    expect(oldRow!.filePath).toBe('signatures/a/1.png');
    // current now points at the new row.
    const reloaded = await em.findOne(AppUser, { id: user.id });
    expect(reloaded!.currentSignatureId).toBe(second.signature!.id);
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
