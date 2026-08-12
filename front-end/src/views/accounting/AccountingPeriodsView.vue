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
import { useRouter } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useFeedback } from '../../composables/useFeedback';
import { useAccountingPeriodsStore } from '../../stores/accountingPeriods';
import { useAuthStore } from '../../stores/auth';
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
const router = useRouter();
const auth = useAuthStore();
const store = useAccountingPeriodsStore();

const canClose = computed(() => auth.can('PERIOD_CLOSE'));
const canReopen = computed(() => auth.can('PERIOD_REOPEN'));
/**
 * Declaring reads its fiscal years from the period endpoint, on this same code — it no longer needs
 * FISCAL_YEAR_MANAGE, which is what used to make this dialog unusable for a period manager.
 */
const canDeclare = computed(() => auth.can('PERIOD_MANAGE'));
/**
 * A close refused for undelivered postings names them, and the undelivered screen is where they can
 * be re-queued. That screen is gated by GL_VIEW, which PERIOD_CLOSE does not imply — so the link
 * appears only for viewers who could follow it. Everyone still gets the refusal and its names.
 */
const canSeeUndelivered = computed(() => auth.can('GL_VIEW'));
const closeWasRefused = ref(false);

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
  if (canDeclare.value) store.loadFiscalYears();
});

const yearOptions = computed(() =>
  store.fiscalYears.map((fy) => ({ label: String(fy.year), value: fy.id })),
);
/**
 * A company whose years are all closed is a real state, and it still must not get an empty
 * dropdown — that was the whole point of the message this replaces. It just says something else now:
 * not "you lack a permission" but "there is no open year", which points at the org-admin screen.
 */
const hasOpenYear = computed(() => store.fiscalYears.length > 0);

const historyDialog = ref<{ open: boolean; period: AccountingPeriodRow | null }>({ open: false, period: null });

async function openHistory(period: AccountingPeriodRow) {
  historyDialog.value = { open: true, period };
  await store.loadLog(period.id);
}

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
    hasOpenYear.value &&
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

/** A fresh dialog carries no refusal from the previous one. */
function openClose(period: AccountingPeriodRow) {
  closeWasRefused.value = false;
  closeDialog.value = { open: true, period };
}

async function confirmClose() {
  const period = closeDialog.value.period;
  if (!period) return;
  const ok = await store.close(period.id);
  closeWasRefused.value = !ok;
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
                icon="pi pi-history"
                text
                size="small"
                :aria-label="$t('gl.periods.history')"
                data-testid="open-history"
                @click="openHistory(data)"
              />
              <Button
                v-if="canClose && data.status === 'OPEN'"
                :label="$t('gl.periods.close')"
                size="small"
                data-testid="close-period"
                @click="openClose(data)"
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
        Said out loud rather than shown as an empty dropdown. The sentence changed when the
        permission gap closed; the rule did not — never present a selector that cannot be filled.
      -->
      <Message v-if="!hasOpenYear" severity="warn" size="small" variant="simple" data-testid="no-open-year">
        {{ $t('gl.periods.noOpenFiscalYear') }}
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
        <!--
          The refusal itself goes to a toast, unaltered. This is the way forward it did not have:
          the postings it names live on the undelivered screen, where they can be re-queued.
        -->
        <Button
          v-if="closeWasRefused && canSeeUndelivered"
          :label="$t('gl.periods.seeUndelivered')"
          icon="pi pi-arrow-right"
          size="small"
          severity="secondary"
          text
          data-testid="see-undelivered"
          @click="router.push({ name: 'journal-undelivered' })"
        />
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

    <!-- What was done to this period, and why. Fetched on open, not with the list. -->
    <Dialog
      v-model:visible="historyDialog.open"
      modal
      :header="$t('gl.periods.history')"
      class="w-full max-w-2xl"
    >
      <DataTable :value="store.log" dataKey="id" class="text-sm" data-testid="history-table">
        <Column :header="$t('gl.periods.log.action')">
          <template #body="{ data }">
            <Tag
              :value="$t(`gl.periods.log.actions.${data.action}`)"
              :severity="data.action === 'REOPEN' ? 'warn' : 'success'"
            />
          </template>
        </Column>
        <Column :header="$t('gl.periods.log.actedAt')">
          <template #body="{ data }">{{ formatDate(data.actedAt) }}</template>
        </Column>
        <Column :header="$t('gl.periods.log.actedBy')">
          <template #body="{ data }">{{ data.actedBy.username }}</template>
        </Column>
        <Column :header="$t('gl.periods.log.reason')">
          <template #body="{ data }"><span class="text-muted-color">{{ data.reason ?? '—' }}</span></template>
        </Column>
        <template #empty>
          <!-- A declared period has nothing here: the log records closes and reopens only. -->
          <EmptyState icon="pi pi-history" :title="$t('gl.periods.log.empty')" />
        </template>
      </DataTable>
      <template #footer>
        <Button :label="$t('common.close')" text @click="historyDialog.open = false" />
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
