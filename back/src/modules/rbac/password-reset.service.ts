import { createHash, randomBytes } from 'node:crypto';
import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MailQueue } from '../notification/transports/mail-queue';
import { PasswordService } from './password.service';
import { AppUser, PasswordResetToken } from './rbac.entities';

/** Reset tokens live at most this long. Kept short to bound exposure (design: ≤ 60 min). */
const TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Self-service password reset (rbac): request → email link → set new password.
 * Tokens are single-use, time-limited, and stored only as a hash. Responses are
 * anti-enumeration: request/verify never reveal whether an account exists.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly passwords: PasswordService,
    private readonly mail: MailQueue,
  ) {}

  /** SHA-256 is sufficient: the raw token already carries full entropy (32 random bytes). */
  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Begin a reset for a username OR email. Always resolves the same way regardless of
   * whether an account matched (anti-enumeration); email/token side effects happen only
   * on a match and are not observable to the caller.
   */
  async requestReset(identifier: string): Promise<void> {
    const em = this.em.fork();
    const user = await em.findOne(AppUser, {
      $or: [{ username: identifier }, { email: identifier }],
    });

    // No match or inactive account → do nothing, return the same generic result.
    if (!user || user.status !== 'ACTIVE') return;

    // A newer request supersedes older ones: invalidate outstanding tokens first.
    await this.invalidateOutstanding(em, user.id);

    const rawToken = randomBytes(32).toString('base64url');
    const token = em.create(PasswordResetToken, {
      user,
      tokenHash: this.hash(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      createdAt: new Date(),
    });
    await em.persistAndFlush(token);

    this.sendResetEmail(user.email, rawToken);
  }

  /** True only when the token maps to an unconsumed, unexpired row. Does not consume it. */
  async verifyToken(rawToken: string): Promise<boolean> {
    const token = await this.em.fork().findOne(PasswordResetToken, {
      tokenHash: this.hash(rawToken),
    });
    return this.isUsable(token);
  }

  /**
   * Set a new password against a valid token. Runs in one transaction with a pessimistic
   * lock on the token row so a double-submit can consume it at most once (single-use).
   */
  async setNewPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hash(rawToken);
    const newHash = await this.passwords.hash(newPassword);

    await this.em.transactional(async (em) => {
      const token = await em.findOne(
        PasswordResetToken,
        { tokenHash },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['user'] },
      );
      if (!this.isUsable(token)) {
        throw new BadRequestException('Invalid or expired reset token');
      }

      token.user.passwordHash = newHash;
      token.consumedAt = new Date();
      await this.invalidateOutstanding(em, token.user.id, token.id);
    });
  }

  private isUsable(token: PasswordResetToken | null): token is PasswordResetToken {
    return !!token && !token.consumedAt && token.expiresAt.getTime() > Date.now();
  }

  /** Mark every still-usable token for a user consumed (except `exceptId`, if given). */
  private async invalidateOutstanding(em: EntityManager, userId: string, exceptId?: string): Promise<void> {
    const outstanding = await em.find(PasswordResetToken, {
      user: userId,
      consumedAt: null,
      ...(exceptId ? { id: { $ne: exceptId } } : {}),
    });
    for (const t of outstanding) t.consumedAt = new Date();
  }

  /** Queue the reset email for background delivery (returns without waiting on SMTP). */
  private sendResetEmail(to: string, rawToken: string): void {
    const base = process.env.WEB_BASE_URL ?? 'http://localhost:5173';
    const link = `${base}/reset-password?token=${rawToken}`;
    this.mail.enqueue(
      to,
      'Reset your password',
      `We received a request to reset your password.\n\n` +
        `Open this link to choose a new password (valid for 30 minutes):\n${link}\n\n` +
        `If you did not request this, you can ignore this email.`,
      'password-reset',
    );
  }
}
