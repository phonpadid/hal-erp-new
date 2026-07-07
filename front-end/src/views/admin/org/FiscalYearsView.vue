<script setup lang="ts">
import { fiscalYearSchema } from '@erp/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { formatDate } from '@/utils/date';
import { useAuthStore } from '../../../stores/auth';
import { useOrgStore } from '../../../stores/org';
import { toYmd, fieldErrors } from './orgForm';

const auth = useAuthStore();
const org = useOrgStore();
const fb = useFeedback();
const { t } = useI18n();
const can = (c: string) => auth.can(c);

const fyDialog = ref(false);
// DatePicker binds a `Date`, but the shared schema (single source of truth with the backend DTO)
// expects `year: number` and dates as 'YYYY-MM-DD' strings. Hold local Date models and convert +
// validate against the same schema on submit — keeping client/server validation from drifting.
const fyModel = ref<{ year: Date | null; startDate: Date | null; endDate: Date | null }>({ year: null, startDate: null, endDate: null });
const fyErr = ref<Record<string, string>>({});

function openFy() {
  fyErr.value = {};
  fyModel.value = { year: new Date(new Date().getFullYear(), 0, 1), startDate: null, endDate: null };
  fyDialog.value = true;
}
async function submitFy() {
  const parsed = fiscalYearSchema.safeParse({
    year: fyModel.value.year ? fyModel.value.year.getFullYear() : NaN,
    startDate: toYmd(fyModel.value.startDate),
    endDate: toYmd(fyModel.value.endDate),
  });
  if (!parsed.success) {
    fyErr.value = fieldErrors(parsed.error.issues);
    return;
  }
  fyErr.value = {};
  if (await org.createFiscalYear(parsed.data)) {
    fyDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(org.error);
}

async function closeFiscalYear(id: string) {
  if (!(await fb.confirm({ message: t('feedback.confirm.closeFiscalYear') }))) return;
  if (await org.closeFiscalYear(id)) fb.success(t('feedback.done'));
  else fb.error(org.error);
}

onMounted(() => org.loadFiscalYears());
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.org.tabs.fiscal')" />
    <PageToolbar>
      <template #actions>
        <Button v-if="can('FISCAL_YEAR_MANAGE')" :label="$t('admin.org.newFiscalYear')" icon="pi pi-plus" size="small" @click="openFy()" />
      </template>
    </PageToolbar>
    <ErrorState v-if="org.error" :message="org.error" @retry="org.loadFiscalYears()" />
    <div v-else class="card">
      <AppDataTable
        :value="org.fiscalYears"
        :total="org.fiscalYearsTotal"
        :loading="org.loading"
        :page="org.fiscalYearsPage"
        :rows="org.fiscalYearsLimit"
        @page="(e: any) => org.loadFiscalYears(e.page, e.limit)"
        @refresh="org.loadFiscalYears()"
      >
        <Column field="year" :header="$t('admin.org.columns.year')" />
        <Column :header="$t('admin.org.columns.start')"><template #body="{ data }">{{ formatDate(data.startDate) }}</template></Column>
        <Column :header="$t('admin.org.columns.end')"><template #body="{ data }">{{ formatDate(data.endDate) }}</template></Column>
        <Column :header="$t('common.status')"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === 'OPEN' ? 'success' : 'contrast'" /></template></Column>
        <Column header="">
          <template #body="{ data }">
            <Button v-if="can('FISCAL_YEAR_MANAGE') && data.status === 'OPEN'" :label="$t('common.close')" text size="small" severity="danger" @click="closeFiscalYear(data.id)" />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-calendar" :title="$t('admin.org.empty.fiscalYears')" />
        </template>
      </AppDataTable>
    </div>

    <Dialog v-model:visible="fyDialog" :header="$t('admin.org.newFiscalYear')" modal class="w-96">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.org.fields.year') }}</label>
          <DatePicker v-model="fyModel.year" view="year" dateFormat="yy" />
          <Message v-if="fyErr.year" severity="error" size="small" variant="simple">{{ fyErr.year }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.org.fields.startDate') }}</label>
          <DatePicker v-model="fyModel.startDate" showButtonBar dateFormat="yy-mm-dd" />
          <Message v-if="fyErr.startDate" severity="error" size="small" variant="simple">{{ fyErr.startDate }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.org.fields.endDate') }}</label>
          <DatePicker v-model="fyModel.endDate" showButtonBar dateFormat="yy-mm-dd" />
          <Message v-if="fyErr.endDate" severity="error" size="small" variant="simple">{{ fyErr.endDate }}</Message>
        </div>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="fyDialog = false" /><Button :label="$t('common.create')" @click="submitFy()" /></div>
      </div>
    </Dialog>
  </div>
</template>
