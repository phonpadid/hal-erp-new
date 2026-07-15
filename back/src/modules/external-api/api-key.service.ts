import { EntityManager } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { RequestContext } from '../../common/context/request-context';
import type { AuthUser } from '../../auth/jwt.strategy';
import { PermissionResolverService } from '../rbac/permission-resolver.service';
import { AppUser, UserCompanyRole } from '../rbac/rbac.entities';
import { Company } from '../multi-company/multi-company.entities';
import { ApiKey } from './external-api.entities';
import {
  generatePrefix,
  generateRawSecret,
  hashSecret,
  prefixOf,
  verifySecret,
} from './api-key.crypto';

/** api_key row projected for listings — never exposes the secret or its hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date | null;
}

function statusOf(key: ApiKey, now: Date): ApiKeyView['status'] {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

function toView(key: ApiKey, now: Date): ApiKeyView {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    userId: key.user.id,
    status: statusOf(key, now),
    expiresAt: key.expiresAt ?? null,
    lastUsedAt: key.lastUsedAt ?? null,
    createdAt: key.createdAt ?? null,
  };
}

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly em: EntityManager,
    private readonly resolver: PermissionResolverService,
  ) {}

  /**
   * Issue a key bound to `targetUserId` in the caller's active company. The target must be
   * an active member of that company. Returns the raw secret EXACTLY ONCE — it is never
   * persisted or re-derivable. Company-scoped by RequestContext (invariant 1).
   */
  async issue(
    name: string,
    targetUserId: string,
    expiresAt: string | undefined,
  ): Promise<{ id: string; prefix: string; secret: string; name: string; expiresAt: Date | null }> {
    const companyId = RequestContext.companyId();
    const issuerId = RequestContext.userId();
    if (!companyId || !issuerId) throw new UnauthorizedException('No active company context');

    const em = this.em.fork();

    // The bound user must be an active member of this company — a key can never exceed the
    // authority the user actually holds here (resolve() returns null for non-members).
    const membership = await em.findOne(
      UserCompanyRole,
      { user: targetUserId, company: companyId },
      { filters: { company: false } },
    );
    if (!membership) {
      throw new BadRequestException('Target user is not a member of the active company');
    }

    // Retry on the rare prefix collision (unique constraint).
    for (let attempt = 0; attempt < 5; attempt++) {
      const prefix = generatePrefix();
      const secret = generateRawSecret(prefix);
      const key = em.create(ApiKey, {
        company: em.getReference(Company, companyId),
        user: em.getReference(AppUser, targetUserId),
        name,
        prefix,
        secretHash: hashSecret(secret),
        createdBy: em.getReference(AppUser, issuerId),
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        createdAt: new Date(),
      });
      try {
        await em.persistAndFlush(key);
        // Raw secret returned once; only the hash is stored.
        return { id: key.id, prefix, secret, name, expiresAt: key.expiresAt ?? null };
      } catch (e) {
        if (e instanceof UniqueConstraintViolationException) continue;
        throw e;
      }
    }
    throw new BadRequestException('Could not allocate a unique key prefix; retry');
  }

  /** List the active company's keys (non-secret metadata only). */
  async list(): Promise<ApiKeyView[]> {
    const companyId = RequestContext.companyId();
    if (!companyId) throw new UnauthorizedException('No active company context');
    const em = this.em.fork();
    const keys = await em.find(
      ApiKey,
      { company: companyId },
      { filters: { company: false }, populate: ['user'], orderBy: { createdAt: 'DESC' } },
    );
    const now = new Date();
    return keys.map((k) => toView(k, now));
  }

  /** Distinct active users a key may be bound to — members of the active company. */
  async eligibleUsers(): Promise<Array<{ id: string; username: string }>> {
    const companyId = RequestContext.companyId();
    if (!companyId) throw new UnauthorizedException('No active company context');
    const em = this.em.fork();
    const memberships = await em.find(
      UserCompanyRole,
      { company: companyId },
      { filters: { company: false }, populate: ['user'] },
    );
    const byId = new Map<string, string>();
    for (const m of memberships) {
      if (m.user.status === 'ACTIVE') byId.set(m.user.id, m.user.username);
    }
    return [...byId.entries()].map(([id, username]) => ({ id, username }));
  }

  /** Revoke a key in the active company (state change, not delete). Idempotent. */
  async revoke(id: string): Promise<void> {
    const companyId = RequestContext.companyId();
    if (!companyId) throw new UnauthorizedException('No active company context');
    const em = this.em.fork();
    const key = await em.findOne(ApiKey, { id, company: companyId }, { filters: { company: false } });
    if (!key) throw new NotFoundException('API key not found');
    if (!key.revokedAt) {
      key.revokedAt = new Date();
      await em.flush();
    }
  }

  /**
   * Authenticate a presented raw secret and resolve it to the bound principal — the same
   * AuthUser an interactive login would produce. Grants are resolved LIVE from the bound
   * user + company, so the key never carries more authority than the user currently holds.
   * Throws Unauthorized on any invalid / revoked / expired / no-longer-a-member credential.
   */
  async authenticate(rawSecret: string): Promise<AuthUser> {
    const prefix = prefixOf(rawSecret);
    if (!prefix) throw new UnauthorizedException('Malformed API key');

    const em = this.em.fork();
    const key = await em.findOne(
      ApiKey,
      { prefix },
      { filters: { company: false }, populate: ['user', 'company'] },
    );
    if (!key) throw new UnauthorizedException('Invalid API key');

    // Reject on secret mismatch, revocation, or expiry (constant-time secret compare).
    const now = new Date();
    if (
      !verifySecret(rawSecret, key.secretHash) ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt.getTime() <= now.getTime())
    ) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Resolve the bound user's live grants in the bound company (invariant 1 + 6).
    const resolution = await this.resolver.resolve(key.user.id, key.company.id);
    if (!resolution) {
      // The user lost membership since issuance — the key is effectively neutered.
      throw new UnauthorizedException('API key principal has no access to its company');
    }

    return {
      userId: key.user.id,
      companyId: key.company.id,
      departmentId: resolution.departmentId,
      grants: resolution.grants,
      permissionCodes: resolution.grants.map((g) => g.code),
      authSource: 'api-key',
      apiKeyId: key.id,
    };
  }

  /**
   * Best-effort usage marker. Runs on a fresh fork and is never awaited by the request, so
   * it can never fail or delay authentication and never enlists in the request transaction.
   */
  touchLastUsed(apiKeyId: string): void {
    const em = this.em.fork();
    em.nativeUpdate(ApiKey, { id: apiKeyId }, { lastUsedAt: new Date() }).catch(() => {
      // usage tracking is advisory; swallow failures.
    });
  }
}
