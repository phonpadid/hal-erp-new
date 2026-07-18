<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/useFeedback';
import FileUpload from 'primevue/fileupload';
import type { FileUploadUploaderEvent } from 'primevue/fileupload';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import {
  paymentBatchesApi,
  type ImportLine,
  type PaymentBatchDetail,
  type PaymentBatchLine,
} from '../../api/payments';

/**
 * One payment run: review it, send the file to the bank, bring the bank's answer back.
 *
 * Money is never a JS number here — amounts stay the decimal strings the server sent, and the rate
 * finance keys is passed through as typed.
 */
const route = useRoute();
const { t } = useI18n();
const auth = useAuthStore();
const fb = useFeedback();
const { fmt } = useCurrencyFormat();

const detail = ref<PaymentBatchDetail | null>(null);
const loading = ref(true);
const failed = ref(false);
const busy = ref(false);

/** Per-line rate + outcome the user is about to import, keyed by document id. */
const entry = ref<Record<string, { result: 'SUCCESS' | 'FAILED'; actualRate: string; failReason: string }>>({});
const confirmingCancel = ref(false);

const canManage = computed(() => auth.can('PAYMENT_BATCH_MANAGE'));
const batch = computed(() => detail.value?.batch ?? null);
const lines = computed(() => detail.value?.lines ?? []);
const isExported = computed(() => batch.value?.status === 'EXPORTED');
const isDraft = computed(() => batch.value?.status === 'DRAFT');
/** A COMPLETED run's money is gone; "cancelling" it would be a lie. */
const canCancel = computed(() => canManage.value && (isDraft.value || isExported.value));

const resultOptions = computed(() => [
  { label: t('payments.batches.result.SUCCESS'), value: 'SUCCESS' },
  { label: t('payments.batches.result.FAILED'), value: 'FAILED' },
]);

function netOf(line: PaymentBatchLine): string {
  // The server already computed wht_amount at export; the vendor is paid the remainder.
  const wht = line.whtAmount ?? '0';
  return String(Number(line.amount) - Number(wht));
}

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    detail.value = await paymentBatchesApi.get(String(route.params.id));
    // Prefill each rate with the document's locked rate: a base-currency run then needs no typing
    // at all, and a typo is the one thing that puts a wrong FX delta into accounting.
    entry.value = Object.fromEntries(
      (detail.value?.lines ?? []).map((l) => [
        l.document.id,
        { result: 'SUCCESS' as const, actualRate: l.actualRate ?? '1', failReason: '' },
      ]),
    );
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

async function doExport() {
  busy.value = true;
  try {
    const { blob } = await paymentBatchesApi.export(String(route.params.id));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${batch.value?.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    await load();
    fb.success(t('payments.batches.exported'));
  } catch (e: unknown) {
    // A deactivated payee comes back named — the fix is to return and resubmit that document, so
    // showing "something went wrong" would strand the user.
    fb.error(serverMessage(e) ?? t('feedback.error'));
  } finally {
    busy.value = false;
  }
}

async function doImport() {
  busy.value = true;
  try {
    const payload: ImportLine[] = lines.value.map((l) => {
      const e = entry.value[l.document.id];
      return e.result === 'SUCCESS'
        ? { documentId: l.document.id, result: 'SUCCESS', actualRate: e.actualRate }
        : { documentId: l.document.id, result: 'FAILED', failReason: e.failReason || undefined };
    });
    detail.value = await paymentBatchesApi.importResult(String(route.params.id), payload);
    fb.success(t('payments.batches.imported'));
  } catch (e: unknown) {
    fb.error(serverMessage(e) ?? t('feedback.error'));
  } finally {
    busy.value = false;
  }
}

/**
 * Apply the bank's result file. The file decides WHICH lines were paid — that is the point of
 * uploading it instead of retyping — while the rates below are still ours: the file reports what
 * the bank moved, not the rate we book it at. Lines the user left as FAILED contribute no rate.
 *
 * A file the parser cannot read aborts the whole import server-side, so the batch is untouched
 * and the per-line grid remains as the fallback.
 */
async function doImportFile(event: FileUploadUploaderEvent) {
  const file = (Array.isArray(event.files) ? event.files[0] : event.files) as File | undefined;
  if (!file) return;
  busy.value = true;
  try {
    const rates: Record<string, string> = {};
    for (const l of lines.value) {
      const rate = entry.value[l.document.id]?.actualRate;
      if (rate) rates[l.document.id] = rate;
    }
    detail.value = await paymentBatchesApi.importResultFile(String(route.params.id), file, rates);
    fb.success(t('payments.batches.imported'));
  } catch (e: unknown) {
    // Surface what the parser choked on — "row 3 names no document we sent" is actionable,
    // "import failed" is not.
    fb.error(serverMessage(e) ?? t('payments.batches.importFileFailed'));
  } finally {
    busy.value = false;
  }
}

async function doCancel() {
  busy.value = true;
  try {
    await paymentBatchesApi.cancel(String(route.params.id));
    await load();
    fb.success(t('feedback.done'));
  } catch (e: unknown) {
    fb.error(serverMessage(e) ?? t('feedback.error'));
  } finally {
    busy.value = false;
    confirmingCancel.value = false;
  }
}

function serverMessage(e: unknown): string | null {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? null);
}

