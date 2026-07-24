<script setup lang="ts">
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import AppDataTable from '@/components/AppDataTable.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useAttendanceHrStore } from '../../stores/attendanceHr';
import { formatDate, formatDateTime } from '../../utils/date';

/**
 * What a closed period reports.
 *
 * Read-only throughout, and deliberately so: a line is produced by closing and replaced by
 * re-closing. There is no edit here because there is no edit anywhere — the way to change these
 * figures is to reopen, fix the ledger, and close again, which the log then records.
 */
const route = useRoute();
const store = useAttendanceHrStore();
const periodId = computed(() => String(route.params.id ?? ''));

const period = computed(() => store.periods.find((p) => p.id === periodId.value));

onMounted(async () => {
  if (!store.periods.length) await store.loadPeriods();
  await Promise.all([store.loadPeriodDetail(periodId.value), store.loadClosedEvents()]);
});

/** Leave days for a line, as `type xN` pairs — types are configuration, so they cannot be columns. */
function leaveFor(lineId: string): string {
  const rows = store.lineLeave[lineId] ?? [];
  return rows.map((r) => `${r.quota?.quotaType ?? ''} ${r.days}`).join(' · ');
}
</script>

<template>
  <div>
    <PageHeader
      :title="$t('attendance.hr.periodDetail.title', { code: period?.code ?? '' })"
      :subtitle="
        $t('attendance.hr.periodDetail.subtitle', {
          start: period ? formatDate(period.periodStart) : '',
          end: period ? formatDate(period.periodEnd) : '',
        })
      "
    />

    <ErrorState
      v-if="store.error"
      :message="store.error"
      @retry="store.loadPeriodDetail(periodId)"
    />

    <template v-else>
      <div class="card mb-4">
        <h2 class="mb-2 text-lg font-medium text-color">{{ $t('attendance.hr.periodDetail.lines') }}</h2>
        <!-- The note, not a button: these figures come from closing. -->
        <p class="mb-3 text-sm text-muted-color">{{ $t('attendance.hr.periodDetail.derivedNote') }}</p>

        <AppDataTable
          :value="store.lines"
          :total="store.lines.length"
          :loading="store.loading"
          :page="1"
          :rows="store.lines.length || 10"
          dataKey="id"
        >
          <Column :header="$t('attendance.hr.periodDetail.columns.employee')">
            <template #body="{ data }">{{ data.employee?.fullName }}</template>
          </Column>
          <Column field="employmentType" :header="$t('attendance.hr.periodDetail.columns.employmentType')" />
          <Column :header="$t('attendance.hr.periodDetail.columns.affectsPay')">
            <template #body="{ data }">
              <Tag
                :value="$t(data.attendanceAffectsPay ? 'common.yes' : 'common.no')"
                :severity="data.attendanceAffectsPay ? 'info' : 'secondary'"
              />
            </template>
          </Column>
          <Column field="expectedMinutes" :header="$t('attendance.hr.periodDetail.columns.expected')" />
          <Column field="workedMinutes" :header="$t('attendance.hr.periodDetail.columns.worked')" />
          <Column field="daysPresent" :header="$t('attendance.hr.periodDetail.columns.present')" />
          <Column field="daysAbsent" :header="$t('attendance.hr.periodDetail.columns.absent')" />
          <Column field="daysLeave" :header="$t('attendance.hr.periodDetail.columns.leave')" />
          <Column field="daysNotWorked" :header="$t('attendance.hr.periodDetail.columns.notWorked')" />

          <!-- Two columns. Discipline counts times, pay counts minutes; one figure loses the other. -->
          <Column field="lateMinutes" :header="$t('attendance.hr.periodDetail.columns.lateMinutes')" />
          <Column field="lateOccurrences" :header="$t('attendance.hr.periodDetail.columns.lateOccurrences')" />
          <Column field="earlyLeaveMinutes" :header="$t('attendance.hr.periodDetail.columns.earlyLeave')" />

          <!-- Three kinds, paid at three rates; a total could never be taken apart again. -->
          <Column field="otNormalMinutes" :header="$t('attendance.hr.periodDetail.columns.otNormal')" />
          <Column field="holidayWorkMinutes" :header="$t('attendance.hr.periodDetail.columns.holidayWork')" />
          <Column field="otHolidayMinutes" :header="$t('attendance.hr.periodDetail.columns.otHoliday')" />
          <Column field="uncertifiedOtMinutes" :header="$t('attendance.hr.periodDetail.columns.uncertifiedOt')" />

          <Column :header="$t('attendance.hr.periodDetail.columns.leaveByType')">
            <template #body="{ data }">{{ leaveFor(data.id) }}</template>
          </Column>

          <template #empty>
            <EmptyState icon="pi pi-inbox" :title="$t('attendance.hr.periodDetail.empty')" />
          </template>
        </AppDataTable>
      </div>

      <div class="card mb-4">
        <h2 class="mb-3 text-lg font-medium text-color">{{ $t('attendance.hr.periodDetail.log') }}</h2>
        <AppDataTable
          :value="store.log"
          :total="store.log.length"
          :loading="store.loading"
          :page="1"
          :rows="store.log.length || 10"
          dataKey="id"
        >
          <Column :header="$t('attendance.hr.periodDetail.logColumns.action')">
            <template #body="{ data }">
              <Tag
                :value="$t(`attendance.hr.periodDetail.actions.${data.action}`)"
                :severity="data.action === 'REOPEN' ? 'warn' : 'success'"
              />
            </template>
          </Column>
          <Column :header="$t('attendance.hr.periodDetail.logColumns.by')">
            <template #body="{ data }">{{ data.actedBy?.username }}</template>
          </Column>
          <Column :header="$t('attendance.hr.periodDetail.logColumns.at')">
            <template #body="{ data }">{{ formatDateTime(data.actedAt) }}</template>
          </Column>
          <Column field="reason" :header="$t('attendance.hr.periodDetail.logColumns.reason')" />
          <template #empty>
            <EmptyState icon="pi pi-history" :title="$t('attendance.hr.periodDetail.empty')" />
          </template>
        </AppDataTable>
      </div>

      <div class="card">
        <h2 class="mb-2 text-lg font-medium text-color">
          {{ $t('attendance.hr.periodDetail.closedEvents') }}
        </h2>
        <p class="mb-3 text-sm text-muted-color">
          {{ $t('attendance.hr.periodDetail.closedEventsNote') }}
        </p>
        <AppDataTable
          :value="store.closedEvents"
          :total="store.closedEventTotal"
          :loading="store.loading"
          :page="store.closedEventPage"
          :rows="store.closedEventLimit"
          dataKey="id"
          @page="(e: any) => store.loadClosedEvents(e.page, e.limit)"
        >
          <Column :header="$t('attendance.hr.ledger.columns.employee')">
            <template #body="{ data }">{{ data.employee?.fullName }}</template>
          </Column>
          <Column :header="$t('attendance.hr.ledger.columns.at')">
            <template #body="{ data }">{{ formatDateTime(data.occurredAt) }}</template>
          </Column>
          <Column field="direction" :header="$t('attendance.hr.ledger.columns.direction')" />
          <Column field="source" :header="$t('attendance.hr.ledger.columns.source')" />
          <template #empty>
            <EmptyState
              icon="pi pi-check-circle"
              :title="$t('attendance.hr.periodDetail.closedEventsEmpty')"
            />
          </template>
        </AppDataTable>
      </div>
    </template>
  </div>
</template>
