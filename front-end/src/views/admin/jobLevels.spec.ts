import { describe, expect, it } from 'vitest';
import { jobLevelSchema } from '@erp/shared';
import { mountView } from '../../test/mountView';
import JobLevelsAdminView from './JobLevelsAdminView.vue';

// The job-level admin surface mirrors the tax-code admin: a shared Zod schema (single source of
// truth), a company-scoped list, and JOB_LEVEL_MANAGE-gated create/edit/deactivate affordances.
describe('jobLevelSchema (shared, mirrors backend DTO)', () => {
  it('accepts a valid level', () => {
    expect(jobLevelSchema.safeParse({ code: 'MANAGER', name: 'Manager', rank: 30 }).success).toBe(true);
  });
  it('requires code, name and an integer rank', () => {
    expect(jobLevelSchema.safeParse({ code: '', name: 'X', rank: 1 }).success).toBe(false);
    expect(jobLevelSchema.safeParse({ code: 'X', name: '', rank: 1 }).success).toBe(false);
    expect(jobLevelSchema.safeParse({ code: 'X', name: 'X', rank: 1.5 }).success).toBe(false);
  });
});

describe('JobLevelsAdminView', () => {
  const rows = [
    { id: '1', code: 'STAFF', name: 'Staff', rank: 10, isActive: true },
    { id: '2', code: 'MANAGER', name: 'Manager', rank: 30, isActive: false },
  ];

  it('lists the active company job levels', async () => {
    const w = await mountView(JobLevelsAdminView, {
      routeName: 'job-levels',
      initialState: { jobLevels: { jobLevels: rows, total: 2, page: 1, limit: 20 } },
    });
    const html = w.html();
    expect(html).toContain('STAFF');
    expect(html).toContain('MANAGER');
  });

  it('hides the manage affordances without JOB_LEVEL_MANAGE', async () => {
    const w = await mountView(JobLevelsAdminView, {
      routeName: 'job-levels',
      permissions: ['JOB_LEVEL_VIEW'],
      initialState: { jobLevels: { jobLevels: rows, total: 2, page: 1, limit: 20 } },
    });
    // The "New job level" button (its pi-plus icon) and the row edit pencil are JOB_LEVEL_MANAGE-gated.
    expect(w.html()).not.toContain('pi-plus');
    expect(w.html()).not.toContain('pi-pencil');
  });

  it('shows the manage affordances with JOB_LEVEL_MANAGE', async () => {
    const w = await mountView(JobLevelsAdminView, {
      routeName: 'job-levels',
      permissions: ['JOB_LEVEL_VIEW', 'JOB_LEVEL_MANAGE'],
      initialState: { jobLevels: { jobLevels: rows, total: 2, page: 1, limit: 20 } },
    });
    expect(w.html()).toContain('pi-plus'); // "New job level" button
    expect(w.html()).toContain('pi-pencil'); // per-row edit
  });
});
