<script setup lang="ts">
/**
 * Record how a fully approved, accrue-on-approval document was finally settled.
 *
 * Writes `document_settlement` via `POST /documents/:id/settle` — the settlement path, NOT the
 * payment path. CASH is the only type the server accepts today, so it is the only one offered;
 * evidence is required (the server refuses a settlement without it). Reused by the settlements
 * queue and by the document detail panel.
 *
 * Gated on PAYMENT_MANAGE, mirroring the server; the client guard is UX only. The web app is a
 * user-JWT session, so an API-key session never reaches this dialog — the server denies the
 * endpoint to API keys regardless.
 */
import { Form } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import FileUpload from 'primevue/fileupload';
import type { FileUploadSelectEvent } from 'primevue/fileupload';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { z } from 'zod';
import type { FormSubmitEvent } from '@primevue/forms';
import { SETTLEMENT_TYPES } from '../../api/settlements';
import { useSettlementsStore } from '../../stores/settlements';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/useFeedback';

const props = defineProps<{ visible: boolean; documentId: string; docNo?: string }>();
const emit = defineEmits<{ 'update:visible': [boolean]; recorded: [] }>();

const { t } = useI18n();
const settlements = useSettlementsStore();
const auth = useAuthStore();
const fb = useFeedback();

const canManage = () => auth.can('PAYMENT_MANAGE');

// One schema mirroring the server's RecordSettlementDto. The file lives outside the resolver
// (a file input is not a form value), so it is validated in the submit handler. The client rules
// are a mirror of the server's, not a second authority — the server still enforces.
const schema = z.object({
  settlementType: z.literal('CASH'),
  settledAt: z.date({ message: t('settlements.record.errors.date') }),
  reference: z.string().max(255).optional(),
  note: z.string().max(2000).optional(),
});
const resolver = zodResolver(schema);
const initialValues = ref({ settlementType: 'CASH' as const, settledAt: new Date(), reference: '', note: '' });

const file = ref<File | null>(null);
const fileError = ref(false);
const busy = ref(false);

const typeOptions = computed(() => SETTLEMENT_TYPES.map((v) => ({ label: t('settlements.types.' + v), value: v })));

function onSelectFile(e: FileUploadSelectEvent) {
  const picked = (Array.isArray(e.files) ? e.files[0] : e.files) as File | undefined;
  file.value = picked ?? null;
  if (file.value) fileError.value = false;
}
function clearFile() {
  file.value = null;
}

/** Format a picked Date as the yyyy-mm-dd the server's IsDateString accepts, in local time. */
function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) return;
  // Evidence is required, and the file input sits outside the resolver — block here.
  if (!file.value) {
    fileError.value = true;
    return;
  }
  busy.value = true;
  const ok = await settlements.record(
    props.documentId,
    {
      settlementType: 'CASH',
      settledAt: toIsoDate(e.values.settledAt as Date),
      reference: (e.values.reference as string) || undefined,
      note: (e.values.note as string) || undefined,
    },
    file.value,
  );
  busy.value = false;
  if (ok) {
    fb.success(t('settlements.record.done'));
    file.value = null;
    emit('recorded');
    emit('update:visible', false);
  } else {
    // Most likely already settled (server rejects a second settlement) — surface it plainly.
    fb.error(settlements.error || t('settlements.record.failed'));
    emit('recorded'); // let the caller refresh; a settled document should drop from the queue
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    :header="$t('settlements.record.title')"
    modal
    class="w-md"
    data-testid="record-settlement-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="!canManage()" class="text-sm text-muted-color">{{ $t('settlements.record.noPermission') }}</div>

    <Form
      v-else
      :resolver="resolver"
      :initialValues="initialValues"
      class="flex flex-col gap-4"
      @submit="onSubmit"
    >
      <div v-if="docNo" class="text-sm text-muted-color">{{ docNo }}</div>

      <FormField v-slot="$field" name="settlementType" class="flex flex-col gap-1">
        <label class="text-sm font-medium text-color">{{ $t('settlements.record.type') }}</label>
        <Select :options="typeOptions" optionLabel="label" optionValue="value" fluid data-testid="settlement-type" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
      </FormField>

      <FormField v-slot="$field" name="settledAt" class="flex flex-col gap-1">
        <label class="text-sm font-medium text-color"><span class="text-primary">*</span> {{ $t('settlements.record.date') }}</label>
        <DatePicker dateFormat="yy-mm-dd" showIcon fluid data-testid="settlement-date" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
      </FormField>

      <FormField v-slot="$field" name="reference" class="flex flex-col gap-1">
        <label class="text-sm font-medium text-color">{{ $t('settlements.record.reference') }}</label>
        <InputText fluid :placeholder="$t('settlements.record.referencePlaceholder')" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
      </FormField>

      <FormField v-slot="$field" name="note" class="flex flex-col gap-1">
        <label class="text-sm font-medium text-color">{{ $t('settlements.record.note') }}</label>
        <Textarea rows="2" fluid autoResize />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
      </FormField>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-color"><span class="text-primary">*</span> {{ $t('settlements.record.evidence') }}</label>
        <div v-if="file" class="flex items-center gap-2 rounded border border-surface-200 px-2 py-1 dark:border-surface-700" data-testid="settlement-file">
          <i class="pi pi-file text-xs text-muted-color" />
          <span class="flex-1 truncate text-sm">{{ file.name }}</span>
          <Button icon="pi pi-times" text rounded size="small" :aria-label="$t('common.delete')" @click="clearFile" />
        </div>
        <FileUpload
          v-else
          mode="basic"
          name="file"
          customUpload
          :auto="false"
          :chooseLabel="$t('settlements.record.attach')"
          chooseIcon="pi pi-upload"
          data-testid="settlement-file-upload"
          @select="onSelectFile"
        />
        <Message v-if="fileError" severity="error" size="small" variant="simple" data-testid="file-required">
          {{ $t('settlements.record.errors.evidence') }}
        </Message>
      </div>

      <div class="flex justify-end gap-2">
        <Button :label="$t('common.close')" text :disabled="busy" @click="emit('update:visible', false)" />
        <Button type="submit" :label="$t('settlements.record.confirm')" :loading="busy" data-testid="settlement-confirm" />
      </div>
    </Form>
  </Dialog>
</template>
