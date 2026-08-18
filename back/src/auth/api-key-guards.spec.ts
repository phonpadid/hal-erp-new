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

/**
 * WHICH routes carry the channel cap, asserted from the controllers' own metadata.
 *
 * The guard's unit tests above prove it refuses a key; they say nothing about where it is mounted,
 * and that is the half that decides what an integration can do. Withdrawal became an
 * `approval_log` writer, so the question "may a key write to that table?" is now answerable only
 * by looking at the routes.
 */
describe('where the channel cap is mounted', () => {
  const guardsOn = (target: object, method: string): unknown[] =>
    (Reflect.getMetadata('__guards__', (target as Record<string, never>)[method]) as unknown[]) ?? [];

  it('caps the approval endpoints: a key can never decide someone else\'s document', async () => {
    const { ApprovalController } = await import('../modules/approval/approval.controller');
    const proto = ApprovalController.prototype as object;
    expect(guardsOn(proto, 'act')).toContain(ApiKeyDenyGuard);
    expect(guardsOn(proto, 'start')).toContain(ApiKeyDenyGuard);
  });

  // Deliberate: an integration that can create and submit a request can end the same request.
  // Refusing only the ending would leave it able to raise obligations it cannot retract. The line
  // is around deciding somebody else's document, not around writing to `approval_log`.
  it('does not cap withdrawal: a key may end the request it raised', async () => {
    const { DocumentController } = await import('../modules/document/document.controller');
    expect(guardsOn(DocumentController.prototype as object, 'cancelDoc')).not.toContain(ApiKeyDenyGuard);
  });
});
