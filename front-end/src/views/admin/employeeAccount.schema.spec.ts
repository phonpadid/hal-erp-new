import { createUserAccountSchema } from '@erp/shared';
import { describe, expect, it } from 'vitest';

// The create-and-link form mirrors this schema: username + email only, no password.
describe('createUserAccountSchema', () => {
  it('accepts a username and a valid email', () => {
    const r = createUserAccountSchema.safeParse({ username: 'newhire', email: 'newhire@example.com' });
    expect(r.success).toBe(true);
  });

  it('rejects an empty username', () => {
    const r = createUserAccountSchema.safeParse({ username: '', email: 'a@b.com' });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const r = createUserAccountSchema.safeParse({ username: 'x', email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('does not carry a password field', () => {
    const r = createUserAccountSchema.safeParse({ username: 'x', email: 'x@y.com', password: 'secret' });
    expect(r.success).toBe(true);
    expect((r as { data: Record<string, unknown> }).data).not.toHaveProperty('password');
  });
});
