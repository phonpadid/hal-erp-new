<script setup lang="ts">
import Button from 'primevue/button';
import Select from 'primevue/select';
import { computed, onMounted, ref } from 'vue';
import { RouterView, useRouter } from 'vue-router';
import NotificationBell from '../components/NotificationBell.vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

// Permission-gated nav (UX only; the server still enforces).
const nav = computed(() =>
  [
    { label: 'Documents', to: 'documents', permission: 'DOC_VIEW' as string | undefined },
    { label: 'Approvals', to: 'approvals', permission: 'DOC_APPROVE' as string | undefined },
    { label: 'Payments', to: 'payments', permission: 'PAYMENT_VIEW' as string | undefined },
    { label: 'Budgets', to: 'budgets', permission: 'BUDGET_VIEW' as string | undefined },
    { label: 'Master data', to: 'master-data', permission: 'MASTER_VIEW' as string | undefined },
    { label: 'Quota', to: 'quota', permission: 'QUOTA_VIEW' as string | undefined },
    { label: 'Quota admin', to: 'quota-admin', permission: 'QUOTA_MANAGE' as string | undefined },
    { label: 'Access', to: 'rbac-admin', permission: 'RBAC_MANAGE' as string | undefined },
    { label: 'API keys', to: 'api-keys', permission: 'API_KEY_MANAGE' as string | undefined },
    { label: 'Configuration', to: 'doc-config-types', permission: 'DOC_CONFIG_MANAGE' as string | undefined },
  ].filter((i) => !i.permission || auth.can(i.permission)),
);

const dark = ref(false);
function toggleDark() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle('dark', dark.value);
}

async function onSwitch(companyId: string) {
  if (companyId && companyId !== auth.activeCompanyId) {
    await auth.selectCompany(companyId);
    // Full reload to the dashboard: drops every company-scoped store's cached data so no
    // prior-company rows linger (invariant 1: company isolation), and re-runs the route
    // guard against the new company's permissions. The persisted token lets restore()
    // rebuild the new session seamlessly.
    window.location.assign('/');
  }
}

async function logout() {
  auth.logout();
  await router.push({ name: 'login' });
}

onMounted(() => {
  if (auth.companies.length === 0) auth.loadCompanies().catch(() => undefined);
});
</script>

<template>
  <div class="min-h-screen bg-surface-0 dark:bg-surface-950 text-color">
    <header class="flex items-center gap-4 p-3 border-b border-surface">
      <span class="font-semibold">Multi-Company ERP</span>

      <nav class="flex items-center gap-2">
        <Button
          v-for="item in nav"
          :key="item.label"
          :label="item.label"
          text
          size="small"
          @click="router.push({ name: item.to })"
        />
      </nav>

      <div class="ml-auto flex items-center gap-3">
        <Select
          :modelValue="auth.activeCompanyId"
          :options="auth.companies"
          optionLabel="nameTh"
          optionValue="id"
          placeholder="Company"
          class="w-48"
          @update:modelValue="onSwitch"
        />
        <span class="text-sm text-muted-color">{{ auth.userId ? 'Signed in' : '' }}</span>
        <NotificationBell v-if="auth.can('NOTIFICATION_VIEW')" />
        <Button
          :icon="dark ? 'pi pi-sun' : 'pi pi-moon'"
          severity="secondary"
          text
          rounded
          aria-label="Toggle dark mode"
          @click="toggleDark"
        />
        <Button icon="pi pi-sign-out" severity="secondary" text rounded aria-label="Log out" @click="logout" />
      </div>
    </header>

    <main class="p-4">
      <RouterView />
    </main>
  </div>
</template>
