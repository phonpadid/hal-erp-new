<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useNotificationsStore } from '@/stores/notifications';
import StatCard from './StatCard.vue';

const { t } = useI18n();
const notifications = useNotificationsStore();
onMounted(() => notifications.load());
</script>

<template>
  <StatCard
    icon="pi-bell"
    :label="t('dashboard.unreadNotifications')"
    :hint="t('dashboard.unreadNotificationsHint')"
    :value="notifications.unreadCount"
    :loading="notifications.loading"
    :error="notifications.error"
    to="/notifications"
  />
</template>
