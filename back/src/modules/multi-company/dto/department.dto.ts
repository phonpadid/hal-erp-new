import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @MaxLength(255)
  deptCode!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentDeptId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  costCenter?: string;

  // Shift expected of this department's employees who carry no individual assignment.
  @IsOptional()
  @IsUUID()
  defaultWorkShiftId?: string;

  // Whether attendance drives pay for this department's employees, unless one of them overrides it.
  @IsOptional()
  @IsBoolean()
  attendanceAffectsPay?: boolean;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUUID()
  parentDeptId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  costCenter?: string;

  // Send null to clear the department default.
  @IsOptional()
  @IsUUID()
  defaultWorkShiftId?: string | null;

  @IsOptional()
  @IsBoolean()
  attendanceAffectsPay?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
