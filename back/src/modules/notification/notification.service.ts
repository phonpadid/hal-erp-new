import { EntityManager } from '@mikro-orm/postgresql';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Document } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Notification, NotificationTemplate } from './notification.entities';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { TemplateService } from './template.service';
import {
  NOTIFICATION_TRANSPORTS,
  type NotificationTransport,
} from './transports/transport';

const FILTER_OFF = { filters: { company: false } } as const;

export interface DispatchInput {
  userId: string;
  companyId: string;
  channel?: string;
  templateCode?: string;
  documentId?: string;
  vars?: Record<string, string>;
  title?: string;
  message?: string;
}

/** Renders, persists, and delivers notifications; tracks status + read state. */
@Injectable()
export class NotificationService {
  private readonly byChannel: Map<string, NotificationTransport>;

  constructor(
    private readonly em: EntityManager,
    private readonly templates: TemplateService,
    @Inject(NOTIFICATION_TRANSPORTS) transports: NotificationTransport[],
  ) {
    this.byChannel = new Map(transports.map((t) => [t.channel, t]));
  }

  /** Render (template) or use literals, persist a row, deliver, record SENT/FAILED. */
  async dispatch(input: DispatchInput): Promise<Notification> {
    const em = this.em.fork();
    const vars = input.vars ?? {};

    let channel = input.channel ?? 'IN_APP';
    let title = input.title;
    let message = input.message;
    let templateRef: NotificationTemplate | undefined;

    if (input.templateCode) {
      const template = await this.templates.findActive(input.templateCode);
      if (template) {
        templateRef = template;
        channel = template.channel;
        const rendered = this.templates.render(template, vars);
        title = rendered.subject || title;
        message = rendered.body || message;
      }
    }

    const notification = em.create(Notification, {
      company: em.getReference(Company, input.companyId),
      user: em.getReference(AppUser, input.userId),
      template: templateRef,
      document: input.documentId ? em.getReference(Document, input.documentId) : undefined,
      channel,
      title,
      message,
      status: 'PENDING',
      isRead: false,
      createdAt: new Date(),
    });
    await em.persistAndFlush(notification);

    try {
      const transport = this.byChannel.get(channel);
      if (transport) {
        const recipientEmail =
          channel === 'EMAIL' ? (await em.findOne(AppUser, { id: input.userId }))?.email : undefined;
        await transport.send(notification, recipientEmail ?? undefined);
      }
      notification.status = 'SENT';
      notification.sentAt = new Date();
    } catch {
      notification.status = 'FAILED';
    }
    await em.flush();
    return notification;
  }

  // ---- Event/SLA helpers -----------------------------------------------------

  /** Notify each eligible approver that a document awaits them. */
  async notifyApprovalPending(
    documentId: string,
    approverUserIds: string[],
    opts: { overdue?: boolean } = {},
  ): Promise<void> {
    const doc = await this.loadDoc(documentId);
    if (!doc) return;
    const vars = await this.docVars(doc);
    const code = opts.overdue ? 'SLA_OVERDUE' : 'DOC_PENDING_APPROVAL';
    const verb = opts.overdue ? 'is overdue for your approval' : 'awaits your approval';
    for (const userId of approverUserIds) {
      await this.dispatch({
        userId,
        companyId: doc.company.id,
        channel: 'IN_APP',
        templateCode: code,
        documentId,
        vars,
        title: opts.overdue ? 'Approval overdue' : 'Pending approval',
        message: `Document ${vars.doc_no} ${verb}.`,
      });
    }
  }

  /**
   * Tell the approvers who were holding a document that its requester withdrew it.
   *
   * Their inbox lists documents by `IN_APPROVAL`, so a withdrawal makes the item disappear with no
   * explanation — and the next thing they hear is "Document is not in approval" on an approval they
   * were part-way through. The actors are resolved from the step it was withdrawn FROM, because
   * after the transition there is no current step to resolve them from.
   */
  async notifyWithdrawn(documentId: string, approverUserIds: string[], withdrawnBy?: string): Promise<void> {
    if (approverUserIds.length === 0) return;
    const doc = await this.loadDoc(documentId);
    if (!doc) return;
    const vars: Record<string, string> = { ...(await this.docVars(doc)), withdrawn_by: withdrawnBy ?? '' };
    const who = withdrawnBy ? ` by ${withdrawnBy}` : '';
    for (const userId of approverUserIds) {
      await this.dispatch({
        userId,
        companyId: doc.company.id,
        channel: 'IN_APP',
        templateCode: 'DOC_WITHDRAWN',
        documentId,
        vars,
        title: 'Document withdrawn',
        message: `Document ${vars.doc_no} was withdrawn${who} and no longer awaits your approval.`,
      });
    }
  }

  /** Notify the requester of a terminal outcome (approved / rejected / returned). */
  async notifyOutcome(documentId: string, status: string): Promise<void> {
    const doc = await this.loadDoc(documentId);
    if (!doc) return;
    const vars: Record<string, string> = { ...(await this.docVars(doc)), status };
    await this.dispatch({
      userId: doc.createdBy.id,
      companyId: doc.company.id,
      channel: 'IN_APP',
      templateCode: `DOC_${status}`,
      documentId,
      vars,
      title: `Document ${status}`,
      message: `Document ${vars.doc_no} is now ${status}.`,
    });
  }

  // ---- Retrieval & read tracking --------------------------------------------

  listForUser(
    userId: string,
    opts: { unreadOnly?: boolean } = {},
    q: PaginationQueryDto = {},
  ): Promise<Paginated<Notification>> {
    const where: Record<string, unknown> = { user: userId };
    if (opts.unreadOnly) where.isRead = false;
    return paginate(
      this.em.fork(),
      Notification,
      where,
      { ...FILTER_OFF, orderBy: { createdAt: 'DESC' } },
      q,
    );
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    const em = this.em.fork();
    const notification = await em.findOne(Notification, { id }, FILTER_OFF);
    if (!notification) throw new NotFoundException(`Notification ${id} not found`);
    if (notification.user.id !== userId) {
      throw new ForbiddenException('Cannot read another user’s notification');
    }
    notification.isRead = true;
    notification.readAt = new Date();
    await em.flush();
    return notification;
  }

  private loadDoc(documentId: string): Promise<Document | null> {
    return this.em.fork().findOne(Document, { id: documentId }, FILTER_OFF);
  }

  private async docVars(doc: Document): Promise<Record<string, string>> {
    const requester = await this.em.fork().findOne(AppUser, { id: doc.createdBy.id });
    return { doc_no: doc.docNo, requester_name: requester?.username ?? '' };
  }
}
