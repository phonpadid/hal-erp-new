<script setup lang="ts">
/**
 * A one-line reminder at the top of every page, for whoever prepares a fiscal year, from thirty
 * days before the year ends until the next one is ready — and every day after the year has turned
 * unprepared. Hidden for the rest of the day when dismissed; the daily notification still arrives.
 */
import Button from 'primevue/button';
import Message from 'primevue/message';
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '../../stores/auth';
import { useFiscalYearReadiness } from './useFiscalYearReadiness';

const auth = useAuthStore();
const { data, needsAttention, load } = useFiscalYearReadiness();

// Per viewer, per company, per local day — a convenience, never the source of truth, so every read
// and write tolerates storage being unavailable.
const storageKey = computed(() => `fyReadinessDismissed:${auth.activeCompanyId ?? ''}`);
const dismissedOn = ref<string | null>(null);
function readDismissed() {
  try {
    dismissedOn.value = localStorage.getItem(storageKey.value);
  } catch {
    dismissedOn.value = null;
  }
}
function dismiss() {
  if (!data.value) return;
  dismissedOn.value = data.value.today;
  try {
    localStorage.setItem(storageKey.value, data.value.today);
  } catch {
    // Private window or blocked storage: hidden for this page view only.
  }
}

const visible = computed(() => needsAttention.value && dismissedOn.value !== data.value?.today);

onMounted(() => {
  readDismissed();
  void load();
});
</script>

<template>
  <Message v-if="visible && data" severity="warn" :closable="false" class="mb-3" data-testid="fy-readiness-banner">
    <div class="flex flex-wrap items-center gap-2">
      <i class="pi pi-calendar-times" />
      <span v-if="data.blockedNow">{{ $t('admin.org.readiness.bannerBlocked', { year: data.target.year }) }}</span>
      <span v-else>{{ $t('admin.org.readiness.banner', { year: data.target.year, days: data.daysLeft }) }}</span>
      <RouterLink :to="{ name: 'org-fiscal-years' }" class="font-medium text-primary">
        {{ $t('admin.org.readiness.check') }}
      </RouterLink>
      <Button
        :label="$t('admin.org.readiness.dismiss')"
        text
        size="small"
        severity="secondary"
        class="ml-auto"
        data-testid="fy-readiness-dismiss"
        @click="dismiss()"
      />
    </div>
  </Message>
</template>
