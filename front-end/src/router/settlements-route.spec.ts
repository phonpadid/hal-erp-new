import { describe, expect, it } from 'vitest';
import router, { evaluateGuard, type GuardState } from './index';

// web-settlement: the settlements queue is gated on PAYMENT_MANAGE — recording a settlement is a
// finance act — and is a distinct route from the PAYMENT_VIEW ready-to-pay queue.
describe('settlements routing', () => {
  it('registers the settlements route on PAYMENT_MANAGE', () => {
    const record = router.getRoutes().find((r) => r.name === 'settlements');
    expect(record).toBeTruthy();
    expect(record?.meta.permission).toBe('PAYMENT_MANAGE');
  });

  it('blocks the settlements route without PAYMENT_MANAGE', () => {
    const limited: GuardState = { isAuthenticated: true, hasCompany: true, can: () => false };
    expect(evaluateGuard(limited, { name: 'settlements', meta: { permission: 'PAYMENT_MANAGE' } })).toBe('home');
  });

  it('allows the settlements route with PAYMENT_MANAGE', () => {
    const finance: GuardState = { isAuthenticated: true, hasCompany: true, can: (c) => c === 'PAYMENT_MANAGE' };
    expect(evaluateGuard(finance, { name: 'settlements', meta: { permission: 'PAYMENT_MANAGE' } })).toBeNull();
  });
});
