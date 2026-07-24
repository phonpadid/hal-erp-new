import { defineStore } from "pinia";
import type { LayoutConfig, LayoutState } from "../types/layout.type";
import { computed, ref, watch } from "vue";
import type { MenuItem } from "primevue/menuitem";
import { i18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import * as settingService from "../services/setting.service";
import type { AppLocale, UserSettingDto } from "../types/setting.dto";
import { applyAppTheme } from "../composables/useTheme";

/** Ordered sidebar sections; entries are grouped under these in the menu. Ordered by daily
 * use: everyday work first, then finance/accounting, reporting, then setup/admin at the end. */
export const NAV_SECTIONS = [
  "workspace",
  "control",
  "accounting",
  "reports",
  "masterData",
  "configuration",
  "organization",
  "administration",
] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

export interface NavEntry {
  key: string;
  icon: string;
  to: string;
  permission: string;
  section: NavSection;
}

/** ERP navigation, each entry gated by a permission code (invariant 5; UX only). */
export const NAV: NavEntry[] = [
  {
    key: "dashboard",
    icon: "pi pi-fw pi-home",
    to: "/",
    permission: "DOC_VIEW",
    section: "workspace",
  },
  {
    // Self-service attendance. In `workspace` beside documents rather than under `control`,
    // because punching is something an employee does about themselves, not something an
    // administrator does about a company.
    key: "myAttendance",
    icon: "pi pi-fw pi-clock",
    to: "/attendance/me",
    permission: "ATTEND_PUNCH_SELF",
    section: "workspace",
  },
  {
    key: "myAttendanceDays",
    icon: "pi pi-fw pi-calendar",
    to: "/attendance/my-days",
    permission: "ATTEND_DAY_SELF",
    section: "workspace",
  },
  {
    key: "documents",
    icon: "pi pi-fw pi-file",
    to: "/documents",
    permission: "DOC_VIEW",
    section: "workspace",
  },
  {
    key: "approvals",
    icon: "pi pi-fw pi-check-square",
    to: "/approvals",
    permission: "DOC_APPROVE",
    section: "workspace",
  },
  {
    key: "payments",
    icon: "pi pi-fw pi-money-bill",
    to: "/payments",
    permission: "PAYMENT_VIEW",
    section: "workspace",
  },
  {
    key: "paymentBatches",
    icon: "pi pi-fw pi-send",
    to: "/payment-batches",
    permission: "PAYMENT_BATCH_VIEW",
    section: "workspace",
  },
  {
    key: "budgets",
    icon: "pi pi-fw pi-wallet",
    to: "/budgets",
    permission: "BUDGET_VIEW",
    section: "control",
  },
  {
    key: "stock",
    icon: "pi pi-fw pi-box",
    to: "/stock",
    permission: "INV_VIEW",
    section: "control",
  },
  {
    key: "warehouses",
    icon: "pi pi-fw pi-building",
    to: "/warehouses",
    permission: "INV_MANAGE",
    section: "masterData",
  },
  {
    // HR attendance operations. `control`, not `workspace`: the self-service screens are what an
    // employee does about themselves, these are what an administrator does about a company.
    key: "attendancePeriods",
    icon: "pi pi-fw pi-calendar-times",
    to: "/attendance/periods",
    permission: "ATTEND_PERIOD_READ",
    section: "control",
  },
  {
    key: "teamAttendance",
    icon: "pi pi-fw pi-users",
    to: "/attendance/team",
    permission: "ATTEND_DAY_READ",
    section: "control",
  },
  {
    key: "punchLedger",
    icon: "pi pi-fw pi-list",
    to: "/attendance/ledger",
    permission: "ATTEND_PUNCH_READ",
    section: "control",
  },
  {
    key: "quota",
    icon: "pi pi-fw pi-chart-pie",
    to: "/quota",
    permission: "QUOTA_VIEW",
    section: "control",
  },
  {
    // Nav visibility is QUOTA_VIEW (spec: web-quota-admin "Permission-Gated Quota Admin
    // Affordances" — the entry shows for reads; create/edit/adjust/carry-forward buttons
    // inside QuotaAdminView are separately gated by QUOTA_MANAGE).
    key: "quotaAdmin",
    icon: "pi pi-fw pi-sliders-h",
    to: "/quota-admin",
    permission: "QUOTA_VIEW",
    section: "control",
  },
  {
    key: "reportBudgetBalance",
    icon: "pi pi-fw pi-wallet",
    to: "/reports/budget-balance",
    permission: "REPORT_VIEW",
    section: "reports",
  },
  {
    key: "reportBudgetUtilization",
    icon: "pi pi-fw pi-chart-bar",
    to: "/reports/budget-utilization",
    permission: "REPORT_VIEW",
    section: "reports",
  },
  {
    key: "reportDocuments",
    icon: "pi pi-fw pi-file",
    to: "/reports/documents",
    permission: "REPORT_VIEW",
    section: "reports",
  },
  {
    key: "reportSpendByVendor",
    icon: "pi pi-fw pi-shopping-cart",
    to: "/reports/spend-by-vendor",
    permission: "REPORT_VIEW",
    section: "reports",
  },
  {
    key: "reportApprovalAging",
    icon: "pi pi-fw pi-clock",
    to: "/reports/approval-aging",
    permission: "REPORT_VIEW",
    section: "reports",
  },
  {
    key: "reportQuotaRemaining",
    icon: "pi pi-fw pi-chart-pie",
    to: "/reports/quota-remaining",
    permission: "REPORT_VIEW",
    section: "reports",
  },
  {
    key: "reportBudgetAudit",
    icon: "pi pi-fw pi-verified",
    to: "/reports/budget-audit",
    permission: "REPORT_VIEW",
    section: "reports",
  },
  {
    key: "reportsGroup",
    icon: "pi pi-fw pi-globe",
    to: "/reports/group",
    permission: "REPORT_GROUP_VIEW",
    section: "reports",
  },
  {
    key: "reportTrialBalance",
    icon: "pi pi-fw pi-list",
    to: "/reports/trial-balance",
    permission: "GL_VIEW",
    section: "reports",
  },
  {
    key: "reportIncomeStatement",
    icon: "pi pi-fw pi-chart-line",
    to: "/reports/income-statement",
    permission: "GL_VIEW",
    section: "reports",
  },
  {
    key: "reportBalanceSheet",
    icon: "pi pi-fw pi-book",
    to: "/reports/balance-sheet",
    permission: "GL_VIEW",
    section: "reports",
  },
  {
    key: "masterData",
    icon: "pi pi-fw pi-box",
    to: "/master-data",
    permission: "MASTER_VIEW",
    section: "masterData",
  },
  {
    key: "jobLevels",
    icon: "pi pi-fw pi-sort-amount-up",
    to: "/job-levels",
    permission: "JOB_LEVEL_VIEW",
    section: "masterData",
  },
  {
    key: "access",
    icon: "pi pi-fw pi-lock",
    to: "/rbac-admin",
    permission: "RBAC_MANAGE",
    section: "administration",
  },
  {
    key: "employees",
    icon: "pi pi-fw pi-id-card",
    to: "/employee-admin",
    permission: "EMPLOYEE_MANAGE",
    section: "administration",
  },
  // Configuration is its own sidebar section; each entry is a directly-linkable
  // sub-area of the document-configuration admin (all gated by DOC_CONFIG_MANAGE;
  // the Workflows view further gates its mutations by WORKFLOW_MANAGE in-view).
  {
    key: "configTypes",
    icon: "pi pi-fw pi-file-edit",
    to: "/doc-config/types",
    permission: "DOC_CONFIG_MANAGE",
    section: "configuration",
  },
  {
    key: "configCategories",
    icon: "pi pi-fw pi-tags",
    to: "/doc-config/categories",
    permission: "DOC_CONFIG_MANAGE",
    section: "configuration",
  },
  {
    key: "configForms",
    icon: "pi pi-fw pi-pencil",
    to: "/doc-config/forms",
    permission: "DOC_CONFIG_MANAGE",
    section: "configuration",
  },
  {
    key: "configMappings",
    icon: "pi pi-fw pi-sitemap",
    to: "/doc-config/mappings",
    permission: "DOC_CONFIG_MANAGE",
    section: "configuration",
  },
  {
    key: "configWorkflows",
    icon: "pi pi-fw pi-share-alt",
    to: "/doc-config/workflows",
    permission: "DOC_CONFIG_MANAGE",
    section: "configuration",
  },
  {
    key: "orgCompanies",
    icon: "pi pi-fw pi-building",
    to: "/org-admin/companies",
    permission: "COMPANY_VIEW",
    section: "organization",
  },
  {
    key: "orgDepartments",
    icon: "pi pi-fw pi-sitemap",
    to: "/org-admin/departments",
    permission: "COMPANY_VIEW",
    section: "organization",
  },
  {
    key: "orgFiscalYears",
    icon: "pi pi-fw pi-calendar",
    to: "/org-admin/fiscal-years",
    permission: "COMPANY_VIEW",
    section: "organization",
  },
  {
    key: "orgHolidays",
    icon: "pi pi-fw pi-calendar-times",
    to: "/org-admin/holidays",
    permission: "COMPANY_VIEW",
    section: "organization",
  },
  {
    key: "currencies",
    icon: "pi pi-fw pi-dollar",
    to: "/currency-admin",
    permission: "CURRENCY_VIEW",
    section: "masterData",
  },
  {
    key: "accounts",
    icon: "pi pi-fw pi-book",
    to: "/accounts",
    permission: "COA_VIEW",
    section: "accounting",
  },
  {
    key: "journal",
    icon: "pi pi-fw pi-list",
    to: "/journal",
    permission: "GL_VIEW",
    section: "accounting",
  },
  {
    key: "taxCodes",
    icon: "pi pi-fw pi-percentage",
    to: "/tax-codes",
    permission: "TAX_VIEW",
    section: "accounting",
  },
  {
    key: "taxSummary",
    icon: "pi pi-fw pi-chart-bar",
    to: "/tax-summary",
    permission: "TAX_VIEW",
    section: "accounting",
  },
  {
    key: "delegations",
    icon: "pi pi-fw pi-send",
    to: "/approval-config",
    permission: "WORKFLOW_MANAGE",
    section: "configuration",
  },
];

/** Nav entries whose permission the user holds (pure; UX-only filter). */
export function visibleNav(can: (code: string) => boolean): NavEntry[] {
  return NAV.filter((n) => can(n.permission));
}

/**
 * Group the user's visible nav entries into ordered sections (pure; UX only).
 * A section with no visible entries is dropped, so an empty heading never shows.
 */
export function groupNav(
  can: (code: string) => boolean,
): { section: NavSection; entries: NavEntry[] }[] {
  const visible = visibleNav(can);
  return NAV_SECTIONS.flatMap((section) => {
    const entries = visible.filter((n) => n.section === section);
    return entries.length ? [{ section, entries }] : [];
  });
}

/** Fields in `current` that differ from `base` (the partial PUT patch). base null → all. */
export function diffSetting(
  current: UserSettingDto,
  base: UserSettingDto | null,
): Partial<UserSettingDto> {
  const patch: Partial<UserSettingDto> = {};
  for (const key of Object.keys(current) as (keyof UserSettingDto)[]) {
    if (!base || current[key] !== base[key])
      Object.assign(patch, { [key]: current[key] });
  }
  if ("darkTheme" in patch) patch.darkTheme = Boolean(patch.darkTheme);
  return patch;
}

export const useLayoutStore = defineStore("layout", () => {
  // Use the global i18n composer, not useI18n(): this store is created during app bootstrap
  // (main.ts, for pre-paint theming) where there is no component instance for useI18n() to bind to.
  const { t, locale } = i18n.global;
  const auth = useAuthStore();
  // computed เพื่อให้ label (t(...)) อัปเดตตามภาษาเมื่อ locale เปลี่ยน
  // Permission-gated ERP nav; computed so labels react to locale and grants to the active company.
  const model = computed<MenuItem[]>(() =>
    groupNav((c) => auth.can(c)).map(({ section, entries }) => ({
      label: t(`nav.sections.${section}`),
      items: entries.map((n) => ({
        label: t(`nav.${n.key}`),
        icon: n.icon,
        to: n.to,
      })),
    })),
  );
  const layoutConfig = ref<LayoutConfig>({
    preset: "Aura",
    primary: "brandRed",
    surface: "zinc",
    // ค่าเริ่มต้น = dark; "ค่าจาก backend ชนะ" เมื่อ user เคยตั้งค่าไว้ (loadUserSetting จะ override)
    darkTheme: true,
    menuMode: "static",
  });

  const layoutState = ref<LayoutState>({
    staticMenuInactive: false,
    overlayMenuActive: false,
    profileSidebarVisible: false,
    configSidebarVisible: false,
    sidebarExpanded: false,
    menuHoverActive: false,
    activeMenuItem: null,
    activePath: null,
    mobileMenuActive: false,
    anchored: false,
  });

  // ───────── User Setting (sync กับ backend ตาม docs/user-setting-api.md) ─────────
  // snapshot ของค่าที่ sync กับ backend ล่าสุด — ใช้ diff หา partial patch
  const loadedSnapshot = ref<UserSettingDto | null>(null);

  // รวมค่าปัจจุบัน (ธีม + ภาษา) เป็น UserSettingDto ชุดเดียว
  const currentSetting = (): UserSettingDto => ({
    ...layoutConfig.value,
    locale: locale.value as AppLocale,
  });

  // โหลดค่าจาก backend ใส่ layoutConfig + locale แล้ว apply ธีม
  const loadUserSetting = async () => {
    try {
      const { data } = await settingService.getUserSetting();
      const setting = data.data;
      // mutate ใน object เดิม (อย่าแทนที่ด้วย object ใหม่) เพื่อไม่ให้ consumer
      // ที่ destructure layoutConfig ไว้ (เช่น AppConfigurator/useLayout) ถือ reference เก่า
      // จนทำให้ deep watch ไม่ fire → ไม่ auto-save
      Object.assign(layoutConfig.value, {
        preset: setting.preset,
        primary: setting.primary,
        surface: setting.surface,
        darkTheme: setting.darkTheme,
        menuMode: setting.menuMode,
      });
      if (setting.locale) locale.value = setting.locale;
      applyAppTheme(layoutConfig.value);
    } catch {
      // API ยังไม่พร้อม / ยังไม่ได้ login → คงค่า default เดิมไว้
    } finally {
      // snapshot = ค่าที่ apply จริง (ทั้ง path สำเร็จและ fallback) เพื่อให้ diff ครั้งถัดไปถูกต้อง
      loadedSnapshot.value = currentSetting();
      // เริ่มบันทึกอัตโนมัติได้หลังโหลดเสร็จ (กัน save ซ้ำตอนเซ็ตค่าจากการโหลด)
      autoSaveReady.value = true;
    }
  };

  // บันทึกเฉพาะฟิลด์ที่เปลี่ยนจาก snapshot ล่าสุด (PUT upsert + partial)
  const saveUserSetting = async () => {
    const current = currentSetting();
    const patch = diffSetting(current, loadedSnapshot.value);
    // ไม่มีอะไรเปลี่ยน → ไม่ยิง request
    if (Object.keys(patch).length === 0) return;
    try {
      await settingService.updateUserSetting(patch);
      // sync snapshot หลังบันทึกสำเร็จ เพื่อให้ diff ครั้งถัดไปถูกต้อง
      loadedSnapshot.value = current;
    } catch {
      // เงียบไว้ก่อน — ไม่ให้ขัดจังหวะการใช้งานถ้า API ล้ม
    }
  };

  // auto-save แบบ debounce เมื่อ layoutConfig หรือ locale เปลี่ยน
  const autoSaveReady = ref(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersist = () => {
    if (!autoSaveReady.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveUserSetting(), 600);
  };
  watch(layoutConfig, schedulePersist, { deep: true });
  watch(locale, schedulePersist);

  return {
    layoutConfig,
    layoutState,
    model,
    loadUserSetting,
    saveUserSetting,
  };
});
