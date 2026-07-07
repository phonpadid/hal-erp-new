import { describe, expect, it } from 'vitest';
import router, { evaluateGuard, type GuardState } from './index';

const authed: GuardState = { isAuthenticated: true, hasCompany: true, can: () => true };
const anon: GuardState = { isAuthenticated: false, hasCompany: false, can: () => false };

describe('evaluateGuard', () => {
  it('allows public routes regardless of auth', () => {
    expect(evaluateGuard(anon, { name: 'login', meta: { public: true } })).toBeNull();
  });

  it('redirects unauthenticated users to login', () => {
    expect(evaluateGuard(anon, { name: 'home', meta: {} })).toBe('login');
  });

  it('redirects authenticated-but-no-company to select-company', () => {
    const noCompany: GuardState = { isAuthenticated: true, hasCompany: false, can: () => true };
    expect(evaluateGuard(noCompany, { name: 'home', meta: {} })).toBe('select-company');
  });

  it('lets a no-company user reach select-company itself', () => {
    const noCompany: GuardState = { isAuthenticated: true, hasCompany: false, can: () => true };
    expect(evaluateGuard(noCompany, { name: 'select-company', meta: { requiresCompany: false } })).toBeNull();
  });

  it('redirects home when a required permission is missing', () => {
    const limited: GuardState = { isAuthenticated: true, hasCompany: true, can: () => false };
    expect(evaluateGuard(limited, { name: 'budgets', meta: { permission: 'BUDGET_VIEW' } })).toBe('home');
  });

  it('allows when authenticated, has company, and permission granted', () => {
    expect(evaluateGuard(authed, { name: 'home', meta: { permission: 'DOC_VIEW' } })).toBeNull();
  });

  // web-doc-config: the four Configuration section routes are each gated by DOC_CONFIG_MANAGE.
  it('blocks a Configuration section route without DOC_CONFIG_MANAGE', () => {
    const limited: GuardState = { isAuthenticated: true, hasCompany: true, can: () => false };
    for (const name of ['doc-config-types', 'doc-config-forms', 'doc-config-mappings', 'doc-config-workflows']) {
      expect(evaluateGuard(limited, { name, meta: { permission: 'DOC_CONFIG_MANAGE' } })).toBe('home');
    }
  });

  it('allows a Configuration section route with DOC_CONFIG_MANAGE', () => {
    const cfgUser: GuardState = { isAuthenticated: true, hasCompany: true, can: (c) => c === 'DOC_CONFIG_MANAGE' };
    expect(evaluateGuard(cfgUser, { name: 'doc-config-types', meta: { permission: 'DOC_CONFIG_MANAGE' } })).toBeNull();
  });
});

describe('doc-config routing', () => {
  // web-doc-config: the Configuration root redirects to the first section so old
  // /doc-config links (and the sidebar entry) still resolve.
  it('redirects /doc-config to the first section', () => {
    const record = router.getRoutes().find((r) => r.path === '/doc-config');
    expect(record?.redirect).toEqual({ name: 'doc-config-types' });
  });

  it('exposes a directly-linkable route per section', () => {
    expect(router.resolve('/doc-config/types').name).toBe('doc-config-types');
    expect(router.resolve('/doc-config/forms').name).toBe('doc-config-forms');
    expect(router.resolve('/doc-config/mappings').name).toBe('doc-config-mappings');
    expect(router.resolve('/doc-config/workflows').name).toBe('doc-config-workflows');
  });
});
