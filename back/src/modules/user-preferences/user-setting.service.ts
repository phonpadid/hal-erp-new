import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { AppUser } from '../rbac/rbac.entities';
import { UserSetting } from './user-setting.entities';

export interface UserSettingDto {
  preset: string;
  primary: string;
  surface: string;
  darkTheme: boolean;
  menuMode: string;
  locale: string;
}

/** Defaults for a user who has never saved settings (new user → light mode, la). */
export const DEFAULT_USER_SETTING: UserSettingDto = {
  preset: 'Aura',
  primary: 'brandRed',
  surface: 'stone',
  darkTheme: false,
  menuMode: 'static',
  locale: 'la',
};

const FIELDS: (keyof UserSettingDto)[] = ['preset', 'primary', 'surface', 'darkTheme', 'menuMode', 'locale'];

function toDto(row: UserSetting): UserSettingDto {
  return {
    preset: row.preset, primary: row.primary, surface: row.surface,
    darkTheme: row.darkTheme, menuMode: row.menuMode, locale: row.locale,
  };
}

@Injectable()
export class UserSettingService {
  constructor(private readonly em: EntityManager) {}

  /** The user's settings, or the defaults when none saved. */
  async getForUser(userId: string): Promise<UserSettingDto> {
    const row = await this.em.fork().findOne(UserSetting, { user: userId });
    return row ? toDto(row) : { ...DEFAULT_USER_SETTING };
  }

  /** Create-or-update only the provided keys; returns the resulting full settings. */
  async upsertForUser(userId: string, patch: Partial<UserSettingDto>): Promise<UserSettingDto> {
    const em = this.em.fork();
    let row = await em.findOne(UserSetting, { user: userId });
    if (!row) {
      row = em.create(UserSetting, { ...DEFAULT_USER_SETTING, user: em.getReference(AppUser, userId) });
    }
    for (const key of FIELDS) {
      if (patch[key] !== undefined) (row as any)[key] = patch[key];
    }
    row.updatedAt = new Date();
    await em.persistAndFlush(row);
    return toDto(row);
  }
}
