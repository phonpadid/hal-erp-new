<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useFeedback } from '../../composables/useFeedback';
import { useAccountingPeriodsStore } from '../../stores/accountingPeriods';
import { useAuthStore } from '../../stores/auth';
import { useOrgStore } from '../../stores/org';
import { formatDate } from '../../utils/date';
import type { AccountingPeriodRow } from '../../api/accountingPeriods';

/**
 * The month-end close.
 *
 * `AttendancePeriodsView` is the layout this borrows from, and its central affordance is the one
 * thing to leave behind: attendance shows coverage and then offers "close anyway", because an
 * empty attendance month is sometimes honest. The accounting close has no such branch — the server
 * REFUSES it while an earlier period is open or a posting is undelivered, and the refusal names the
 * obstacle. So there is no bypass control here, and the server's message is shown as returned
 * rather than translated: a translation would have to re-derive which period blocks and which
 * postings are owed.
 */
const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useAccountingPeriodsStore();
const org = useOrgStore();

const canClose = computed(() => auth.can('PERIOD_CLOSE'));
const canReopen = computed(() => auth.can('PERIOD_REOPEN'));
/**
 * Declaring needs a fiscal year, and the only endpoint that lists fiscal years is gated by
 * FISCAL_YEAR_MANAGE — a different code from PERIOD_MANAGE. Rather than open a dialog whose
 * selector can never be filled, the control needs both, and the dialog says so when one is missing.
 */
const canDeclare = computed(() => auth.can('PERIOD_MANAGE'));
const canListYears = computed(() => auth.can('FISCAL_YEAR_MANAGE'));

const declareDialog = ref(false);
const form = ref({
  fiscalYearId: '',
  code: '',
  periodStart: null as Date | null,
  periodEnd: null as Date | null,
});

const closeDialog = ref<{ open: boolean; period: AccountingPeriodRow | null }>({ open: false, period: null });
const reopenDialog = ref<{ open: boolean; period: AccountingPeriodRow | null; reason: string }>({
  open: false,
  period: null,
  reason: '',
});

onMounted(() => {
  store.load();
  if (canDeclare.value && canListYears.value) org.loadFiscalYears();
});

const yearOptions = computed(() =>
  org.fiscalYears.map((fy) => ({ label: String(fy.year), value: fy.id })),
);

/**
 * Whether the period being closed is the last of its fiscal year — decided from the loaded periods
 * sharing its `fiscalYear` id, because closing that one closes the YEAR as well and reopening it
 * afterwards will not undo that.
 */
const closingEndsTheYear = computed(() => {
  const period = closeDialog.value.period;
  if (!period) return false;
  const siblings = store.periods.filter((p) => p.fiscalYear === period.fiscalYear);
  return siblings.every((p) => p.periodEnd <= period.periodEnd);
});

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const declareReady = computed(
  () =>
    canListYears.value &&
    !!form.value.fiscalYearId &&
    !!form.value.code.trim() &&
    !!form.value.periodStart &&
    !!form.value.periodEnd,
);

function openDeclare() {
  form.value = { fiscalYearId: '', code: '', periodStart: null, periodEnd: null };
  declareDialog.value = true;
}

async function submitDeclare() {
  const { fiscalYearId, code, periodStart, periodEnd } = form.value;
  if (!declareReady.value || !periodStart || !periodEnd) return;
  const ok = await store.declare({
    fiscalYearId,
    code: code.trim(),
    periodStart: toIsoDate(periodStart),
    periodEnd: toIsoDate(periodEnd),
  });
  if (ok) {
    declareDialog.value = false;
    fb.success(t('gl.periods.declared'));
  } else {
    // An overlap refusal names the period it clashes with; showing it verbatim is the useful thing.
    fb.error(store.error);
  }
}

async function confirmClose() {
  const period = closeDialog.value.period;
  if (!period) return;
  const ok = await store.close(period.id);
  if (ok) {
    closeDialog.value.open = false;
    fb.success(t('gl.periods.closed'));
  } else {
    // Left open on purpose: the refusal is about this period, and closing the dialog would take
    // the reason off the screen along with it.
    fb.error(store.error);
  }
}

