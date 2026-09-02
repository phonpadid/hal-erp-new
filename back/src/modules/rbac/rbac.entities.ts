import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToOne,
  OptionalProps,
  Property,
  Unique,
} from '@mikro-orm/core';
import { EmploymentType, Scope } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company, Department } from '../multi-company/multi-company.entities';

// app_user — single login across companies (no company_id here).
@Entity({ tableName: 'app_user' })
export class AppUser extends BaseEntity {
  // Defaulted in the entity, so callers need not pass it (every existing create site predates it).
  [OptionalProps]?: 'isServiceAccount';

  @Property({ unique: true })
  username!: string;

  @Property({ unique: true })
  email!: string;

  // hidden: never serialized. Any endpoint that populates a user and returns the entity would
  // otherwise hand out the bcrypt hash — /documents/:id/approval-log did exactly that, to
  // external API keys. Services read this property off the object directly, which `hidden`
  // does not affect; it only removes the field from toObject()/toJSON().
  @Property({ nullable: true, hidden: true })
  passwordHash?: string;

  // A non-human identity (bot/integration) that authenticates ONLY by API key; interactive
  // login is denied on this flag. Stored rather than inferred from a null passwordHash: a
  // person who has not set a password would otherwise be indistinguishable from a bot, which
  // would make both the admin UI badge and the login denial key off the wrong fact.
  @Property({ default: false })
  isServiceAccount: boolean = false;

  @Property({ default: 'ACTIVE' })
  status: string = 'ACTIVE';

  // null until the user confirms their email; login is blocked while null.
  @Property({ columnType: 'timestamptz', nullable: true })
  emailVerifiedAt?: Date;

  // The user's active signature; approvals stamp this id at approval time (nullable —
  // a user may have no signature). Held as a scalar FK (not a relation) so this file has no
  // forward class reference to the later-declared UserSignature under emitDecoratorMetadata.
  //
  // Do NOT promote this to @ManyToOne (even with mapToPk): user_signature already points back at
  // app_user, so declaring this side makes the entity graph cyclic and schema.refreshDatabase()
  // can no longer order CREATE TABLE, which drops every DB-backed test. The database does carry a
  // real FK here (ON DELETE SET NULL) added by migration via ALTER TABLE, which sidesteps the
  // cycle. The cost is that `schema:update --dump` permanently reports one spurious
  // `drop constraint app_user_current_signature_id_foreign` — expected, and must not be applied.
  @Property({ fieldName: 'current_signature_id', type: 'uuid', nullable: true })
  currentSignatureId?: string;

  // Object key (S3/MinIO) for the user's 1:1 profile image; bytes never live in the DB.
  @Property({ nullable: true })
  profileImagePath?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

// user_signature — a user's reusable signature image. Rows are IMMUTABLE: replacing a
// signature inserts a new row and re-points AppUser.currentSignature; the old row and its
// stored file are never overwritten, so a stamped approval_log.signature_id always resolves
// to the exact image signed with. Global to app_user; bytes live in S3/MinIO, not the DB.
@Entity({ tableName: 'user_signature' })
export class UserSignature extends BaseEntity {
  @Index()
  @ManyToOne(() => AppUser, { fieldName: 'user_id' })
  user!: AppUser;

  @Property()
  filePath!: string;

  @Property({ nullable: true })
  mimeType?: string;

  @Property({ type: 'int', nullable: true })
  fileSizeKb?: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  uploadedAt?: Date;
}

// password_reset_token — self-service reset. No company_id (app_user is global).
// Stores only the token hash; single-use via consumedAt, time-limited via expiresAt.
@Entity({ tableName: 'password_reset_token' })
// Serves the "outstanding tokens for this user" lookup, which filters on exactly this pair.
@Index({ properties: ['user', 'consumedAt'] })
export class PasswordResetToken extends BaseEntity {
  @ManyToOne(() => AppUser, { fieldName: 'user_id' })
  user!: AppUser;

