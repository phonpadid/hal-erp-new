import { Entity, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Document } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';

// notification_template — central; body supports vars like {doc_no} {requester_name}.
@Entity({ tableName: 'notification_template' })
export class NotificationTemplate extends BaseEntity {
  @Property({ unique: true })
  code!: string;

  // EMAIL / IN_APP / LINE / SMS
  @Property()
  channel!: string;

  @Property({ nullable: true })
  subjectTemplate?: string;

  @Property({ type: 'text', nullable: true })
  bodyTemplate?: string;

  @Property({ default: true })
  isActive: boolean = true;
}

@Entity({ tableName: 'notification' })
@Index({ properties: ['user', 'isRead'] })
export class Notification extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => AppUser)
  user!: AppUser;

  @ManyToOne(() => NotificationTemplate, { nullable: true })
  template?: NotificationTemplate;

  @Index()
  @ManyToOne(() => Document, { nullable: true })
  document?: Document;

  @Property()
  channel!: string;

  @Property({ nullable: true })
  title?: string;

  @Property({ type: 'text', nullable: true })
  message?: string;

  @Property({ default: 'PENDING' })
  status: string = 'PENDING';

  @Property({ default: false })
  isRead: boolean = false;

  @Property({ columnType: 'timestamptz', nullable: true })
  readAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}
