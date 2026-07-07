import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto, SwitchCompanyDto, VerifyEmailDto } from './dto/auth.dto';
import { ChangePasswordValidationPipe, type ChangePasswordDto } from './dto/profile.dto';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { ProfileService } from './profile.service';
import { RbacAuthService } from './rbac-auth.service';
import type { AuthUser } from '../../auth/jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: RbacAuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly emailVerification: EmailVerificationService,
    private readonly profile: ProfileService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  // --- Self-service password reset (all public: no JwtAuthGuard) ---

  /** Always returns the same generic acknowledgement (anti-enumeration). */
  @Post('password/forgot')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordReset.requestReset(dto.identifier);
    return { ok: true };
  }

  /** Reports token usability without consuming it; never reveals account identity. */
  @Get('password/reset/:token')
  async verifyResetToken(@Param('token') token: string) {
    return { valid: await this.passwordReset.verifyToken(token) };
  }

  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordReset.setNewPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  /** Public: consume a verification token and mark the account's email verified. */
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.emailVerification.confirm(dto.token);
    return { ok: true };
  }

  @Post('switch-company')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  switch(@Req() req: { user: AuthUser }, @Body() dto: SwitchCompanyDto) {
    return this.auth.switchCompany(req.user.userId, dto.companyId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: { user: AuthUser }) {
    const { userId, companyId, departmentId, grants } = req.user;
    const [baseCurrency, identity] = await Promise.all([
      companyId ? this.auth.baseCurrency(companyId) : null,
      this.auth.identity(userId, companyId),
    ]);
    return { userId, companyId, departmentId, grants, baseCurrency, ...identity };
  }

  // --- Own account (user-profile): identified by the JWT, never a path id ---

  /** The signed-in user's own profile: identity + linked employee (active company only). */
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profileOf(@Req() req: { user: AuthUser }) {
    return this.profile.getProfile(req.user.userId, req.user.companyId);
  }

  /** Change the signed-in user's own password (verifies the current password; no token/email). */
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Req() req: { user: AuthUser },
    @Body(ChangePasswordValidationPipe) dto: ChangePasswordDto,
  ) {
    await this.profile.changePassword(req.user.userId, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }
}
