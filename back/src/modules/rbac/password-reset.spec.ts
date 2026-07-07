import { createHash } from 'node:crypto';
import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { AppUser, PasswordResetToken } from './rbac.entities';
import type { EmailTransport } from '../notification/transports/transport';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/** Pull the raw token out of the reset link the service emailed. */
function tokenFromEmail(text: string): string {
  const m = /token=([^\s]+)/.exec(text);
  if (!m) throw new Error('no token in email body');
  return m[1]!;
}

describe.skipIf(!hasDb)('PasswordResetService (DB-backed)', () => {
  let orm: MikroORM;
  let service: PasswordResetService;
  let sendMail: ReturnType<typeof vi.fn>;
  const passwords = new PasswordService();

  async function seedUser(over: Partial<AppUser> = {}): Promise<AppUser> {
    const em = orm.em.fork();
    const user = em.create(AppUser, {
      username: over.username ?? 'alice',
      email: over.email ?? 'alice@example.com',
      passwordHash: await passwords.hash('OldPass123'),
      status: over.status ?? 'ACTIVE',
    });
    await em.persistAndFlush(user);
    return user;
  }

  beforeAll(async () => {
    orm = await initTestOrm();
    await orm.schema.refreshDatabase();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(async () => {
    await orm.em.fork().nativeDelete(PasswordResetToken, {});
    await orm.em.fork().nativeDelete(AppUser, {});
    sendMail = vi.fn().mockResolvedValue(undefined);
    const email = { sendMail } as unknown as EmailTransport;
    service = new PasswordResetService(orm.em, passwords, email);
  });

  describe('requestReset (anti-enumeration)', () => {
    it('creates a token and emails the link when an ACTIVE user matches', async () => {
      const user = await seedUser({ username: 'bob', email: 'bob@example.com' });

      await service.requestReset('bob');

      const tokens = await orm.em.fork().find(PasswordResetToken, { user: user.id });
      expect(tokens).toHaveLength(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0]![0]).toBe('bob@example.com');
    });

    it('matches by email too', async () => {
      await seedUser({ username: 'carol', email: 'carol@example.com' });
      await service.requestReset('carol@example.com');
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('does nothing for an unknown identifier (no token, no email)', async () => {
      await seedUser();
      await service.requestReset('nobody@example.com');

      const tokens = await orm.em.fork().find(PasswordResetToken, {});
      expect(tokens).toHaveLength(0);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('does nothing for an inactive account', async () => {
      await seedUser({ username: 'dan', status: 'INACTIVE' });
      await service.requestReset('dan');

      const tokens = await orm.em.fork().find(PasswordResetToken, {});
      expect(tokens).toHaveLength(0);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('supersedes older tokens: a second request invalidates the first', async () => {
      const user = await seedUser();
      await service.requestReset('alice');
      const firstToken = tokenFromEmail(sendMail.mock.calls[0]![2]);

      await service.requestReset('alice');

      // the first token can no longer be used
      expect(await service.verifyToken(firstToken)).toBe(false);
      // exactly one outstanding (unconsumed) token remains
      const outstanding = await orm.em.fork().find(PasswordResetToken, {
        user: user.id,
        consumedAt: null,
      });
      expect(outstanding).toHaveLength(1);
    });
  });

  describe('verifyToken', () => {
    it('returns true for a fresh token and does not consume it', async () => {
      await seedUser();
      await service.requestReset('alice');
      const raw = tokenFromEmail(sendMail.mock.calls[0]![2]);

      expect(await service.verifyToken(raw)).toBe(true);
      // still usable (not consumed) after verifying
      expect(await service.verifyToken(raw)).toBe(true);
    });

    it('returns false for an expired token', async () => {
      const user = await seedUser();
      const em = orm.em.fork();
      const raw = 'expired-raw-token';
      em.create(PasswordResetToken, {
        user,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
      });
      await em.flush();

      expect(await service.verifyToken(raw)).toBe(false);
    });

    it('returns false for a consumed token', async () => {
      const user = await seedUser();
      const em = orm.em.fork();
      const raw = 'consumed-raw-token';
      em.create(PasswordResetToken, {
        user,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        createdAt: new Date(),
      });
      await em.flush();

      expect(await service.verifyToken(raw)).toBe(false);
    });

    it('returns false for an unknown token', async () => {
      expect(await service.verifyToken('never-issued')).toBe(false);
    });
  });

  describe('setNewPassword', () => {
    it('updates the hash, consumes the token, and lets the user log in with the new password', async () => {
      const user = await seedUser();
      await service.requestReset('alice');
      const raw = tokenFromEmail(sendMail.mock.calls[0]![2]);

      await service.setNewPassword(raw, 'BrandNew123');

      const fresh = await orm.em.fork().findOneOrFail(AppUser, { id: user.id });
      expect(await passwords.verify('BrandNew123', fresh.passwordHash!)).toBe(true);
      expect(await passwords.verify('OldPass123', fresh.passwordHash!)).toBe(false);
      // token is now consumed and cannot be reused
      expect(await service.verifyToken(raw)).toBe(false);
      await expect(service.setNewPassword(raw, 'Another123')).rejects.toThrow();
    });

    it('rejects an expired token without changing the password', async () => {
      const user = await seedUser();
      const em = orm.em.fork();
      const raw = 'expired-set-token';
      em.create(PasswordResetToken, {
        user,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
      });
      await em.flush();

      await expect(service.setNewPassword(raw, 'BrandNew123')).rejects.toThrow();
      const fresh = await orm.em.fork().findOneOrFail(AppUser, { id: user.id });
      expect(await passwords.verify('OldPass123', fresh.passwordHash!)).toBe(true);
    });

    // Concurrency: two simultaneous set-password calls with the same token —
    // the pessimistic lock guarantees the token is consumed at most once.
    it('lets exactly one of two concurrent set-password calls win (single-use)', async () => {
      const user = await seedUser();
      await service.requestReset('alice');
      const raw = tokenFromEmail(sendMail.mock.calls[0]![2]);

      const results = await Promise.allSettled([
        service.setNewPassword(raw, 'Winner0001'),
        service.setNewPassword(raw, 'Winner0002'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const fresh = await orm.em.fork().findOneOrFail(AppUser, { id: user.id });
      const oneWon =
        (await passwords.verify('Winner0001', fresh.passwordHash!)) ||
        (await passwords.verify('Winner0002', fresh.passwordHash!));
      expect(oneWon).toBe(true);
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[password-reset] no database reachable — skipping DB-backed spec');
}
