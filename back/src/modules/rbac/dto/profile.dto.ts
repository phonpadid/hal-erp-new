import { changePasswordSchema } from '@erp/shared';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { ChangePasswordInput } from '@erp/shared';

/**
 * Change-own-password payload. Reuses the shared Zod schema so the server enforces
 * exactly the rules the Vue form's zodResolver enforces (policy + new ≠ current) — one
 * source of truth, no drift. This is the authenticated rotation flow (no token/email),
 * distinct from ResetPasswordDto.
 */
export type ChangePasswordDto = ChangePasswordInput;
export const ChangePasswordValidationPipe = new ZodValidationPipe(changePasswordSchema);
