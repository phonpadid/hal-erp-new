<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DatePicker from 'primevue/datepicker';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppDataTable from '@/components/AppDataTable.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { useAttendanceHrStore } from '../../stores/attendanceHr';
import { formatDate } from '../../utils/date';

/**
 * Everyone's computed days, and the button that rebuilds them.
 *
 * The recompute button is offered for any range, including one that overlaps a closed period. That
 * is deliberate: `recomputeRange` already skips closed dates and `recomputeDay` already refuses one
 * outright, both with a message naming the period. Filtering the button here would put a second
 * copy of the closed-period rule in the client, where it would drift from the one that matters.
 */
const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useAttendanceHrStore();

const canRecompute = computed(() => auth.can('ATTEND_DAY_RECOMPUTE'));

const range = ref<Date[] | null>(null);
const status = ref<string | null>(null);

const STATUSES = ['PRESENT', 'ABSENT', 'INCOMPLETE', 'LEAVE', 'HOLIDAY', 'DAY_OFF', 'EXEMPT', 'NO_SHIFT'];
const statusOptions = computed(() => [
  { value: null, label: t('attendance.hr.team.filters.all') },
  ...STATUSES.map((value) => ({ value, label: t(`attendance.status.${value}`) })),
]);

onMounted(() => {
  store.loadTeamDays();
  store.loadStaleLeave();
});

watch([range, status], () => {
  const [from, to] = range.value ?? [];
  store.setTeamFilters({
    dateFrom: from ? toIsoDate(from) : undefined,
    dateTo: to ? toIsoDate(to) : undefined,
    status: status.value ?? undefined,
  });
});

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function recomputeCompany() {
  const [from, to] = range.value ?? [];
  if (!from) return;
  const written = await store.recomputeCompany(toIsoDate(from), to ? toIsoDate(to) : undefined);
  // A refusal reaches the user as the server phrased it — including the closed-period message that
  // names the period, which is more useful than anything this screen could invent.
  if (written === null) fb.error(store.error);
  else fb.success(t('attendance.hr.team.recomputed', { count: written }));
}

function severityOf(s: string): string {
  if (s === 'PRESENT') return 'success';
  if (s === 'ABSENT') return 'danger';
  if (s === 'INCOMPLETE') return 'warn';
  if (s === 'LEAVE') return 'info';
  return 'secondary';
}
</script>

<template>
  <div>
    <PageHeader :title="$t('attendance.hr.team.title')" :subtitle="$t('attendance.hr.team.subtitle')" />

    <div class="mb-3 flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-1 text-sm text-muted-color">
        {{ $t('attendance.hr.team.filters.from') }} / {{ $t('attendance.hr.team.filters.to') }}
        <DatePicker v-model="range" selectionMode="range" dateFormat="yy-mm-dd" showIcon :manualInput="false" />
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted-color">
        {{ $t('attendance.hr.team.filters.status') }}
        <Select v-model="status" :options="statusOptions" optionLabel="label" optionValue="value" />
      </label>
      <Button
        v-if="canRecompute"
        :label="$t('attendance.hr.team.recomputeCompany')"
        icon="pi pi-refresh"
        :disabled="!range?.[0]"
        :loading="store.working"
        :title="$t('attendance.hr.team.recomputeRange')"
        @click="recomputeCompany"
      />
    </div>

    <div v-if="store.staleLeave.length" class="card mb-4">
      <h2 class="text-base font-medium text-color">{{ $t('attendance.hr.team.staleLeave') }}</h2>
      <p class="mb-2 text-sm text-muted-color">{{ $t('attendance.hr.team.staleLeaveNote') }}</p>
      <ul class="flex flex-wrap gap-2">
        <li
          v-for="row in store.staleLeave"
          :key="`${row.employeeId}-${row.date}`"
          class="rounded border border-surface px-2 py-1 text-sm text-muted-color"
        >
          {{ formatDate(row.date) }}
        </li>
      </ul>
    </div>

    <ErrorState v-if="store.error && !store.working" :message="store.error" @retry="store.loadTeamDays()" />

    <div v-else class="card">
      <AppDataTable
        :value="store.teamDays"
        :total="store.teamTotal"
        :loading="store.loading"
        :page="store.teamPage"
        :rows="store.teamLimit"
        dataKey="id"
        @page="(e: any) => store.loadTeamDays(e.page, e.limit)"
        @refresh="store.loadTeamDays()"
      >
        <Column :header="$t('attendance.hr.team.columns.employee')">
          <template #body="{ data }">{{ data.employee?.fullName }}</template>
        </Column>
        <Column :header="$t('attendance.days.columns.date')">
          <template #body="{ data }">{{ formatDate(data.shiftDate) }}</template>
        </Column>
        <Column :header="$t('attendance.days.columns.status')">
          <template #body="{ data }">
            <Tag :value="$t(`attendance.status.${data.status}`)" :severity="severityOf(data.status)" />
          </template>
        </Column>
        <Column field="workedMinutes" :header="$t('attendance.days.columns.worked')" />
        <Column field="lateMinutes" :header="$t('attendance.days.columns.lateMinutes')" />
        <Column field="lateOccurrences" :header="$t('attendance.days.columns.lateOccurrences')" />
        <Column field="otNormalMinutes" :header="$t('attendance.days.columns.otNormal')" />
        <Column field="holidayWorkMinutes" :header="$t('attendance.days.columns.holidayWork')" />
        <Column field="otHolidayMinutes" :header="$t('attendance.days.columns.otHoliday')" />
        <template #empty>
          <EmptyState icon="pi pi-users" :title="$t('attendance.hr.team.empty')" />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
