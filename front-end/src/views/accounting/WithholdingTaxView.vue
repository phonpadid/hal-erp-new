<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { formatDate } from '@/utils/date';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { useWhtStore } from '../../stores/wht';
import { sumAmounts } from '../../utils/money';
import type { WhtCertificateRow } from '../../api/wht';

/**
 * What the company withheld from its vendors and has not yet paid over.
 *
 * The list IS the outstanding liability: a certificate not stamped with a remittance is tax still
 * owed. Remitting posts the entry that clears `WHT_PAYABLE` by the total of what is selected —
 * which is why the selection matters and why the screen shows it.
 */
const { t } = useI18n();
const fb = useFeedback();
const { fmtBase } = useCurrencyFormat();
const auth = useAuthStore();
const store = useWhtStore();

const canRemit = computed(() => auth.can('WHT_REMIT'));
const selected = ref<WhtCertificateRow[]>([]);
const remitDialog = ref(false);
const remittedOn = ref<Date | null>(new Date());

/** The figure the entry will carry — summed as decimals, never through a JS number. */
const selectedTotal = computed(() => sumAmounts(selected.value.map((c) => c.whtAmount)));

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function confirmRemit() {
  if (!selected.value.length || !remittedOn.value) return;
  const ok = await store.remit(selected.value.map((c) => c.id), toIsoDate(remittedOn.value));
  if (ok) {
    remitDialog.value = false;
    selected.value = [];
    fb.success(t('gl.wht.remitted'));
  } else fb.error(store.error);
}

onMounted(() => store.load());
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.wht.title')" :subtitle="$t('gl.wht.subtitle')">
      <template #actions>
        <Button
          v-if="canRemit"
          :label="$t('gl.wht.remit')"
          icon="pi pi-send"
          :disabled="!selected.length"
          data-testid="open-remit"
          @click="remitDialog = true"
        />
      </template>
    </PageHeader>

    <ErrorState v-if="store.error && !store.certificates.length" :message="store.error" @retry="store.load()" />

    <div v-else class="card">
      <DataTable
        v-model:selection="selected"
        :value="store.certificates"
        dataKey="id"
        class="text-sm"
        :loading="store.loading"
        paginator
        :rows="20"
      >
        <Column v-if="canRemit" selectionMode="multiple" headerStyle="width:3rem" />
        <Column field="certificateNo" :header="$t('gl.wht.columns.certificateNo')" sortable />
        <Column :header="$t('gl.wht.columns.vendor')">
          <template #body="{ data }">{{ data.vendor?.name ?? '—' }}</template>
        </Column>
        <Column :header="$t('gl.wht.columns.issuedOn')" sortable field="issuedOn">
          <template #body="{ data }">{{ formatDate(data.issuedOn) }}</template>
        </Column>
        <Column :header="$t('gl.wht.columns.base')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.baseAmount) }}</span></template>
        </Column>
        <Column :header="$t('gl.wht.columns.amount')" headerStyle="text-align:right">
          <template #body="{ data }">
            <span class="tabular-nums" data-testid="wht-amount">{{ fmtBase(data.whtAmount) }}</span>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('gl.wht.empty')" />
        </template>
      </DataTable>

      <div class="mt-2 flex justify-end px-2 text-sm font-medium">
        {{ $t('gl.wht.outstanding') }}:
        <b class="ml-2 tabular-nums" data-testid="wht-total">{{ fmtBase(store.total) }}</b>
      </div>
    </div>

    <Dialog v-model:visible="remitDialog" modal :header="$t('gl.wht.remit')" class="w-full max-w-md">
      <div class="flex flex-col gap-3">
        <!-- The entry clears the payable by THIS total, not by the account's balance. -->
        <Message severity="info" size="small" variant="simple" data-testid="remit-explain">
          {{ $t('gl.wht.remitExplain', { count: selected.length, amount: fmtBase(selectedTotal) }) }}
        </Message>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.wht.remittedOn') }}
          <DatePicker v-model="remittedOn" dateFormat="yy-mm-dd" showIcon />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="remitDialog = false" />
        <Button
          :label="$t('gl.wht.remit')"
          :loading="store.working"
          :disabled="!remittedOn"
          data-testid="confirm-remit"
          @click="confirmRemit"
        />
      </template>
    </Dialog>
  </div>
</template>
