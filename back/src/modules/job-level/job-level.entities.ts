import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';

// job_level — per-company position-level master. `code` is referenced by employee.job_level and
// workflow_step.condition_json (jobLevels / minRank via rank). Company-scoped (invariant 1);
// levels are configuration, not code (invariant 7).
@Entity({ tableName: 'job_level' })
@Unique({ properties: ['company', 'code'] })
// Created by Migration20260717000000; declared here so it is part of the entity's schema.
@Index({ properties: ['company'] })
export class JobLevel extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  // Seniority order: higher = more senior. Drives the workflow-step `minRank` condition.
  @Property({ type: 'integer' })
  rank!: number;

  @Property({ default: true })
  isActive: boolean = true;
}
