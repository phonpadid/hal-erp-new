import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AppUser } from '../rbac/rbac.entities';
import { UserSettingService } from './user-setting.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('user-setting persistence (DB-backed)', () => {
  let orm: MikroORM;
  let svc: UserSettingService;
  let userA = '';
  let userB = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    svc = new UserSettingService(orm.em);

    const em = orm.em.fork();
    const a = em.create(AppUser, { username: 'ua', email: 'ua@demo.local', passwordHash: 'x', status: 'ACTIVE', createdAt: new Date() });
    const b = em.create(AppUser, { username: 'ub', email: 'ub@demo.local', passwordHash: 'x', status: 'ACTIVE', createdAt: new Date() });
    await em.flush();
    userA = a.id;
    userB = b.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('returns defaults when the user has no row', async () => {
    const s = await svc.getForUser(userA);
    expect(s).toMatchObject({ preset: 'Aura', primary: 'brandRed', darkTheme: false, locale: 'la' });
  });

  it('first PUT creates the row with only sent fields applied over defaults', async () => {
    await svc.upsertForUser(userA, { primary: 'blue', darkTheme: true });
    const s = await svc.getForUser(userA);
    expect(s.primary).toBe('blue');
    expect(s.darkTheme).toBe(true);
    expect(s.surface).toBe('stone'); // untouched default
  });

  it('a partial PUT changes only the sent field', async () => {
    await svc.upsertForUser(userA, { locale: 'en' });
    const s = await svc.getForUser(userA);
    expect(s.locale).toBe('en');
    expect(s.primary).toBe('blue'); // unchanged from before
    expect(s.darkTheme).toBe(true);
  });

  it('settings are isolated per user', async () => {
    const s = await svc.getForUser(userB);
    expect(s.primary).toBe('brandRed'); // B never wrote → defaults, not A's 'blue'
  });
});
