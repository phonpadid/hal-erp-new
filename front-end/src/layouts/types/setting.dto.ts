import type { LayoutConfig } from "./layout.type";

export type AppLocale = "la" | "en";

/**
 * โครงสร้างการตั้งค่าส่วนตัวของผู้ใช้ ตรงกับ contract ใน docs/user-setting-api.md
 * = ธีม (LayoutConfig) + ภาษา (locale)
 */
export interface UserSettingDto extends LayoutConfig {
  locale: AppLocale;
}

/** ค่า default ใช้เป็น fallback เมื่อยังไม่เคยตั้งค่า หรือ API ยังไม่พร้อม */
export const defaultUserSetting: UserSettingDto = {
  preset: "Aura",
  primary: "yellow",
  surface: "stone",
  // default = false ตามที่ตกลงกับ backend (user ใหม่ขึ้น light mode ไม่อิง system pref)
  darkTheme: false,
  menuMode: "static",
  locale: "la",
};
