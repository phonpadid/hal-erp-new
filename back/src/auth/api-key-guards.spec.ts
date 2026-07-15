import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiKeyDenyGuard } from './api-key-deny.guard';
import { extractApiKeyCredential } from './jwt-or-api-key.guard';
import type { AuthUser } from './jwt.strategy';

function ctxWithUser(user: Partial<AuthUser> | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('ApiKeyDenyGuard (channel cap: no approve via key)', () => {
  const guard = new ApiKeyDenyGuard();

  it('denies a request authenticated by an API key', () => {
    expect(() => guard.canActivate(ctxWithUser({ authSource: 'api-key' }))).toThrow(
      ForbiddenException,
    );
  });

  it('allows a JWT-authenticated request', () => {
    expect(guard.canActivate(ctxWithUser({ authSource: 'jwt' }))).toBe(true);
  });

  it('allows when there is no principal (auth guard will reject separately)', () => {
    expect(guard.canActivate(ctxWithUser(undefined))).toBe(true);
  });
});

describe('extractApiKeyCredential', () => {
  const req = (headers: Record<string, string | undefined>) => ({ headers }) as any;

  it('reads Authorization: Api-Key <secret> (case-insensitive)', () => {
    expect(extractApiKeyCredential(req({ authorization: 'Api-Key ak_1.abc' }))).toBe('ak_1.abc');
    expect(extractApiKeyCredential(req({ authorization: 'api-key ak_1.abc' }))).toBe('ak_1.abc');
  });

  it('falls back to X-Api-Key', () => {
    expect(extractApiKeyCredential(req({ 'x-api-key': 'ak_2.def' }))).toBe('ak_2.def');
  });

  it('ignores a Bearer token (that is the JWT path)', () => {
    expect(extractApiKeyCredential(req({ authorization: 'Bearer jwt.token.here' }))).toBeNull();
  });

  it('returns null when no key credential is present', () => {
    expect(extractApiKeyCredential(req({}))).toBeNull();
    expect(extractApiKeyCredential(req({ authorization: 'Api-Key   ' }))).toBeNull();
  });
});