async function confirmReopen() {
  const { period, reason } = reopenDialog.value;
  if (!period || !reason.trim()) return;
  const ok = await store.reopen(period.id, reason.trim());
  if (ok) {
    reopenDialog.value = { open: false, period: null, reason: '' };
    fb.success(t('gl.periods.reopened'));
  } else fb.error(store.error);
}
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.periods.title')" :subtitle="$t('gl.periods.subtitle')">
      <template #actions>
        <Button
          v-if="canDeclare"
          :label="$t('gl.periods.declare')"
          icon="pi pi-plus"
          data-testid="declare-period"
          @click="openDeclare()"
        />
      </template>
    </PageHeader>

    <ErrorState v-if="store.error && !store.working && !store.periods.length" :message="store.error" @retry="store.load()" />

    <div v-else class="card">
      <DataTable :value="store.periods" :loading="store.loading" dataKey="id" class="text-sm">
        <Column field="code" :header="$t('gl.periods.columns.code')" />
        <Column :header="$t('gl.periods.columns.start')">
          <template #body="{ data }">{{ formatDate(data.periodStart) }}</template>
        </Column>
        <Column :header="$t('gl.periods.columns.end')">
          <template #body="{ data }">{{ formatDate(data.periodEnd) }}</template>
        </Column>
        <Column :header="$t('gl.periods.columns.status')">
          <template #body="{ data }">
            <Tag
              :value="$t(`gl.periods.status.${data.status}`)"
              :severity="data.status === 'CLOSED' ? 'success' : 'secondary'"
            />
          </template>
        </Column>
        <Column>
          <template #body="{ data }">
            <div class="flex flex-wrap justify-end gap-2">
              <Button
                v-if="canClose && data.status === 'OPEN'"
                :label="$t('gl.periods.close')"
                size="small"
                data-testid="close-period"
                @click="closeDialog = { open: true, period: data }"
              />
              <Button
                v-if="canReopen && data.status === 'CLOSED'"
                :label="$t('gl.periods.reopen')"
                size="small"
                severity="warn"
                text
                data-testid="reopen-period"
                @click="reopenDialog = { open: true, period: data, reason: '' }"
              />
            </div>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-calendar-times" :title="$t('gl.periods.empty')" />
        </template>
      </DataTable>
    </div>

    <!-- Declaring: an explicit range inside a fiscal year -->
    <Dialog v-model:visible="declareDialog" modal :header="$t('gl.periods.declare')" class="w-full max-w-md">
      <!--
        Said out loud rather than shown as an empty dropdown: listing fiscal years needs
        FISCAL_YEAR_MANAGE, which PERIOD_MANAGE does not imply.
      -->
      <Message v-if="!canListYears" severity="warn" size="small" variant="simple" data-testid="years-unavailable">
        {{ $t('gl.periods.fiscalYearsUnavailable') }}
      </Message>
      <div v-else class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.periods.fields.fiscalYear') }}
          <Select
            v-model="form.fiscalYearId"
            :options="yearOptions"
            optionLabel="label"
            optionValue="value"
            :placeholder="$t('gl.periods.fields.fiscalYear')"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.periods.fields.code') }}
          <InputText v-model="form.code" />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.periods.fields.start') }}
          <DatePicker v-model="form.periodStart" dateFormat="yy-mm-dd" showIcon />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.periods.fields.end') }}
          <DatePicker v-model="form.periodEnd" dateFormat="yy-mm-dd" showIcon />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="declareDialog = false" />
        <Button
          :label="$t('common.save')"
          :disabled="!declareReady"
          :loading="store.working"
          @click="submitDeclare"
        />
      </template>
    </Dialog>

    <!--
      Closing: confirm or cancel, and nothing else. There is deliberately no control that closes a
      period the server refused — the refusal is the answer, not a warning to click past.
    -->
    <Dialog
      v-model:visible="closeDialog.open"
      modal
      :header="$t('gl.periods.close')"
      class="w-full max-w-lg"
    >
      <div class="flex flex-col gap-2">
        <p class="text-sm text-muted-color">
          {{ $t('gl.periods.closeExplain', { code: closeDialog.period?.code }) }}
        </p>
        <Message
          v-if="closingEndsTheYear"
          severity="warn"
          size="small"
          icon="pi pi-exclamation-triangle"
          data-testid="year-close-warning"
        >
          {{ $t('gl.periods.closesTheYear') }}
        </Message>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="closeDialog.open = false" />
        <Button
          :label="$t('gl.periods.close')"
          :loading="store.working"
          data-testid="confirm-close"
          @click="confirmClose"
        />
      </template>
    </Dialog>

    <!-- Reopening: its own permission, and a reason the server records in the period log -->
    <Dialog
      v-model:visible="reopenDialog.open"
      modal
      :header="$t('gl.periods.reopen')"
      class="w-full max-w-md"
    >
      <label class="flex flex-col gap-1 text-sm text-muted-color">
        {{ $t('gl.periods.fields.reason') }}
        <Textarea v-model="reopenDialog.reason" rows="3" autoResize />
      </label>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="reopenDialog.open = false" />
        <Button
          :label="$t('gl.periods.reopen')"
          severity="warn"
          :disabled="!reopenDialog.reason.trim()"
          :loading="store.working"
          data-testid="confirm-reopen"
          @click="confirmReopen"
        />
      </template>
    </Dialog>
  </div>
</template>
