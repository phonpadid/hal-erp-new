import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { JobLevelController } from './job-level.controller';
import { JobLevelService } from './job-level.service';
import { JobLevel } from './job-level.entities';

// Per-company position-level master. Exports JobLevelService so the employee registry can validate
// `job_level` and the approval router can resolve a requester's rank for `minRank` steps.
@Module({
  imports: [MikroOrmModule.forFeature([JobLevel])],
  controllers: [JobLevelController],
  providers: [CompanyScopeService, JobLevelService],
  exports: [JobLevelService],
})
export class JobLevelModule {}
