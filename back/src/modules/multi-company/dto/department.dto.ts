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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
