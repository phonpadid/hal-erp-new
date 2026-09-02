<script setup lang="ts">
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import ErrorState from '@/components/ErrorState.vue';
import { useFeedback } from '../../composables/useFeedback';
import { useAttendanceStore } from '../../stores/attendance';
import { formatDateTime } from '../../utils/date';

/**
 * The punch screen — the only part of this module an ordinary employee touches, and the only thing
 * that puts real observations into the ledger.
 *
 * Deliberately NOT the desktop shell the rest of the app uses. `AppDataTable` fixes a 400px scroll
 * height and forces `white-space: nowrap` so wide financial tables scroll sideways on a monitor;
 * both are exactly wrong for somebody standing at a gate holding a phone. The punch controls are
 * large and first, and today's punches are a plain vertical list underneath.
 */
const { t } = useI18n();
const fb = useFeedback();
const store = useAttendanceStore();

onMounted(() => store.loadToday());

/** Which control is the obvious one: the opposite of the way they are currently facing. */
const nextDirection = computed<'IN' | 'OUT'>(() => (store.isCheckedIn ? 'OUT' : 'IN'));

const statusLabel = computed(() => {
  if (!store.hasPunchedToday) return t('attendance.punch.statusNone');
  return store.isCheckedIn ? t('attendance.punch.statusIn') : t('attendance.punch.statusOut');
});

/**
 * The location outcome in words. All four stay distinct because they lead to different actions:
 * "unavailable" is fixed by serving over https, "denied" is fixed in the browser, and one message
 * covering both leaves nobody able to tell which they are looking at.
 */
const locationMessage = computed(() =>
  store.locationStatus ? t(`attendance.punch.location.${store.locationStatus}`) : '',
);

async function punch(direction: 'IN' | 'OUT') {
  const ok = await store.punch(direction);
  // The store already refreshed the day; the view only reports.
  if (ok) fb.success(t('attendance.punch.recorded'));
  else fb.error(store.error);
}
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold text-color">{{ $t('attendance.punch.title') }}</h1>
      <p class="text-sm text-muted-color">{{ $t('attendance.punch.subtitle') }}</p>
    </header>

    <ErrorState v-if="store.error && !store.punching" :message="store.error" @retry="store.loadToday()" />

    <section class="card flex flex-col items-center gap-4 py-6">
      <Tag
        :value="statusLabel"
        :severity="store.isCheckedIn ? 'success' : 'secondary'"
        class="text-base"
      />

      <!-- One large primary control, reachable with a thumb without scrolling. -->
      <Button
        :label="nextDirection === 'IN' ? $t('attendance.punch.checkIn') : $t('attendance.punch.checkOut')"
        :icon="nextDirection === 'IN' ? 'pi pi-sign-in' : 'pi pi-sign-out'"
        :severity="nextDirection === 'IN' ? 'success' : 'warn'"
        :loading="store.punching"
        size="large"
        class="w-full py-4 text-lg"
        @click="punch(nextDirection)"
      />

      <!-- The other direction stays available: somebody who mis-pressed should not be stuck. -->
      <Button
        :label="nextDirection === 'IN' ? $t('attendance.punch.checkOut') : $t('attendance.punch.checkIn')"
        text
        size="small"
        :disabled="store.punching"
        @click="punch(nextDirection === 'IN' ? 'OUT' : 'IN')"
      />

      <p v-if="locationMessage" class="text-center text-sm text-muted-color">
        <i class="pi pi-map-marker mr-1" />{{ locationMessage }}
      </p>
      <p v-else-if="store.punching" class="text-center text-sm text-muted-color">
        {{ $t('attendance.punch.location.pending') }}
      </p>
    </section>

    <section class="card flex flex-col gap-3">
      <h2 class="text-lg font-medium text-color">{{ $t('attendance.punch.today') }}</h2>

      <p v-if="!store.todayEvents.length" class="py-4 text-center text-sm text-muted-color">
        {{ $t('attendance.punch.empty') }}
      </p>

      <ul v-else class="flex flex-col gap-2">
        <li
          v-for="event in store.todayEvents"
          :key="event.id"
          class="flex items-center justify-between gap-3 rounded border border-surface px-3 py-2"
        >
          <span class="flex items-center gap-2">
            <i
              :class="event.direction === 'IN' ? 'pi pi-sign-in text-primary' : 'pi pi-sign-out text-muted-color'"
            />
            <span class="font-medium text-color">
              {{ event.direction === 'IN' ? $t('attendance.punch.directionIn') : $t('attendance.punch.directionOut') }}
            </span>
          </span>
          <span class="min-w-0 truncate text-sm text-muted-color">
            {{ formatDateTime(event.occurredAt) }}
          </span>
          <span class="shrink-0 text-xs text-muted-color">
            {{ $t(`attendance.punch.geofence.${event.geofenceStatus}`) }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
