<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppDataTable from '@/components/AppDataTable.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { useAttendanceHrStore } from '../../stores/attendanceHr';
import { formatDate } from '../../utils/date';
import type { AttendancePeriodRow } from '../../api/attendanceHr';

/**
 * The month-end workflow.
 *
 * The one thing this screen must not do is let somebody close a range nobody computed without
 * saying so. `close()` summarises whatever `attendance_day` holds, so an uncomputed month produces
 * a full set of lines reading zero — indistinguishable from a month in which nobody worked, and
 * payroll pays on it.
 *
 * It is NOT blocked, though. A company whose staff are all exempt from attendance has a
 * legitimately empty period, and refusing to close it would leave an honest period permanently
 * open. Show, then let them decide.
 */
const { t } = useI18n();
const fb = useFeedback();
const router = useRouter();
const auth = useAuthStore();
const store = useAttendanceHrStore();

const canManage = computed(() => auth.can('ATTEND_PERIOD_MANAGE'));
const canClose = computed(() => auth.can('ATTEND_PERIOD_CLOSE'));
const canReopen = computed(() => auth.can('ATTEND_PERIOD_REOPEN'));

const declareDialog = ref<{ open: boolean; edit: AttendancePeriodRow | null }>({ open: false, edit: null });
const form = ref({ code: '', periodStart: null as Date | null, periodEnd: null as Date | null });

const closeDialog = ref<{ open: boolean; period: AttendancePeriodRow | null }>({ open: false, period: null });
const reopenDialog = ref<{ open: boolean; period: AttendancePeriodRow | null; reason: string }>({
  open: false,
  period: null,
  reason: '',
});

onMounted(() => store.loadPeriods());

const closingCoverage = computed(() =>
  closeDialog.value.period ? store.coverage[closeDialog.value.period.id] : undefined,
);
/** Both zero means the range is computed and current; either non-zero is worth saying out loud. */
const coverageIsClean = computed(
  () =>
    !!closingCoverage.value &&
    closingCoverage.value.missingEmployeeDays === 0 &&
    closingCoverage.value.staleEmployeeDays === 0,
);

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function openDeclare(edit: AttendancePeriodRow | null = null) {
  declareDialog.value = { open: true, edit };
  form.value = edit
    ? {
        code: edit.code,
        periodStart: new Date(`${edit.periodStart}T00:00:00`),
        periodEnd: new Date(`${edit.periodEnd}T00:00:00`),
      }
    : { code: '', periodStart: null, periodEnd: null };
}

async function submitDeclare() {
  const { code, periodStart, periodEnd } = form.value;
  if (!code || !periodStart || !periodEnd) return;
  const dto = { code, periodStart: toIsoDate(periodStart), periodEnd: toIsoDate(periodEnd) };
  const edit = declareDialog.value.edit;
  const ok = edit ? await store.updatePeriod(edit.id, dto) : await store.declarePeriod(dto);
  if (ok) {
    declareDialog.value.open = false;
    fb.success(t(edit ? 'attendance.hr.periods.updated' : 'attendance.hr.periods.declared'));
  } else {
    // An overlap refusal names the period it clashes with; showing it verbatim is the useful thing.
    fb.error(store.error);
  }
}

async function openClose(period: AttendancePeriodRow) {
  closeDialog.value = { open: true, period };
  await store.loadCoverage(period.id);
}

async function recomputeThenStay() {
  const period = closeDialog.value.period;
  if (!period) return;
  const written = await store.recomputeCompany(period.periodStart, period.periodEnd);
  if (written === null) return fb.error(store.error);
  fb.success(t('attendance.hr.team.recomputed', { count: written }));
  await store.loadCoverage(period.id);
}

async function confirmClose() {
  const period = closeDialog.value.period;
  if (!period) return;
  const ok = await store.closePeriod(period.id);
  closeDialog.value.open = false;
  if (ok) fb.success(t('attendance.hr.periods.closed'));
  else fb.error(store.error);
}

async function confirmReopen() {
  const { period, reason } = reopenDialog.value;
  if (!period || !reason.trim()) return;
  const ok = await store.reopenPeriod(period.id, reason.trim());
  if (ok) {
    reopenDialog.value = { open: false, period: null, reason: '' };
    fb.success(t('attendance.hr.periods.reopened'));
  } else fb.error(store.error);
}
</script>

