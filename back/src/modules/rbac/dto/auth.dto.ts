import { IsString, IsUUID, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class SwitchCompanyDto {
  @IsUUID()
  companyId!: string;
}

export class ForgotPasswordDto {
  // Username OR email — a single opaque identifier (anti-enumeration).
  @IsString()
  @MinLength(1)
  identifier!: string;
}

export class VerifyEmailDto {
  // The raw verification token from the emailed link. Mirror in the shared verifyEmailSchema.
  @IsString()
  @MinLength(1)
  token!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  // Password policy: at least 8 chars, containing a letter and a number.
  // Mirror this in the shared Zod schema (resetPasswordSchema).
  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'newPassword must contain at least one letter and one number',
  })
  newPassword!: string;
}
