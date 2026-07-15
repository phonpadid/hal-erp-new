import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuthController } from './auth.controller';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmailVerificationService } from './email-verification.service';
import { MembershipService } from './membership.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import { ProfileService } from './profile.service';
import { SignatureService } from './signature.service';
import { RbacAdminController } from './rbac-admin.controller';
import { RbacAuthService } from './rbac-auth.service';
import { StorageService } from '../../common/storage/storage.service';
import { JobLevelModule } from '../job-level/job-level.module';
import { ApprovalLog } from '../approval/approval.entities';
import {
  AppUser,
  EmailVerificationToken,
  Employee,
  PasswordResetToken,
  Permission,
  Role,
  RolePermission,
  UserCompanyRole,
  UserSignature,
} from './rbac.entities';
import { RoleAdminService } from './role-admin.service';
import { ScopeService } from './scope.service';
// Stateless SMTP transport, provided directly to avoid a NotificationsModule <-> RbacModule cycle.
import { EmailTransport } from '../notification/transports/transport';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      AppUser,
      PasswordResetToken,
      EmailVerificationToken,
      Permission,
      Role,
      RolePermission,
      UserCompanyRole,
      Employee,
      UserSignature,
      ApprovalLog,
    ]),
    AuthModule, // AuthService (token signer) + JwtModule + JwtStrategy
    JobLevelModule, // JobLevelService — validate employee.job_level against the company master
  ],
  controllers: [AuthController, RbacAdminController, EmployeeController],
  providers: [
    PasswordService,
    PasswordResetService,
    EmailVerificationService,
    EmailTransport,
    PermissionResolverService,
    MembershipService,
    ScopeService,
    RbacAuthService,
    RoleAdminService,
    EmployeeService,
    ProfileService,
    SignatureService,
    StorageService,
  ],
  exports: [PermissionResolverService, ScopeService, MembershipService, PasswordService, EmployeeService],
})
export class RbacModule {}
