<script setup lang="ts">
import Column from 'primevue/column';
import DatePicker from 'primevue/datepicker';
import Tag from 'primevue/tag';
import { onMounted, ref, watch } from 'vue';
import AppDataTable from '@/components/AppDataTable.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useAttendanceStore } from '../../stores/attendance';
import { formatDate } from '../../utils/date';

/**
 * The caller's own computed days. Read-only throughout: `attendance_day` is a projection, and the
 * only way to move it is to move the punches it derives from — which is what the correction form
 * is for. There is deliberately no control on this screen that writes to a day.
 */
const store = useAttendanceStore();

const range = ref<Date[] | null>(null);

onMounted(() => store.loadMyDays());

watch(range, (value) => {
  const [from, to] = value ?? [];
  store.setFilters({
    dateFrom: from ? toIsoDate(from) : undefined,
    dateTo: to ? toIsoDate(to) : undefined,
  });
});

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** PRESENT reads well in green; anything the employee would want to explain reads in amber or red. */
function severityOf(status: string): string {
  if (status === 'PRESENT') return 'success';
  if (status === 'ABSENT') return 'danger';
  if (status === 'INCOMPLETE') return 'warn';
  if (status === 'LEAVE') return 'info';
  return 'secondary';
}
</script>

<template>
  <div>
    <PageHeader :title="$t('attendance.days.title')" :subtitle="$t('attendance.days.subtitle')" />

    <div class="mb-3 flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-1 text-sm text-muted-color">
        {{ $t('attendance.days.filters.from') }} / {{ $t('attendance.days.filters.to') }}
        <DatePicker v-model="range" selectionMode="range" dateFormat="yy-mm-dd" showIcon :manualInput="false" />
      </label>
    </div>

    <ErrorState v-if="store.error" :message="store.error" @retry="store.loadMyDays()" />

    <div v-else class="card">
      <!-- The note, not a button: this screen reports and never edits. -->
      <p class="mb-3 text-sm text-muted-color">{{ $t('attendance.days.derivedNote') }}</p>

      <AppDataTable
        :value="store.myDays"
        :total="store.total"
        :loading="store.loading"
        :page="store.page"
        :rows="store.limit"
        dataKey="id"
        @page="(e: any) => store.loadMyDays(e.page, e.limit)"
        @refresh="store.loadMyDays()"
      >
        <Column field="shiftDate" :header="$t('attendance.days.columns.date')">
          <template #body="{ data }">{{ formatDate(data.shiftDate) }}</template>
        </Column>
        <Column :header="$t('attendance.days.columns.status')">
          <template #body="{ data }">
            <Tag :value="$t(`attendance.status.${data.status}`)" :severity="severityOf(data.status)" />
          </template>
        </Column>
        <Column field="shiftCode" :header="$t('attendance.days.columns.shift')" />
        <Column :header="$t('attendance.days.columns.expected')">
          <template #body="{ data }">{{ $t('attendance.minutes', { count: data.expectedMinutes ?? 0 }) }}</template>
        </Column>
        <Column :header="$t('attendance.days.columns.worked')">
          <template #body="{ data }">{{ $t('attendance.minutes', { count: data.workedMinutes }) }}</template>
        </Column>

        <!--
          Two columns, not one. Thai discipline counts TIMES — three in a month is a warning letter
          — and pay deduction counts MINUTES. The projection has kept them apart since the daily
          slice precisely so a screen cannot quietly collapse them.
        -->
        <Column field="lateMinutes" :header="$t('attendance.days.columns.lateMinutes')" />
        <Column field="lateOccurrences" :header="$t('attendance.days.columns.lateOccurrences')" />
        <Column field="earlyLeaveMinutes" :header="$t('attendance.days.columns.earlyLeave')" />

        <!-- And three overtime columns, because the three are paid at different rates and a total
             cannot be taken apart again. -->
        <Column field="otNormalMinutes" :header="$t('attendance.days.columns.otNormal')" />
        <Column field="holidayWorkMinutes" :header="$t('attendance.days.columns.holidayWork')" />
        <Column field="otHolidayMinutes" :header="$t('attendance.days.columns.otHoliday')" />

        <template #empty>
          <EmptyState icon="pi pi-calendar" :title="$t('attendance.days.empty')" />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
