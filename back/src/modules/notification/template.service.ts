import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationTemplate } from './notification.entities';
import type { CreateTemplateDto, UpdateTemplateDto } from './dto/notification.dto';

export interface RenderedMessage {
  subject: string;
  body: string;
}

/** notification_template registry + `{var}` rendering. */
@Injectable()
export class TemplateService {
  constructor(private readonly em: EntityManager) {}

  async create(dto: CreateTemplateDto): Promise<NotificationTemplate> {
    const template = this.em.create(NotificationTemplate, {
      code: dto.code,
      channel: dto.channel,
      subjectTemplate: dto.subjectTemplate,
      bodyTemplate: dto.bodyTemplate,
      isActive: true,
    });
    await this.em.persistAndFlush(template);
    return template;
  }

  async update(code: string, dto: UpdateTemplateDto): Promise<NotificationTemplate> {
    const template = await this.getActive(code);
    if (dto.subjectTemplate !== undefined) template.subjectTemplate = dto.subjectTemplate;
    if (dto.bodyTemplate !== undefined) template.bodyTemplate = dto.bodyTemplate;
    if (dto.isActive !== undefined) template.isActive = dto.isActive;
    await this.em.flush();
    return template;
  }

  list(): Promise<NotificationTemplate[]> {
    return this.em.find(NotificationTemplate, {});
  }

  /** Active template by code, or null (callers fall back to literals). */
  findActive(code: string): Promise<NotificationTemplate | null> {
    return this.em.findOne(NotificationTemplate, { code, isActive: true });
  }

  private async getActive(code: string): Promise<NotificationTemplate> {
    const t = await this.em.findOne(NotificationTemplate, { code });
    if (!t) throw new NotFoundException(`Notification template '${code}' not found`);
    return t;
  }

  /** Substitute {key} placeholders; missing keys render empty. */
  render(template: NotificationTemplate, vars: Record<string, string>): RenderedMessage {
    return {
      subject: TemplateService.apply(template.subjectTemplate ?? '', vars),
      body: TemplateService.apply(template.bodyTemplate ?? '', vars),
    };
  }

  static apply(text: string, vars: Record<string, string>): string {
    return text.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
  }
}
