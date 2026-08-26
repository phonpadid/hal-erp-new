import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { SearchablePaginationQueryDto } from '../../../common/pagination/pagination';

export class CreateJobLevelDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  // Seniority order (higher = more senior). Used by the workflow-step minRank condition.
  @IsInt()
  rank!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateJobLevelDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsInt()
  rank?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListJobLevelQueryDto extends SearchablePaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