<template>
  <div>
    <PageHeader
      :title="$t('attendance.hr.periods.title')"
      :subtitle="$t('attendance.hr.periods.subtitle')"
    >
      <template #actions>
        <Button
          v-if="canManage"
          :label="$t('attendance.hr.periods.declare')"
          icon="pi pi-plus"
          @click="openDeclare()"
        />
      </template>
    </PageHeader>

    <ErrorState v-if="store.error && !store.working" :message="store.error" @retry="store.loadPeriods()" />

    <div v-else class="card">
      <AppDataTable
        :value="store.periods"
        :total="store.periodTotal"
        :loading="store.loading"
        :page="store.periodPage"
        :rows="store.periodLimit"
        dataKey="id"
        @page="(e: any) => store.loadPeriods(e.page, e.limit)"
        @refresh="store.loadPeriods()"
      >
        <Column field="code" :header="$t('attendance.hr.periods.columns.code')" />
        <Column :header="$t('attendance.hr.periods.columns.start')">
          <template #body="{ data }">{{ formatDate(data.periodStart) }}</template>
        </Column>
        <Column :header="$t('attendance.hr.periods.columns.end')">
          <template #body="{ data }">{{ formatDate(data.periodEnd) }}</template>
        </Column>
        <Column :header="$t('attendance.hr.periods.columns.status')">
          <template #body="{ data }">
            <Tag
              :value="$t(`attendance.hr.periods.status.${data.status}`)"
              :severity="data.status === 'CLOSED' ? 'success' : 'secondary'"
            />
          </template>
        </Column>
        <Column>
          <template #body="{ data }">
            <div class="flex flex-wrap justify-end gap-2">
              <Button
                icon="pi pi-eye"
                text
                :aria-label="$t('attendance.hr.periodDetail.lines')"
                @click="router.push({ name: 'attendance-period-detail', params: { id: data.id } })"
              />
              <Button
                v-if="canManage && data.status === 'DRAFT'"
                :label="$t('attendance.hr.periods.edit')"
                text
                size="small"
                @click="openDeclare(data)"
              />
              <Button
                v-if="canClose && data.status === 'DRAFT'"
                :label="$t('attendance.hr.periods.close')"
                size="small"
                @click="openClose(data)"
              />
              <Button
                v-if="canReopen && data.status === 'CLOSED'"
                :label="$t('attendance.hr.periods.reopen')"
                size="small"
                severity="warn"
                text
                @click="reopenDialog = { open: true, period: data, reason: '' }"
              />
            </div>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-calendar-times" :title="$t('attendance.hr.periods.empty')" />
        </template>
      </AppDataTable>
    </div>

    <!-- Declare / edit a draft -->
    <Dialog
      v-model:visible="declareDialog.open"
      modal
      :header="$t('attendance.hr.periods.declare')"
      class="w-full max-w-md"
    >
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.periods.fields.code') }}
          <InputText v-model="form.code" />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.periods.fields.start') }}
          <DatePicker v-model="form.periodStart" dateFormat="yy-mm-dd" showIcon />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.periods.fields.end') }}
          <DatePicker v-model="form.periodEnd" dateFormat="yy-mm-dd" showIcon />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="declareDialog.open = false" />
        <Button :label="$t('common.save')" :loading="store.working" @click="submitDeclare" />
      </template>
    </Dialog>

    <!-- Closing: what it is about to summarise -->
    <Dialog
      v-model:visible="closeDialog.open"
      modal
      :header="$t('attendance.hr.periods.coverage.title')"
      class="w-full max-w-lg"
    >
      <div class="flex flex-col gap-2">
        <p class="text-sm text-muted-color">{{ $t('attendance.hr.periods.coverage.explain') }}</p>

        <template v-if="closingCoverage">
          <p v-if="coverageIsClean" class="text-color">
            <i class="pi pi-check-circle mr-1" />{{ $t('attendance.hr.periods.coverage.clean') }}
          </p>
          <!--
            Two figures, stated apart. "Never computed" is work not yet done; "computed before its
            last punch" is work overtaken by a later observation. They call for different actions,
            and one combined total would hide which this month has.
          -->
          <template v-else>
            <p v-if="closingCoverage.missingEmployeeDays" class="text-color">
              <i class="pi pi-exclamation-triangle mr-1" />
              {{ $t('attendance.hr.periods.coverage.missing', { count: closingCoverage.missingEmployeeDays }) }}
            </p>
            <p v-if="closingCoverage.staleEmployeeDays" class="text-color">
              <i class="pi pi-history mr-1" />
              {{ $t('attendance.hr.periods.coverage.stale', { count: closingCoverage.staleEmployeeDays }) }}
            </p>
          </template>
        </template>
        <p v-else class="text-sm text-muted-color">{{ $t('attendance.hr.periods.coverage.unknown') }}</p>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="closeDialog.open = false" />
        <Button
          v-if="closingCoverage && !coverageIsClean"
          :label="$t('attendance.hr.periods.coverage.recomputeFirst')"
          severity="secondary"
          :loading="store.working"
          @click="recomputeThenStay"
        />
        <!-- Always available: an empty period is sometimes the honest answer. -->
        <Button
          :label="$t('attendance.hr.periods.coverage.closeAnyway')"
          :loading="store.working"
          @click="confirmClose"
        />
      </template>
    </Dialog>

    <!-- Reopening: its own code, and a reason -->
    <Dialog
      v-model:visible="reopenDialog.open"
      modal
      :header="$t('attendance.hr.periods.reopen')"
      class="w-full max-w-md"
    >
      <label class="flex flex-col gap-1 text-sm text-muted-color">
        {{ $t('attendance.hr.periods.fields.reason') }}
        <Textarea v-model="reopenDialog.reason" rows="3" autoResize />
      </label>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="reopenDialog.open = false" />
        <Button
          :label="$t('attendance.hr.periods.reopen')"
          severity="warn"
          :disabled="!reopenDialog.reason.trim()"
          :loading="store.working"
          @click="confirmReopen"
        />
      </template>
    </Dialog>
  </div>
</template>
