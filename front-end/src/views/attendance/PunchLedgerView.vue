<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppDataTable from '@/components/AppDataTable.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { documentsApi } from '../../api/documents';
import { employeesApi } from '../../api/employees';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { useAttendanceHrStore } from '../../stores/attendanceHr';
import { formatDateTime } from '../../utils/date';

/**
 * The punch ledger, and the two ways HR adds to it.
 *
 * Correcting somebody else's punch STARTS HERE, from the row itself, rather than from a form with a
 * "whose attendance is this about" picker. That is what puts `related_employee_id` on the document,
 * which is what makes filing on behalf visible to every approver — the correction service resolves
 * the subject from the document precisely so that no request body can name one quietly.
 */
const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useAttendanceHrStore();

const canPunchFor = computed(() => auth.can('ATTEND_PUNCH_MANAGE'));

const range = ref<Date[] | null>(null);
const employees = ref<Array<{ id: string; fullName: string }>>([]);
const correctionTypeId = ref('');

const punchDialog = ref({ open: false, employeeId: '', occurredAt: null as Date | null, direction: 'IN', remark: '' });
const bulkDialog = ref({ open: false, employeeIds: [] as string[], occurredAt: null as Date | null, direction: 'IN', remark: '' });
const correctDialog = ref({
  open: false,
  punch: null as (Record<string, any> | null),
  kind: 'CHANGE',
  requestedAt: null as Date | null,
  reason: '',
});

const directionOptions = computed(() => [
  { value: 'IN', label: t('attendance.correction.directions.IN') },
  { value: 'OUT', label: t('attendance.correction.directions.OUT') },
]);
const employeeOptions = computed(() => employees.value.map((e) => ({ value: e.id, label: e.fullName })));

onMounted(async () => {
  store.loadPunches();
  const [list, types] = await Promise.all([
    employeesApi.list(1, 200).catch(() => ({ items: [] as Array<{ id: string; fullName: string }> })),
    documentsApi.creatableTypes().catch(() => []),
  ]);
  employees.value = list.items ?? [];
  correctionTypeId.value = types.find((type) => type.code === 'TCORR')?.id ?? '';
});

watch(range, (value) => {
  const [from, to] = value ?? [];
  store.setPunchFilters({
    dateFrom: from ? toIsoDate(from) : undefined,
    dateTo: to ? toIsoDate(to) : undefined,
  });
});

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function submitPunch() {
  const { employeeId, occurredAt, direction, remark } = punchDialog.value;
  if (!employeeId || !occurredAt) return;
  const ok = await store.punchFor({
    employeeId,
    occurredAt: occurredAt.toISOString(),
    direction: direction as 'IN' | 'OUT',
    remark: remark || undefined,
  });
  if (ok) {
    punchDialog.value.open = false;
    fb.success(t('attendance.hr.ledger.recorded'));
  } else fb.error(store.error);
}

async function submitBulk() {
  const { employeeIds, occurredAt, direction, remark } = bulkDialog.value;
  if (!employeeIds.length || !occurredAt) return;

  // Confirmed because the ledger is append-only: a bulk mistake is corrected by a further
  // correction, never undone, so the moment to catch it is before it is sent.
  const confirmed = await fb.confirm({
    message: t('attendance.hr.ledger.bulkConfirm', {
      count: employeeIds.length,
      at: formatDateTime(occurredAt),
      direction: t(`attendance.correction.directions.${direction}`),
    }),
  });
  if (!confirmed) return;

  const ok = await store.bulkPunch({
    employeeIds,
    occurredAt: occurredAt.toISOString(),
    direction: direction as 'IN' | 'OUT',
    remark: remark || undefined,
  });
  if (ok) {
    bulkDialog.value.open = false;
    fb.success(t('attendance.hr.ledger.recorded'));
  } else fb.error(store.error);
}

async function submitCorrection() {
  const punch = correctDialog.value.punch;
  if (!punch || !correctDialog.value.reason.trim()) return;
  const kind = correctDialog.value.kind as 'CHANGE' | 'REMOVE';

  const ok = await store.requestCorrectionFor(correctionTypeId.value, punch.employee.id, {
    shiftDate: punch.localDate,
    kind,
    targetEventId: punch.id,
    ...(kind === 'CHANGE'
      ? {
          requestedAt: correctDialog.value.requestedAt?.toISOString(),
          requestedDirection: punch.direction,
        }
      : {}),
    reason: correctDialog.value.reason.trim(),
  } as never);

  if (ok) {
    correctDialog.value.open = false;
    fb.success(
      t('attendance.hr.ledger.correctionSubmitted', { employee: punch.employee.fullName }),
    );
  } else fb.error(store.error);
}
</script>

