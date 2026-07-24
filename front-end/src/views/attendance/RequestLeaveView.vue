<script setup lang="ts">
import { LEAVE_HALVES, leaveRequestDetailSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { quotasApi } from '../../api/quotas';
import { documentsApi } from '../../api/documents';
import { useFeedback } from '../../composables/useFeedback';
import { useAttendanceStore } from '../../stores/attendance';
import type { FormSubmitEvent } from '@primevue/forms';

/**
 * Raising leave about yourself.
 *
 * The screen's one real job beyond the form is the PREVIEW. Leave charges working days, so a range
 * spanning a public holiday costs less than its length — and learning that after the document is
 * submitted means learning it after the quota is reserved. Showing the number first is the
 * difference between choosing and discovering.
 */
const { t } = useI18n();
const fb = useFeedback();
const router = useRouter();
const store = useAttendanceStore();

const quotas = ref<Array<{ id: string; quotaType: string }>>([]);
const leaveTypeId = ref('');
const submitting = ref(false);

/** The `derives_quantity` document type for leave — the generic submit endpoint refuses it. */
const leaveDocumentTypeId = ref('');

const halfOptions = computed(() =>
  LEAVE_HALVES.map((value) => ({ value, label: t(`attendance.leave.halves.${value}`) })),
);
const quotaOptions = computed(() =>
  quotas.value.map((q) => ({ value: q.id, label: q.quotaType })),
);

onMounted(async () => {
  const [selectable, types] = await Promise.all([
    quotasApi.selectable().catch(() => []),
    documentsApi.creatableTypes().catch(() => []),
  ]);
  quotas.value = selectable;
  leaveDocumentTypeId.value = types.find((type) => type.code === 'LEAVE')?.id ?? '';
});

/** Re-preview whenever the dates or the halves move — the charge follows both. */
const draft = ref({ fromDate: '', toDate: '', fromHalf: 'FULL', toHalf: 'FULL' });

function refreshPreview(patch: Partial<typeof draft.value>) {
  draft.value = { ...draft.value, ...patch };
  return store.previewLeave(draft.value);
}

function onDate(field: 'fromDate' | 'toDate', value: Date | null) {
  refreshPreview({ [field]: value ? toIsoDate(value) : '' } as Partial<typeof draft.value>);
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  submitting.value = true;
  try {
    const ok = await store.requestLeave(leaveDocumentTypeId.value, {
      quotaId: e.values.quotaId,
      fromDate: e.values.fromDate,
      toDate: e.values.toDate,
      fromHalf: e.values.fromHalf,
      toHalf: e.values.toHalf,
    });
    if (ok) {
      fb.success(t('attendance.leave.submitted'));
      router.push({ name: 'documents' });
    } else {
      // Name the step: "your document was created but could not be submitted" is actionable in a
      // way that "request failed" is not.
      const step = store.failedStep;
      fb.error(step ? `${t(`attendance.leave.failed.${step}`)} ${store.error}` : store.error);
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <PageHeader :title="$t('attendance.leave.title')" :subtitle="$t('attendance.leave.subtitle')" />

    <div class="card">
      <Form
        :resolver="zodResolver(leaveRequestDetailSchema)"
        :initialValues="{ quotaId: '', fromDate: '', toDate: '', fromHalf: 'FULL', toHalf: 'FULL' }"
        class="flex flex-col gap-4"
        @submit="submit"
      >
        <FormField v-slot="$f" name="quotaId" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('attendance.leave.fields.type') }}</label>
          <Select
            v-model="leaveTypeId"
            :options="quotaOptions"
            optionLabel="label"
            optionValue="value"
          />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">
            {{ $f.error?.message }}
          </Message>
        </FormField>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="$f" name="fromDate" class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('attendance.leave.fields.fromDate') }}</label>
            <DatePicker dateFormat="yy-mm-dd" showIcon @update:modelValue="(v: any) => onDate('fromDate', v)" />
            <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">
              {{ $f.error?.message }}
            </Message>
          </FormField>

          <FormField name="fromHalf" class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('attendance.leave.fields.fromHalf') }}</label>
            <Select
              :options="halfOptions"
              optionLabel="label"
              optionValue="value"
              @update:modelValue="(v: any) => refreshPreview({ fromHalf: v })"
            />
          </FormField>

          <FormField v-slot="$f" name="toDate" class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('attendance.leave.fields.toDate') }}</label>
            <DatePicker dateFormat="yy-mm-dd" showIcon @update:modelValue="(v: any) => onDate('toDate', v)" />
            <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">
              {{ $f.error?.message }}
            </Message>
          </FormField>

          <FormField name="toHalf" class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('attendance.leave.fields.toHalf') }}</label>
            <Select
              :options="halfOptions"
              optionLabel="label"
              optionValue="value"
              @update:modelValue="(v: any) => refreshPreview({ toHalf: v })"
            />
          </FormField>
        </div>

        <!-- What it costs, before it is submitted rather than after the quota is reserved. -->
        <div class="rounded border border-surface bg-surface-100 p-3 dark:bg-surface-800">
          <p class="text-sm font-medium text-color">{{ $t('attendance.leave.preview.title') }}</p>
          <p v-if="store.leavePreview" class="text-lg text-color">
            {{ $t('attendance.leave.preview.days', { days: store.leavePreview.totalDays }) }}
          </p>
          <p v-else class="text-sm text-muted-color">{{ $t('attendance.leave.preview.none') }}</p>
          <p class="mt-1 text-xs text-muted-color">{{ $t('attendance.leave.preview.note') }}</p>
        </div>

        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="router.back()" />
          <Button type="submit" :label="$t('attendance.leave.submit')" :loading="submitting" />
        </div>
      </Form>
    </div>
  </div>
</template>
