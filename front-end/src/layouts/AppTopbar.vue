<script setup lang="ts">
import { useLayout } from "./composables/layout";
import AppConfigurator from "./AppConfigurator.vue";
import NotificationBell from "@/components/NotificationBell.vue";
import { useAuthStore } from "@/stores/auth";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import type { AppLocale } from "./types/setting.dto";

const { toggleMenu, toggleDarkMode, isDarkTheme } = useLayout();
const auth = useAuthStore();
const router = useRouter();

async function logout() {
  auth.logout();
  await router.push({ name: "login" });
}

async function onSwitchCompany(companyId: string) {
  if (companyId && companyId !== auth.activeCompanyId) {
    await auth.selectCompany(companyId);
    // Full reload to the dashboard: drops every company-scoped store's cached data so no
    // prior-company rows linger (invariant 1: company isolation), and re-runs the route
    // guard against the new company's permissions. The persisted token lets restore()
    // rebuild the new session seamlessly.
    window.location.assign('/');
  }
}

// สลับภาษา la ↔ en — การเปลี่ยน locale ถูกจับโดย watch(locale) ใน layout.store → auto-save อัตโนมัติ
const { locale } = useI18n();
const localeOptions: { label: string; value: AppLocale }[] = [
  { label: "ລາວ", value: "la" },
  { label: "English", value: "en" },
];
</script>

<template>
  <div class="layout-topbar">
    <div class="layout-topbar-logo-container">
      <button
        class="layout-menu-button layout-topbar-action"
        @click="toggleMenu"
      >
        <i class="pi pi-bars"></i>
      </button>
      <router-link to="/" class="layout-topbar-logo">
        <img src="/logo_hal.png" alt="logo" width="30" />

        <span class="font-bold">HAL ERP</span>
      </router-link>
    </div>

    <div class="layout-topbar-actions">
      <div class="layout-config-menu">
        <Select
          v-if="auth.companies.length"
          :modelValue="auth.activeCompanyId"
          :options="auth.companies"
          optionLabel="nameTh"
          optionValue="id"
          :placeholder="$t('topbar.companyPlaceholder')"
          class="w-44"
          @update:modelValue="onSwitchCompany"
        />
        <NotificationBell v-if="auth.can('NOTIFICATION_VIEW')" />
        <SelectButton
          v-model="locale"
          optionValue="value"
          optionLabel="label"
          :options="localeOptions"
        />
        <button
          type="button"
          class="layout-topbar-action"
          @click="toggleDarkMode"
        >
          <i
            :class="['pi', { 'pi-moon': isDarkTheme, 'pi-sun': !isDarkTheme }]"
          ></i>
        </button>
        <div class="relative">
          <button
            v-styleclass="{
              selector: '@next',
              enterFromClass: 'hidden',
              enterActiveClass: 'p-anchored-overlay-enter-active',
              leaveToClass: 'hidden',
              leaveActiveClass: 'p-anchored-overlay-leave-active',
              hideOnOutsideClick: true,
            }"
            type="button"
            class="layout-topbar-action layout-topbar-action-highlight"
          >
            <i class="pi pi-palette"></i>
          </button>
          <AppConfigurator />
        </div>
      </div>

      <button
        class="layout-topbar-menu-button layout-topbar-action"
        v-styleclass="{
          selector: '@next',
          enterFromClass: 'hidden',
          enterActiveClass: 'p-anchored-overlay-enter-active',
          leaveToClass: 'hidden',
          leaveActiveClass: 'p-anchored-overlay-leave-active',
          hideOnOutsideClick: true,
        }"
      >
        <i class="pi pi-ellipsis-v"></i>
      </button>

      <div class="layout-topbar-menu hidden lg:block">
        <div class="layout-topbar-menu-content">
          <!-- <button type="button" class="layout-topbar-action">
            <i class="pi pi-calendar"></i>
            <span>Calendar</span>
          </button>
          <button type="button" class="layout-topbar-action">
            <i class="pi pi-inbox"></i>
            <span>Messages</span>
          </button>

          <button type="button" class="layout-topbar-action">
            <i class="pi pi-inbox"></i>
            <span></span>
          </button> -->
          <button type="button" class="layout-topbar-action" @click="logout">
            <i class="pi pi-sign-out"></i>
            <span>{{ $t("topbar.logout") }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
