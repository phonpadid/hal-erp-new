import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';

/**
 * api_key — long-lived machine credential for external (M2M) access. Company-scoped
 * (invariant 1): bound to exactly one company + one app_user. On each request the key
 * resolves to the SAME company-context principal that user would get by logging in;
 * grants are resolved LIVE from the bound user, never snapshotted. Custody mirrors the
 * token tables: only `secretHash` is stored — the raw secret is shown once at issuance
 * and never persisted. Authentication is refused once `revokedAt` or `expiresAt` passes.
 */
@Entity({ tableName: 'api_key' })
@Unique({ properties: ['prefix'] })
// Serves the company-scoped active-key listing, which filters on exactly this column pair.
// `prefix` needs no index of its own — the unique constraint above is backed by one, and that
// is what the per-request prefix lookup uses.
@Index({ properties: ['company', 'revokedAt'] })
export class ApiKey extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  // The principal the key rides. Grants resolve from this user's memberships at request time.
  @Index()
  @ManyToOne(() => AppUser, { fieldName: 'user_id' })
  user!: AppUser;

  @Property()
  name!: string;

  // Public, non-secret identifier used for the indexed lookup; safe to show in listings.
  @Property()
  prefix!: string;

  // SHA-256 of the raw secret; the raw value is never persisted.
  @Property()
  secretHash!: string;

  // Admin (holds API_KEY_MANAGE) who issued the key.
  @ManyToOne(() => AppUser, { fieldName: 'created_by' })
  createdBy!: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  expiresAt?: Date;

  // State change, not a delete — set on revoke so audit history is preserved.
  @Property({ columnType: 'timestamptz', nullable: true })
  revokedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastUsedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();
}
