<script setup lang="ts">
import { holidaySchema } from '@erp/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
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

const holidayDialog = ref(false);
const holidayModel = ref<{ holidayDate: Date | null; name: string }>({ holidayDate: null, name: '' });
const holidayErr = ref<Record<string, string>>({});

function openHoliday() {
  holidayErr.value = {};
  holidayModel.value = { holidayDate: null, name: '' };
  holidayDialog.value = true;
}
async function submitHoliday() {
  const parsed = holidaySchema.safeParse({
    holidayDate: toYmd(holidayModel.value.holidayDate),
    name: holidayModel.value.name,
  });
  if (!parsed.success) {
    holidayErr.value = fieldErrors(parsed.error.issues);
    return;
  }
  holidayErr.value = {};
  if (await org.createHoliday(parsed.data)) {
    holidayDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(org.error);
}

async function removeHoliday(id: string) {
  if (!(await fb.confirm({ message: t('feedback.confirm.removeHoliday') }))) return;
  if (await org.removeHoliday(id)) fb.success(t('feedback.done'));
  else fb.error(org.error);
}

onMounted(() => org.loadHolidays());
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.org.tabs.holidays')" />
    <PageToolbar>
      <template #actions>
        <Button v-if="can('HOLIDAY_MANAGE')" :label="$t('admin.org.addHoliday')" icon="pi pi-plus" size="small" @click="openHoliday()" />
      </template>
    </PageToolbar>
    <ErrorState v-if="org.error" :message="org.error" @retry="org.loadHolidays()" />
    <div v-else class="card">
      <AppDataTable
        :value="org.holidays"
        :total="org.holidaysTotal"
        :loading="org.loading"
        :page="org.holidaysPage"
        :rows="org.holidaysLimit"
        @page="(e: any) => org.loadHolidays(e.page, e.limit)"
        @refresh="org.loadHolidays()"
      >
        <Column :header="$t('common.date')"><template #body="{ data }">{{ formatDate(data.holidayDate) }}</template></Column>
        <Column field="name" :header="$t('common.name')" />
        <Column header=""><template #body="{ data }"><Button v-if="can('HOLIDAY_MANAGE')" icon="pi pi-trash" text size="small" severity="danger" @click="removeHoliday(data.id)" /></template></Column>
        <template #empty>
          <EmptyState icon="pi pi-calendar-times" :title="$t('admin.org.empty.holidays')" />
        </template>
      </AppDataTable>
    </div>

    <Dialog v-model:visible="holidayDialog" :header="$t('admin.org.addHoliday')" modal class="w-96">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('common.date') }}</label>
          <DatePicker v-model="holidayModel.holidayDate" showButtonBar dateFormat="yy-mm-dd" />
          <Message v-if="holidayErr.holidayDate" severity="error" size="small" variant="simple">{{ holidayErr.holidayDate }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('common.name') }}</label>
          <InputText v-model="holidayModel.name" type="text" />
          <Message v-if="holidayErr.name" severity="error" size="small" variant="simple">{{ holidayErr.name }}</Message>
        </div>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="holidayDialog = false" /><Button :label="$t('common.add')" @click="submitHoliday()" /></div>
      </div>
    </Dialog>
  </div>
</template>
