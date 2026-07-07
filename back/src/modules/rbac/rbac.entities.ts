import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { Scope } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company, Department } from '../multi-company/multi-company.entities';

// app_user — single login across companies (no company_id here).
@Entity({ tableName: 'app_user' })
export class AppUser extends BaseEntity {
  @Property({ unique: true })
  username!: string;

  @Property({ unique: true })
  email!: string;

  @Property({ nullable: true })
  passwordHash?: string;

  @Property({ default: 'ACTIVE' })
  status: string = 'ACTIVE';

  // null until the user confirms their email; login is blocked while null.
  @Property({ columnType: 'timestamptz', nullable: true })
  emailVerifiedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

// password_reset_token — self-service reset. No company_id (app_user is global).
// Stores only the token hash; single-use via consumedAt, time-limited via expiresAt.
@Entity({ tableName: 'password_reset_token' })
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
}
