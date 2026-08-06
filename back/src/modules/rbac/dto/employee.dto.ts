import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { EMPLOYEE_STATUSES } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

const EMPLOYMENT_TYPES = ['MONTHLY', 'DAILY', 'HOURLY'] as const;

/**
 * Employee list query: the shared `?page=&limit=` plus server-side search and filters.
 * Extending `PaginationQueryDto` is what lets the global whitelist accept these instead of
 * rejecting them as unknown properties. Every field is optional — a request supplying none
 * returns the same list as before search existed.
 *
 * A malformed filter is rejected rather than ignored: silently dropping it would return the
 * full list, which reads as a legitimate result while not being the one that was asked for.
 */
export class ListEmployeesQueryDto extends PaginationQueryDto {
  // Matched case-insensitively against emp_code / full_name / position. `salary` is
  // deliberately not searchable — result membership would leak a value gated by
  // EMP_SALARY_VIEW to a caller who may not read it.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn([...EMPLOYEE_STATUSES])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  jobLevel?: string;

  // Whether the employee is linked to a login account. Arrives as a query string; coerce
  // 'true'/'false' to a real boolean while leaving absent as undefined (no filter at all),
  // so "not linked" stays distinguishable from "not filtered".
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === ''
      ? undefined
      : value === true || value === 'true',
  )
  @IsBoolean()
  hasAccount?: boolean;
}

export class CreateEmployeeDto {
  @IsString()
  @MaxLength(255)
  empCode!: string;

  @IsString()
  @MaxLength(255)
  fullName!: string;

  @IsUUID()
  departmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  jobLevel?: string;

  @IsOptional()
  @IsDateString()
  hireDate?: string;

  // Money as string — never a JS number.
  @IsOptional()
  @IsString()
  salary?: string;

  @IsOptional()
  @IsEnum(EMPLOYEE_STATUSES)
  status?: string;

  // Whether this person is expected to record attendance. False for executives and field staff:
  // they are not reported as absent, but attendance they do record is still stored.
  @IsOptional()
  @IsBoolean()
  attendanceRequired?: boolean;

  // Pay basis — holiday work is compensated differently for monthly- vs daily-paid staff.
  @IsOptional()
  @IsEnum(EMPLOYMENT_TYPES)
  employmentType?: string;

  // Whether attendance drives this person's pay, overriding their department. Send null to clear
  // the override and go back to inheriting. It changes no attendance figure — lateness and absence
  // are measured the same either way; it only marks whether payroll acts on them.
  @IsOptional()
  @IsBoolean()
  attendanceAffectsPay?: boolean | null;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  jobLevel?: string;

  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @IsOptional()
  @IsString()
  salary?: string;

  @IsOptional()
  @IsEnum(EMPLOYEE_STATUSES)
  status?: string;

  // Whether this person is expected to record attendance. False for executives and field staff:
  // they are not reported as absent, but attendance they do record is still stored.
  @IsOptional()
  @IsBoolean()
  attendanceRequired?: boolean;

  // Pay basis — holiday work is compensated differently for monthly- vs daily-paid staff.
  @IsOptional()
  @IsEnum(EMPLOYMENT_TYPES)
  employmentType?: string;

  // Whether attendance drives this person's pay, overriding their department. Send null to clear
  // the override and go back to inheriting. It changes no attendance figure — lateness and absence
  // are measured the same either way; it only marks whether payroll acts on them.
  @IsOptional()
  @IsBoolean()
  attendanceAffectsPay?: boolean | null;
}

export class LinkEmployeeDto {
  @IsUUID()
  userId!: string;
}

// Create a login account and link it to the employee. The admin supplies only username +
// email; the initial password comes from USER_PASSWORD server-side, never over the wire.
export class CreateUserAccountDto {
  @IsString()
  @MaxLength(255)
  username!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;
}

// Onboard an employee in one step: create the account AND grant a first company-role assignment
// in the active company. Company comes from context, never the body; the initial password comes
// from USER_PASSWORD server-side. roleId/departmentId are validated against the active company.
export class OnboardEmployeeDto {
  @IsString()
  @MaxLength(255)
  username!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsUUID()
  roleId!: string;

  @IsUUID()
  departmentId!: string;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}