<template>
  <div>
    <PageHeader :title="$t('attendance.hr.ledger.title')" :subtitle="$t('attendance.hr.ledger.subtitle')">
      <template #actions>
        <div v-if="canPunchFor" class="flex gap-2">
          <Button
            :label="$t('attendance.hr.ledger.punchFor')"
            icon="pi pi-plus"
            @click="punchDialog = { open: true, employeeId: '', occurredAt: null, direction: 'IN', remark: '' }"
          />
          <Button
            :label="$t('attendance.hr.ledger.bulkPunch')"
            icon="pi pi-users"
            severity="secondary"
            @click="bulkDialog = { open: true, employeeIds: [], occurredAt: null, direction: 'IN', remark: '' }"
          />
        </div>
      </template>
    </PageHeader>

    <div class="mb-3 flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-1 text-sm text-muted-color">
        {{ $t('attendance.hr.ledger.filters.from') }} / {{ $t('attendance.hr.ledger.filters.to') }}
        <DatePicker v-model="range" selectionMode="range" dateFormat="yy-mm-dd" showIcon :manualInput="false" />
      </label>
    </div>

    <ErrorState v-if="store.error && !store.working" :message="store.error" @retry="store.loadPunches()" />

    <div v-else class="card">
      <AppDataTable
        :value="store.punches"
        :total="store.punchTotal"
        :loading="store.loading"
        :page="store.punchPage"
        :rows="store.punchLimit"
        dataKey="id"
        @page="(e: any) => store.loadPunches(e.page, e.limit)"
        @refresh="store.loadPunches()"
      >
        <Column :header="$t('attendance.hr.ledger.columns.employee')">
          <template #body="{ data }">{{ data.employee?.fullName }}</template>
        </Column>
        <Column :header="$t('attendance.hr.ledger.columns.at')">
          <template #body="{ data }">{{ formatDateTime(data.occurredAt) }}</template>
        </Column>
        <Column :header="$t('attendance.hr.ledger.columns.direction')">
          <template #body="{ data }">
            {{ $t(`attendance.correction.directions.${data.direction}`) }}
          </template>
        </Column>
        <!-- Source is on the row so a hand-entered punch is distinguishable from a scanned one. -->
        <Column :header="$t('attendance.hr.ledger.columns.source')">
          <template #body="{ data }">
            <Tag :value="data.source" :severity="data.source === 'MANUAL' ? 'warn' : 'secondary'" />
          </template>
        </Column>
        <Column :header="$t('attendance.hr.ledger.columns.geofence')">
          <template #body="{ data }">{{ $t(`attendance.punch.geofence.${data.geofenceStatus}`) }}</template>
        </Column>
        <Column>
          <template #body="{ data }">
            <Button
              v-if="canPunchFor"
              :label="$t('attendance.hr.ledger.correct')"
              text
              size="small"
              @click="correctDialog = { open: true, punch: data, kind: 'CHANGE', requestedAt: new Date(data.occurredAt), reason: '' }"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-list" :title="$t('attendance.hr.ledger.empty')" />
        </template>
      </AppDataTable>
    </div>

    <Dialog v-model:visible="punchDialog.open" modal :header="$t('attendance.hr.ledger.punchFor')" class="w-full max-w-md">
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.ledger.fields.employee') }}
          <Select v-model="punchDialog.employeeId" :options="employeeOptions" optionLabel="label" optionValue="value" filter />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.ledger.fields.occurredAt') }}
          <DatePicker v-model="punchDialog.occurredAt" showTime hourFormat="24" dateFormat="yy-mm-dd" showIcon />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.ledger.fields.direction') }}
          <Select v-model="punchDialog.direction" :options="directionOptions" optionLabel="label" optionValue="value" />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.ledger.fields.remark') }}
          <InputText v-model="punchDialog.remark" />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="punchDialog.open = false" />
        <Button :label="$t('common.save')" :loading="store.working" @click="submitPunch" />
      </template>
    </Dialog>

    <Dialog v-model:visible="bulkDialog.open" modal :header="$t('attendance.hr.ledger.bulkPunch')" class="w-full max-w-md">
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.ledger.fields.employees') }}
          <MultiSelect v-model="bulkDialog.employeeIds" :options="employeeOptions" optionLabel="label" optionValue="value" filter display="chip" />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.ledger.fields.occurredAt') }}
          <DatePicker v-model="bulkDialog.occurredAt" showTime hourFormat="24" dateFormat="yy-mm-dd" showIcon />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.hr.ledger.fields.direction') }}
          <Select v-model="bulkDialog.direction" :options="directionOptions" optionLabel="label" optionValue="value" />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="bulkDialog.open = false" />
        <Button :label="$t('common.save')" :loading="store.working" @click="submitBulk" />
      </template>
    </Dialog>

    <Dialog v-model:visible="correctDialog.open" modal :header="$t('attendance.hr.ledger.correct')" class="w-full max-w-md">
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.correction.fields.kind') }}
          <Select
            v-model="correctDialog.kind"
            :options="[
              { value: 'CHANGE', label: $t('attendance.correction.kinds.CHANGE') },
              { value: 'REMOVE', label: $t('attendance.correction.kinds.REMOVE') },
            ]"
            optionLabel="label"
            optionValue="value"
          />
        </label>
        <label v-if="correctDialog.kind === 'CHANGE'" class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.correction.fields.requestedAt') }}
          <DatePicker v-model="correctDialog.requestedAt" showTime hourFormat="24" dateFormat="yy-mm-dd" showIcon />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('attendance.correction.fields.reason') }}
          <Textarea v-model="correctDialog.reason" rows="3" autoResize />
        </label>
        <p class="text-xs text-muted-color">{{ $t('attendance.correction.approvalNote') }}</p>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="correctDialog.open = false" />
        <Button
          :label="$t('attendance.correction.submit')"
          :disabled="!correctDialog.reason.trim()"
          :loading="store.working"
          @click="submitCorrection"
        />
      </template>
    </Dialog>
  </div>
</template>
