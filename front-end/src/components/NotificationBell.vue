<script setup lang="ts">
import Button from 'primevue/button';
import OverlayBadge from 'primevue/overlaybadge';
import Popover from 'primevue/popover';
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { documentIdOf } from '../api/notifications';
import { useNotificationsStore } from '../stores/notifications';
import type { NotificationItem } from '../api/notifications';

const POLL_MS = 60_000;
const router = useRouter();
const notifications = useNotificationsStore();
const op = ref();
let timer: ReturnType<typeof setInterval> | undefined;

function toggle(e: Event) {
  op.value?.toggle(e);
}

async function open(n: NotificationItem) {
  await notifications.markRead(n.id);
  op.value?.hide();
  const docId = documentIdOf(n);
  if (docId) router.push({ name: 'document-detail', params: { id: docId } });
}

onMounted(() => {
  notifications.load();
  timer = setInterval(() => notifications.load(), POLL_MS);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div>
    <OverlayBadge v-if="notifications.unreadCount" :value="String(notifications.unreadCount)" severity="danger">
      <Button icon="pi pi-bell" severity="secondary" text rounded :aria-label="$t('notifications.bell.ariaLabel')" @click="toggle" />
    </OverlayBadge>
    <Button v-else icon="pi pi-bell" severity="secondary" text rounded :aria-label="$t('notifications.bell.ariaLabel')" @click="toggle" />

    <Popover ref="op">
      <div class="w-80">
        <div class="flex items-center justify-between mb-2">
          <span class="font-semibold text-color">{{ $t('notifications.bell.title') }}</span>
          <Button :label="$t('notifications.bell.viewAll')" text size="small" @click="op?.hide(); router.push({ name: 'notifications' })" />
        </div>
        <ul class="flex flex-col gap-1 max-h-80 overflow-auto">
          <li
            v-for="n in notifications.items.slice(0, 8)"
            :key="n.id"
            class="flex gap-2 items-start p-2 rounded cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="open(n)"
          >
            <span class="mt-1 w-2 h-2 rounded-full shrink-0" :class="n.isRead ? 'bg-transparent' : 'bg-primary'" />
            <div class="text-sm">
              <div class="text-color">{{ n.subject ?? n.body }}</div>
              <div class="text-muted-color text-xs">{{ n.createdAt }}</div>
            </div>
          </li>
          <li v-if="!notifications.items.length" class="text-muted-color text-sm p-2">{{ $t('notifications.bell.empty') }}</li>
        </ul>
      </div>
    </Popover>
  </div>
</template>
