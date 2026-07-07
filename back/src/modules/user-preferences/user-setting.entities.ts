import { Entity, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../common/entities/base.entity';
import { AppUser } from '../rbac/rbac.entities';

/**
 * Per-user UI settings (theme + locale). NOT company-scoped — a user keeps one set
 * of preferences across all their companies. One row per user.
 */
@Entity({ tableName: 'user_setting' })
@Unique({ properties: ['user'] })
export class UserSetting extends BaseEntity {
  @ManyToOne(() => AppUser, { fieldName: 'user_id' })
  user!: AppUser;

  @Property({ default: 'Aura' })
  preset: string = 'Aura';

  @Property({ default: 'yellow' })
  primary: string = 'yellow';

  @Property({ default: 'stone' })
  surface: string = 'stone';

  @Property({ default: false })
  darkTheme: boolean = false;

  @Property({ default: 'static' })
  menuMode: string = 'static';

  @Property({ default: 'la' })
  locale: string = 'la';

  @Property({ columnType: 'timestamptz', nullable: true })
  updatedAt?: Date;
}
