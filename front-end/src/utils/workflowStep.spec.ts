import { describe, expect, it } from 'vitest';
import { approverLabel } from './workflowStep';

/**
 * An admin reads a step's approver by the role's per-company name, not by the permission code
 * the server authorizes on. These guard that preference and the fallbacks behind it, so a step
 * row is never blank while the option lists are still loading.
 */
describe('approverLabel', () => {
  const roles = [
    { id: 'r1', code: 'HAD', name: 'ຫົວໜ້າພະແນກບັນຊີ' },
    { id: 'r2', code: 'FINANCE', name: '' },
  ];
  const users = [{ id: 'u1', username: 'somchai' }];

  it('prefers the person over the role', () => {
    expect(approverLabel({ approverUserId: 'u1', approverRoleId: 'r1' }, roles, users)).toBe('somchai');
  });

  it('shows the role name', () => {
    expect(approverLabel({ approverUserId: undefined, approverRoleId: 'r1' }, roles, users)).toBe('ຫົວໜ້າພະແນກບັນຊີ');
  });

  it('falls back to the code when the role carries no name', () => {
    expect(approverLabel({ approverUserId: undefined, approverRoleId: 'r2' }, roles, users)).toBe('FINANCE');
  });

  it('falls back to the raw id while the role list is unresolved', () => {
    expect(approverLabel({ approverUserId: undefined, approverRoleId: 'r9' }, [], users)).toBe('r9');
  });

  it('is empty when no approver is configured', () => {
    expect(approverLabel({ approverUserId: undefined, approverRoleId: undefined }, roles, users)).toBe('');
  });
});
