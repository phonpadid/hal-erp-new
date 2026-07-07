import api from "@/shared/services/api";
import type { UserSettingDto } from "../types/setting.dto";

export const endpointUserSetting = "/user/setting";

/** GET /api/user/setting — ดึงการตั้งค่าของ user ปัจจุบัน (อ้างอิงจาก token) */
export const getUserSetting = async () => await api.get(endpointUserSetting);

/** PUT /api/user/setting — บันทึก/อัปเดต (upsert) รองรับ partial */
export const updateUserSetting = async (payload: Partial<UserSettingDto>) =>
  await api.put(endpointUserSetting, payload);
