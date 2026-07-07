<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { documentIdOf } from '../../api/notifications';
import { useNotificationsStore } from '../../stores/notifications';
import type { NotificationItem } from '../../api/notifications';
import { formatDate } from '@/utils/date';

const { t } = useI18n();
const fb = useFeedback();
const router = useRouter();
const notifications = useNotificationsStore();
const unreadOnly = ref(false);

const rows = computed(() =>
  unreadOnly.value ? notifications.items.filter((n) => !n.isRead) : notifications.items,
);

// markRead/markAllRead set notifications.error on failure (void return); clear it
// first, then toast success/failure based on whether an error was recorded.
async function markRead(id: string) {
  notifications.error = '';
  await notifications.markRead(id);
  if (notifications.error) fb.error(notifications.error);
  else fb.success(t('feedback.done'));
}
async function markAllRead() {
  notifications.error = '';
  await notifications.markAllRead();
  if (notifications.error) fb.error(notifications.error);
  else fb.success(t('feedback.done'));
}

async function open(n: NotificationItem) {
  await notifications.markRead(n.id);
  const docId = documentIdOf(n);
  if (docId) router.push({ name: 'document-detail', params: { id: docId } });
}

onMounted(() => notifications.load());
</script>

<template>
  <div>
    <PageHeader :title="$t('notifications.inbox.title')" />

    <PageToolbar>
      <template #filters>
        <label class="text-sm text-muted-color flex items-center gap-2"><ToggleSwitch v-model="unreadOnly" /> {{ $t('notifications.inbox.unreadOnly') }}</label>
      </template>
      <template #actions>
        <Button :label="$t('notifications.inbox.markAllRead')" size="small" outlined :disabled="!notifications.unreadCount" @click="markAllRead()" />
      </template>
    </PageToolbar>

    <ErrorState v-if="notifications.error" :message="notifications.error" @retry="notifications.load()" />

    <div v-else class="card">
      <AppDataTable
        :value="rows"
        :total="notifications.total"
        :loading="notifications.loading"
        :page="notifications.page"
        :rows="notifications.limit"
        :rowHover="true"
        @page="(e: any) => notifications.load(e.page, e.limit)"
        @refresh="notifications.load()"
        @row-click="(e: any) => open(e.data)"
      >
        <Column header="">
          <template #body="{ data }"><span class="w-2 h-2 rounded-full inline-block" :class="data.isRead ? 'bg-transparent' : 'bg-primary'" /></template>
        </Column>
        <Column :header="$t('notifications.inbox.message')"><template #body="{ data }">{{ data.subject ?? data.body }}</template></Column>
        <Column field="createdAt" :header="$t('notifications.inbox.at')"><template #body="{ data }">{{ formatDate(data.createdAt) }}</template></Column>
        <Column header="">
          <template #body="{ data }">
            <Button v-if="!data.isRead" :label="$t('notifications.inbox.markRead')" text size="small" @click.stop="markRead(data.id)" />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-bell" :title="$t('notifications.inbox.empty')" />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
