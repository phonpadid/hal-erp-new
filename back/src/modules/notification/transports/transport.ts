import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Notification } from '../notification.entities';

/** A channel transport. The persisted row is always the record of intent. */
export interface NotificationTransport {
  readonly channel: string;
  send(notification: Notification, recipientEmail?: string): Promise<void>;
}

export const NOTIFICATION_TRANSPORTS = Symbol('NOTIFICATION_TRANSPORTS');

/** IN_APP: the row itself is the delivery — nothing external to send. */
export class InAppTransport implements NotificationTransport {
  readonly channel = 'IN_APP';
  async send(): Promise<void> {
    /* no-op */
  }
}

/** Recognized but not yet integrated (LINE / SMS) — records without delivering. */
export class NoopTransport implements NotificationTransport {
  constructor(readonly channel: string) {}
  async send(): Promise<void> {
    /* no-op */
  }
}

/** EMAIL over SMTP (nodemailer). No-op when MAIL_USER is unset (dev/test/CI). */
@Injectable()
export class EmailTransport implements NotificationTransport {
  readonly channel = 'EMAIL';
  private readonly logger = new Logger(EmailTransport.name);
  private transporter?: nodemailer.Transporter;

  private get configured(): boolean {
    return !!process.env.MAIL_USER;
  }

  private get tx(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST ?? 'smtp.gmail.com',
        port: Number(process.env.MAIL_PORT ?? 587),
        secure: false,
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
      });
    }
    return this.transporter;
  }

  async send(notification: Notification, recipientEmail?: string): Promise<void> {
    if (!recipientEmail) return;
    await this.sendMail(recipientEmail, notification.title ?? '', notification.message ?? '', notification.id);
  }

  /**
   * Send a plain-text email outside the notification pipeline (e.g. password reset,
   * which has no company-scoped `notification` row). No-op when SMTP is unconfigured
   * (dev/test/CI), so callers never need to guard on it.
   */
  async sendMail(to: string, subject: string, text: string, ref?: string): Promise<void> {
    if (!this.configured) {
      this.logger.warn(`MAIL not configured; skipping email${ref ? ` for ${ref}` : ''}`);
      return;
    }
    await this.tx.sendMail({ from: process.env.MAIL_USER, to, subject, text });
  }
}