const RESULT_SEVERITY: Record<string, string> = {
  SUCCESS: 'success',
  FAILED: 'danger',
  ALREADY_PAID: 'secondary',
};

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('payments.batches.detailTitle')" :subtitle="batch?.id ?? ''" />
    <ErrorState v-if="failed" :message="$t('common.loadFailed')" @retry="load" />

    <template v-else-if="batch">
      <div class="flex flex-wrap items-center gap-2">
        <Tag :value="$t(`payments.batches.statuses.${batch.status}`)" data-testid="batch-status" />
        <span class="text-sm text-muted-color">{{ $t('payments.batches.format') }}: {{ batch.format }}</span>
        <div class="flex-1" />
        <Button
          v-if="canManage && (isDraft || isExported)"
          :label="isExported ? $t('payments.batches.redownload') : $t('payments.batches.export')"
          icon="pi pi-download"
          :disabled="busy"
          data-testid="export-btn"
          @click="doExport"
        />
        <Button
          v-if="canCancel"
          :label="$t('common.cancel')"
          icon="pi pi-times"
          severity="danger"
          outlined
          :disabled="busy"
          data-testid="cancel-btn"
          @click="confirmingCancel = true"
        />
      </div>

      <!-- Cancelling an EXPORTED run is the one action the system cannot verify: it has no way to
           know whether the file already reached the bank. -->
      <Message v-if="confirmingCancel" severity="warn" :closable="false" data-testid="cancel-warning">
        <div class="flex flex-col gap-2">
          <span>{{ isExported ? $t('payments.batches.cancelExportedWarning') : $t('payments.batches.cancelWarning') }}</span>
          <div class="flex gap-2">
            <Button :label="$t('common.confirm')" size="small" severity="danger" :disabled="busy" data-testid="cancel-confirm" @click="doCancel" />
            <Button :label="$t('common.back')" size="small" text :disabled="busy" @click="confirmingCancel = false" />
          </div>
        </div>
      </Message>

      <Message v-if="isExported" severity="info" :closable="false">
        {{ $t('payments.batches.importHint') }}
      </Message>

      <AppDataTable :value="lines" :total="lines.length" :loading="loading" dataKey="id" data-testid="line-table">
        <Column field="document.docNo" :header="$t('payments.batches.document')" />
        <Column :header="$t('payments.batches.payee')">
          <template #body="{ data }">
            <!-- Account numbers are text: as numbers their leading zeros would vanish. -->
            <span class="text-sm">{{ data.bankCode }} · {{ data.accountNo }}</span>
            <div class="text-xs text-muted-color">{{ data.accountName }}</div>
          </template>
        </Column>
        <Column :header="$t('payments.batches.amount')">
          <template #body="{ data }">
            <div class="text-right">
              <div>{{ fmt(netOf(data)) }}</div>
              <div v-if="data.whtAmount && data.whtAmount !== '0'" class="text-xs text-muted-color">
                {{ $t('payments.batches.afterWht', { wht: fmt(data.whtAmount) }) }}
              </div>
            </div>
          </template>
        </Column>

        <!-- Result entry, only while the run is out at the bank and unanswered. -->
        <Column v-if="isExported && canManage" :header="$t('payments.batches.bankSaid')">
          <template #body="{ data }">
            <div class="flex flex-col gap-1" data-testid="result-entry">
              <Select
                v-model="entry[data.document.id].result"
                :options="resultOptions"
                optionLabel="label"
                optionValue="value"
                size="small"
                class="w-36"
              />
              <InputText
                v-if="entry[data.document.id].result === 'SUCCESS'"
                v-model="entry[data.document.id].actualRate"
                size="small"
                class="w-36"
                :placeholder="$t('payments.batches.actualRate')"
                :aria-label="$t('payments.batches.actualRate')"
              />
              <InputText
                v-else
                v-model="entry[data.document.id].failReason"
                size="small"
                class="w-36"
                :placeholder="$t('payments.batches.failReason')"
                :aria-label="$t('payments.batches.failReason')"
              />
            </div>
          </template>
        </Column>

        <Column v-else :header="$t('payments.batches.outcome')">
          <template #body="{ data }">
            <div v-if="data.result" class="flex flex-col gap-1" data-testid="line-outcome">
              <Tag :value="$t(`payments.batches.result.${data.result}`)" :severity="RESULT_SEVERITY[data.result]" />
              <span v-if="data.failReason" class="text-xs text-muted-color">{{ data.failReason }}</span>
            </div>
            <span v-else class="text-xs text-muted-color">—</span>
          </template>
        </Column>
      </AppDataTable>

      <div v-if="isExported && canManage" class="flex flex-col gap-3">
        <!-- Preferred path: let the bank's own file say which lines were paid. -->
        <div class="flex flex-wrap items-center gap-2">
          <FileUpload
            mode="basic"
            name="file"
            customUpload
            auto
            :disabled="busy"
            :chooseLabel="$t('payments.batches.importFile')"
            chooseIcon="pi pi-file-import"
            data-testid="import-file"
            @uploader="doImportFile"
          />
          <span class="text-xs text-muted-color">{{ $t('payments.batches.importFileHint') }}</span>
        </div>
        <!-- Fallback: a bank that returns nothing readable still has to be recordable by hand. -->
        <div class="flex flex-wrap items-center gap-2">
          <Button
            :label="$t('payments.batches.import')"
            icon="pi pi-upload"
            severity="secondary"
            outlined
            :disabled="busy"
            data-testid="import-btn"
            @click="doImport"
          />
          <span class="text-xs text-muted-color">{{ $t('payments.batches.rejectedReturnHint') }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
