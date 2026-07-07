import { createHash, randomBytes } from 'node:crypto';
import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EmailTransport } from '../notification/transports/transport';
import { AppUser, EmailVerificationToken } from './rbac.entities';

/** Verification links live at most this long. Longer than a reset (onboarding, not a security reset). */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Email verification (rbac): a verification link is issued on account creation; confirming it marks
 * the account's email verified. Tokens are single-use, time-limited, and stored only as a hash —
 * same custody rules as password reset. `markVerified` is the admin escape hatch (no email).
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly email: EmailTransport,
  ) {}

  /** SHA-256 is sufficient: the raw token already carries full entropy (32 random bytes). */
  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Issue a verification token for a user and email them the link. Best-effort: a mail failure (or an
   * unconfigured SMTP no-op) must never fail the caller — the account is simply left unverified.
   */
  async sendVerification(user: AppUser): Promise<void> {
    try {
      const em = this.em.fork();
      await this.invalidateOutstanding(em, user.id);
      const rawToken = randomBytes(32).toString('base64url');
      const token = em.create(EmailVerificationToken, {
        user: em.getReference(AppUser, user.id),
        tokenHash: this.hash(rawToken),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        createdAt: new Date(),
      });
      await em.persistAndFlush(token);
      await this.sendVerificationEmail(user.email, rawToken);
    } catch (e) {
      // Never propagate: account creation succeeds even if verification mail can't be issued.
      this.logger.warn(`Could not send verification email for ${user.id}: ${(e as Error).message}`);
    }
  }

  /**
   * Confirm an account's email against a valid token. Runs in one transaction with a pessimistic lock
   * on the token row so a double-submit consumes it at most once (single-use).
   */
  async confirm(rawToken: string): Promise<void> {
    const tokenHash = this.hash(rawToken);
    await this.em.transactional(async (em) => {
      const token = await em.findOne(
        EmailVerificationToken,
        { tokenHash },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['user'] },
      );
      if (!this.isUsable(token)) {
        throw new BadRequestException('Invalid or expired verification token');
      }
      if (!token.user.emailVerifiedAt) token.user.emailVerifiedAt = new Date();
      token.consumedAt = new Date();
      await this.invalidateOutstanding(em, token.user.id, token.id);
    });
  }

  /** Admin escape hatch: mark a user's email verified without a token or email. Idempotent, one-way. */
  async markVerified(userId: string): Promise<void> {
    const em = this.em.fork();
    const user = await em.findOne(AppUser, { id: userId });
    if (!user) throw new BadRequestException(`Unknown user '${userId}'`);
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await em.flush();
    }
  }

  private isUsable(token: EmailVerificationToken | null): token is EmailVerificationToken {
    return !!token && !token.consumedAt && token.expiresAt.getTime() > Date.now();
  }

  /** Mark every still-usable token for a user consumed (except `exceptId`, if given). */
  private async invalidateOutstanding(em: EntityManager, userId: string, exceptId?: string): Promise<void> {
    const outstanding = await em.find(EmailVerificationToken, {
      user: userId,
      consumedAt: null,
      ...(exceptId ? { id: { $ne: exceptId } } : {}),
    });
    for (const t of outstanding) t.consumedAt = new Date();
  }

  private async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    const base = process.env.WEB_BASE_URL ?? 'http://localhost:5173';
    const link = `${base}/verify-email?token=${rawToken}`;
    await this.email.sendMail(
      to,
      'Verify your email',
      `Welcome! Please confirm your email address to activate your account.\n\n` +
        `Open this link to verify (valid for 24 hours):\n${link}\n\n` +
        `If you did not expect this, you can ignore this email.`,
      'email-verification',
    );
  }
}
