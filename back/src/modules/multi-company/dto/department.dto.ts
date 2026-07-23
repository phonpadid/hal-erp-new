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
  isActive?: boolean;
}
