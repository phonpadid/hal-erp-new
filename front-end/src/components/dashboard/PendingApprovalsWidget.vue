<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useApprovalsStore } from '@/stores/approvals';
import StatCard from './StatCard.vue';

// Loads independently of the other widgets; failure surfaces in this card only.
const { t } = useI18n();
const approvals = useApprovalsStore();
onMounted(() => approvals.loadPending());
</script>

<template>
  <StatCard
    icon="pi-check-square"
    :label="t('dashboard.pendingApprovals')"
    :hint="t('dashboard.pendingApprovalsHint')"
    :value="approvals.pending.length"
    :loading="approvals.loading"
    :error="approvals.error"
    to="/approvals"
  />
</template>
