import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EmailTransport } from './transport';

interface MailJob {
  to: string;
  subject: string;
  text: string;
  ref?: string;
  attempts: number;
}

/**
 * In-process mail queue: decouples SMTP delivery from the request path. Callers `enqueue`
 * and return immediately (the endpoint no longer waits on the SMTP round-trip); a background
 * worker drains jobs with bounded concurrency and retries transient failures with backoff.
 *
 * Delivery is best-effort — jobs live in memory only, so a crash/restart drops anything still
 * queued. That is acceptable for the current callers (email verification, password reset), which
 * can always be re-issued and have admin escape hatches. If durability is ever required, swap this
 * for a Redis-backed queue (BullMQ) behind the same `enqueue` signature.
 */
@Injectable()
export class MailQueue implements OnModuleDestroy {
  private readonly logger = new Logger(MailQueue.name);
  private readonly queue: MailJob[] = [];
  private active = 0;
  /** How many emails may be in flight at once — keeps us from hammering the SMTP server. */
  private readonly concurrency = 3;
  /** Total send attempts per job before giving up (initial try + retries). */
  private readonly maxAttempts = 3;

  constructor(private readonly email: EmailTransport) {}

  /** Queue an email for background delivery and return immediately. Never throws. */
  enqueue(to: string, subject: string, text: string, ref?: string): void {
    this.queue.push({ to, subject, text, ref, attempts: 0 });
    this.pump();
  }

  /** Start jobs until the concurrency window is full or the queue empties. */
  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      void this.run(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(job: MailJob): Promise<void> {
    job.attempts++;
    try {
      await this.email.sendMail(job.to, job.subject, job.text, job.ref);
    } catch (e) {
      const suffix = job.ref ? ` for ${job.ref}` : '';
      const message = (e as Error).message;
      if (job.attempts < this.maxAttempts) {
        const delayMs = 2 ** job.attempts * 1000; // 2s, then 4s
        this.logger.warn(
          `Email send failed (attempt ${job.attempts}/${this.maxAttempts})${suffix}: ${message}; retrying in ${delayMs}ms`,
        );
        const timer = setTimeout(() => {
          this.queue.push(job);
          this.pump();
        }, delayMs);
        // Don't keep the event loop alive just for a pending retry.
        timer.unref?.();
      } else {
        this.logger.error(`Email send gave up after ${job.attempts} attempts${suffix}: ${message}`);
      }
    }
  }

  /** Best-effort drain on shutdown so in-flight/queued mail gets a chance to send (bounded wait). */
  async onModuleDestroy(): Promise<void> {
    const deadline = Date.now() + 5000;
    while ((this.queue.length > 0 || this.active > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
