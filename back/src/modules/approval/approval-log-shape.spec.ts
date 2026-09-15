import { MikroORM } from '@mikro-orm/postgresql';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES } from '../../test/test-orm';
import { ApproveAction } from '../../common/enums';
import { RequestContext } from '../../common/context/request-context';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { ApprovalController } from './approval.controller';

/**
 * The approval log is the one approval endpoint an external API key may read — the claim
 * integration guide tells the other system to poll it for the reason a claim was rejected.
 * It used to return the populated AppUser entity, which carried the bcrypt password hash out
 * to that caller. These tests hold both halves of the fix: the entity never serializes the
 * hash, and the endpoint returns a shape written down rather than whatever the entity happens
 * to have.
 *
 * No database: metadata discovery and the controller's mapping are both offline concerns.
 */
describe('approval log never leaks an account', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: ALL_ENTITIES,
      dbName: 'unused',
      connect: false,
      discovery: { warnWhenNoEntities: false },
    });
  });

  it('drops passwordHash from a serialized user', () => {
    const user = orm.em.fork().create(AppUser, {
      username: 'dept_head',
      email: 'dept_head@example.test',
      status: 'ACTIVE',
      passwordHash: '$2a$10$notARealHashButShapedLikeOne',
    });

    const serialized = JSON.parse(JSON.stringify(user)) as Record<string, unknown>;

    expect(serialized.username).toBe('dept_head');
    expect(serialized).not.toHaveProperty('passwordHash');
  });

  it('returns only the promised fields, with the approver reduced to a name', async () => {
    const controller = controllerOver([ENTRY]);

    const [row] = await asApiKey(() => controller.log('d1'));

    expect(Object.keys(row).sort()).toEqual(
      ['actedAt', 'action', 'approver', 'delegatedFrom', 'id', 'remark', 'stepNo'].sort(),
    );
    expect(row.approver).toEqual({ id: 'u1', username: 'dept_head' });
    expect(row.delegatedFrom).toBeNull();
    // The whole payload, not just the approver — a signature id or a nested document would
    // widen the contract the guide makes with the caller.
    expect(JSON.stringify(row)).not.toContain('secret');
    expect(JSON.stringify(row)).not.toContain('s1');
  });
});

const APPROVER = { id: 'u1', username: 'dept_head', passwordHash: 'secret', email: 'a@b.c' };
const ENTRY = {
  id: 'l1',
  document: { id: 'd1' },
  stepNo: 1,
  action: ApproveAction.APPROVE,
  remark: 'ตรวจสอบแล้ว',
  actedAt: new Date('2026-07-27T09:56:51.414Z'),
  approver: APPROVER,
  delegatedFrom: undefined,
  signature: { id: 's1' },
};

/**
 * A controller over a fixed log, with the two reads the endpoint makes stubbed by entity: the
 * document (for its company), and the employees whose names are being resolved.
 */
function controllerOver(entries: unknown[], employees: Array<{ user: { id: string }; fullName: string }> = []) {
  const em = {
    fork: () => fork,
  };
  const fork = {
    find: async (entity: unknown) => {
      if (entity === Employee) return employees;
      if (entity === AppUser) return [{ id: APPROVER.id, username: APPROVER.username }];
      return entries;
    },
    findOne: async () => ({ id: 'd1', company: { id: 'c1' } }),
  };
  return new ApprovalController(null as never, null as never, em as never);
}

const asApiKey = <T>(fn: () => T): T =>
  RequestContext.run({ grants: [], apiKeyId: 'key-1' }, fn);
const asUser = <T>(fn: () => T): T => RequestContext.run({ grants: [], userId: 'u9' }, fn);

/**
 * A username is an account, not a person. The approval history is read by people asking who
 * signed, and `xone` / `finance_head` answers with the login instead — so our own UI is given the
 * approver's employee full name. An API key is not: the integration guide promises that caller
 * "a username and an id — nothing more", and a staff directory is not what it polls this for.
 */
describe('approval log names the person for our own UI', () => {
  it('carries the approver full name for a signed-in user', async () => {
    const controller = controllerOver([ENTRY], [{ user: { id: 'u1' }, fullName: 'ທ້າວ ສົມຊາຍ ວົງສາ' }]);

    const [row] = await asUser(() => controller.log('d1'));

    expect(row.approver).toEqual({ id: 'u1', username: 'dept_head', name: 'ທ້າວ ສົມຊາຍ ວົງສາ' });
  });

  it('falls back to the username when the approver has no employee record here', async () => {
    const controller = controllerOver([ENTRY]);

    const [row] = await asUser(() => controller.log('d1'));

    // Named, not blank: an integration or bootstrap account still has to read as somebody.
    expect(row.approver).toEqual({ id: 'u1', username: 'dept_head', name: 'dept_head' });
  });

  it('withholds the name from an API key, field and all', async () => {
    const controller = controllerOver([ENTRY], [{ user: { id: 'u1' }, fullName: 'ທ້າວ ສົມຊາຍ ວົງສາ' }]);

    const [row] = await asApiKey(() => controller.log('d1'));

    expect(row.approver).not.toHaveProperty('name');
    expect(JSON.stringify(row)).not.toContain('ສົມຊາຍ');
  });
});