  @Property({ unique: true })
  tokenHash!: string;

  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  consumedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();
}

// email_verification_token — confirm ownership of an account's email. No company_id (app_user is
// global). Stores only the token hash; single-use via consumedAt, time-limited via expiresAt.
@Entity({ tableName: 'email_verification_token' })
// Serves the "outstanding tokens for this user" lookup, which filters on exactly this pair.
@Index({ properties: ['user', 'consumedAt'] })
export class EmailVerificationToken extends BaseEntity {
  @ManyToOne(() => AppUser, { fieldName: 'user_id' })
  user!: AppUser;

  @Property({ unique: true })
  tokenHash!: string;

  @Property({ columnType: 'timestamptz' })
  expiresAt!: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  consumedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();
}

// permission — central master; authorization checks the CODE, never the role name.
@Entity({ tableName: 'permission' })
export class Permission extends BaseEntity {
  @Property({ unique: true })
  code!: string;

  @Property()
  name!: string;

  @Property()
  module!: string;

  @Property({ default: true })
  isActive: boolean = true;
}

// role — per-company; same name across companies may carry different permissions.
@Entity({ tableName: 'role' })
@Unique({ properties: ['company', 'code'] })
export class Role extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  @Property({ nullable: true })
  description?: string;

  @Property({ default: true })
  isActive: boolean = true;
}

@Entity({ tableName: 'role_permission' })
@Unique({ properties: ['role', 'permission'] })
export class RolePermission extends BaseEntity {
  @ManyToOne(() => Role)
  role!: Role;

  @ManyToOne(() => Permission)
  permission!: Permission;

  // OWN / DEPARTMENT / COMPANY / GROUP — data-visibility scope.
  @Enum({ items: () => Scope, default: Scope.DEPARTMENT })
  scope: Scope = Scope.DEPARTMENT;
}

// user_company_role — one user, many companies, many roles per company.
@Entity({ tableName: 'user_company_role' })
@Unique({ properties: ['user', 'company', 'role'] })
@Index({ properties: ['user'] })
export class UserCompanyRole extends CompanyScopedEntity {
  @ManyToOne(() => AppUser)
  user!: AppUser;

  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Department)
  department!: Department;

  @ManyToOne(() => Role)
  role!: Role;

  @Property({ default: false })
  isDefault: boolean = false;

  @Property({ columnType: 'date', nullable: true })
  validFrom?: string;

  @Property({ columnType: 'date', nullable: true })
  validTo?: string;
}

@Entity({ tableName: 'employee' })
@Unique({ properties: ['company', 'empCode'] })
export class Employee extends CompanyScopedEntity {
  // Both carry database defaults, so callers need not supply them on create.
  [OptionalProps]?: 'attendanceRequired' | 'employmentType';

  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Department)
  department!: Department;

  @OneToOne(() => AppUser, { owner: true, nullable: true })
  user?: AppUser;

  @Property()
  empCode!: string;

  @Property()
  fullName!: string;

  @Property({ nullable: true })
  position?: string;

  @Property({ nullable: true })
  jobLevel?: string;

  // Sensitive: read access is permission-gated.
  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  salary?: string;

  @Property({ columnType: 'date', nullable: true })
  hireDate?: string;

  @Property({ default: 'ACTIVE' })
  status: string = 'ACTIVE';

  /**
   * Whether this person is expected to record attendance. False for executives and field staff
   * who never clock in: they are not reported as absent, but any attendance they do record is
   * still stored. The flag gates reporting, not writing.
   */
  @Property({ default: true })
  attendanceRequired: boolean = true;

  /**
   * Whether this person's attendance drives their pay, overriding their department.
   *
   * Nullable on purpose — that is what makes "inherit" expressible. A non-null column defaulting
   * to true could not tell "deliberately true" from "never set", and the department default would
   * have nothing to apply to.
   *
   * It changes no computation. Someone whose pay is not driven by attendance is still measured for
   * lateness and absence; only the stamp on a closed period's line differs.
   */
  @Property({ type: 'boolean', nullable: true })
  attendanceAffectsPay?: boolean;

  /** Pay basis — holiday work is compensated differently for monthly- vs daily-paid staff. */
  @Enum({ items: () => EmploymentType, default: EmploymentType.MONTHLY })
  employmentType: EmploymentType = EmploymentType.MONTHLY;
}
