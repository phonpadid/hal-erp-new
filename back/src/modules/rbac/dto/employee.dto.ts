import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const EMPLOYEE_STATUSES = ['ACTIVE', 'RESIGNED', 'TERMINATED'] as const;
const EMPLOYMENT_TYPES = ['MONTHLY', 'DAILY', 'HOURLY'] as const;

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
