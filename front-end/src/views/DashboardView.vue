<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import PendingApprovalsWidget from '@/components/dashboard/PendingApprovalsWidget.vue';
import MyDocumentsWidget from '@/components/dashboard/MyDocumentsWidget.vue';
import UnreadNotificationsWidget from '@/components/dashboard/UnreadNotificationsWidget.vue';
import BudgetUtilizationWidget from '@/components/dashboard/BudgetUtilizationWidget.vue';

// Each widget is gated by its feature permission code (UX only; server stays
// authoritative). v-if means a widget the user can't see also never fetches.
const auth = useAuthStore();
const anyWidget = computed(
  () =>
    auth.can('DOC_APPROVE') ||
    auth.can('DOC_VIEW') ||
    auth.can('NOTIFICATION_VIEW') ||
    auth.can('BUDGET_VIEW'),
);
</script>

<template>
  <div>
    <PageHeader :title="$t('dashboard.title')" :subtitle="$t('dashboard.subtitle')" />

    <div v-if="anyWidget" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      <PendingApprovalsWidget v-if="auth.can('DOC_APPROVE')" />
      <MyDocumentsWidget v-if="auth.can('DOC_VIEW')" />
      <UnreadNotificationsWidget v-if="auth.can('NOTIFICATION_VIEW')" />
      <div v-if="auth.can('BUDGET_VIEW')" class="sm:col-span-2 xl:col-span-3">
        <BudgetUtilizationWidget />
      </div>
    </div>

    <EmptyState v-else icon="pi pi-th-large" :title="$t('dashboard.noWidgets')" />
  </div>
</template>
