import { MikroORM } from '@mikro-orm/postgresql';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES } from '../../test/test-orm';
import { ApproveAction } from '../../common/enums';
import { AppUser } from '../rbac/rbac.entities';
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
    const approver = { id: 'u1', username: 'dept_head', passwordHash: 'secret', email: 'a@b.c' };
    const entry = {
      id: 'l1',
      document: { id: 'd1' },
      stepNo: 1,
      action: ApproveAction.APPROVE,
      remark: 'ตรวจสอบแล้ว',
      actedAt: new Date('2026-07-27T09:56:51.414Z'),
      approver,
      delegatedFrom: undefined,
      signature: { id: 's1' },
    };
    const em = { fork: () => ({ find: async () => [entry] }) };
    const controller = new ApprovalController(null as never, null as never, em as never);

    const [row] = await controller.log('d1');

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
