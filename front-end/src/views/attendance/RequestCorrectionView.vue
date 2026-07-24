<script setup lang="ts">
import { ATTENDANCE_DIRECTIONS, CORRECTION_KINDS, timeCorrectionDetailSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { documentsApi } from '../../api/documents';
import { useFeedback } from '../../composables/useFeedback';
import { useAttendanceStore } from '../../stores/attendance';
import { formatDateTime } from '../../utils/date';
import type { FormSubmitEvent } from '@primevue/forms';

/**
 * Correcting your own attendance.
 *
 * The rule that shapes the whole screen: for a CHANGE or a REMOVE the requester SELECTS the punch
 * from that day's list rather than describing it. The correction slice built the correctable-punches
 * read for exactly this — "a correction that says 'the 08:02 one' is a correction that can name the
 * wrong row" — and a free-text time would put that failure straight back.
 *
 * The request carries no employee. Whose attendance it is about comes from the document, so there
 * is no field here that could be pointed at a colleague.
 */
const { t } = useI18n();
const fb = useFeedback();
const router = useRouter();
const store = useAttendanceStore();

const kind = ref<(typeof CORRECTION_KINDS)[number]>('ADD');
const shiftDate = ref('');
const submitting = ref(false);
const correctionDocumentTypeId = ref('');

const kindOptions = computed(() =>
  CORRECTION_KINDS.map((value) => ({ value, label: t(`attendance.correction.kinds.${value}`) })),
);
const directionOptions = computed(() =>
  ATTENDANCE_DIRECTIONS.map((value) => ({ value, label: t(`attendance.correction.directions.${value}`) })),
);
/** Every punch of the chosen day that still counts, labelled the way a person recognises one. */
const punchOptions = computed(() =>
  store.correctablePunches.map((event) => ({
    value: event.id,
    label: `${t(`attendance.punch.direction${event.direction === 'IN' ? 'In' : 'Out'}`)} · ${formatDateTime(event.occurredAt)}`,
  })),
);

/** A target is chosen only when there is something to supersede. An ADD names nothing. */
const needsTarget = computed(() => kind.value !== 'ADD');
/** A REMOVE voids a punch, so it supplies no instant of its own. */
const needsTime = computed(() => kind.value !== 'REMOVE');

onMounted(async () => {
  const types = await documentsApi.creatableTypes().catch(() => []);
  correctionDocumentTypeId.value = types.find((type) => type.code === 'TCORR')?.id ?? '';
});

function onDay(value: Date | null) {
  shiftDate.value = value ? toIsoDate(value) : '';
  return store.loadCorrectablePunches(shiftDate.value);
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  submitting.value = true;
  try {
    const ok = await store.requestCorrection(correctionDocumentTypeId.value, {
      shiftDate: e.values.shiftDate,
      kind: e.values.kind,
      targetEventId: e.values.targetEventId || undefined,
      requestedAt: e.values.requestedAt || undefined,
      requestedDirection: e.values.requestedDirection || undefined,
      reason: e.values.reason,
    });
    if (ok) {
      fb.success(t('attendance.correction.submitted'));
      router.push({ name: 'documents' });
    } else {
      const step = store.failedStep;
      fb.error(step ? `${t(`attendance.correction.failed.${step}`)} ${store.error}` : store.error);
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <PageHeader
      :title="$t('attendance.correction.title')"
      :subtitle="$t('attendance.correction.subtitle')"
    />

    <div class="card">
      <Form
        :resolver="zodResolver(timeCorrectionDetailSchema)"
        :initialValues="{ shiftDate: '', kind: 'ADD', targetEventId: '', requestedAt: '', requestedDirection: '', reason: '' }"
        class="flex flex-col gap-4"
        @submit="submit"
      >
        <FormField v-slot="$f" name="shiftDate" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('attendance.correction.fields.shiftDate') }}</label>
          <DatePicker dateFormat="yy-mm-dd" showIcon @update:modelValue="(v: any) => onDay(v)" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">
            {{ $f.error?.message }}
          </Message>
        </FormField>

        <FormField name="kind" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('attendance.correction.fields.kind') }}</label>
          <Select
            :options="kindOptions"
            optionLabel="label"
            optionValue="value"
            @update:modelValue="(v: any) => (kind = v)"
          />
        </FormField>

        <!-- CHANGE and REMOVE pick a row; ADD is offered none, because it supersedes nothing. -->
        <FormField v-if="needsTarget" v-slot="$f" name="targetEventId" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('attendance.correction.fields.target') }}</label>
          <Select
            :options="punchOptions"
            optionLabel="label"
            optionValue="value"
            :placeholder="$t('attendance.correction.targetPrompt')"
            :emptyMessage="$t('attendance.correction.targetEmpty')"
          />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">
            {{ $f.error?.message }}
          </Message>
        </FormField>

        <!-- A REMOVE asks for no time at all: it voids a punch rather than moving it. -->
        <template v-if="needsTime">
          <FormField v-slot="$f" name="requestedAt" class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('attendance.correction.fields.requestedAt') }}</label>
            <DatePicker showTime hourFormat="24" dateFormat="yy-mm-dd" showIcon />
            <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">
              {{ $f.error?.message }}
            </Message>
          </FormField>

          <FormField v-slot="$f" name="requestedDirection" class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">
              {{ $t('attendance.correction.fields.requestedDirection') }}
            </label>
            <Select :options="directionOptions" optionLabel="label" optionValue="value" />
            <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">
              {{ $f.error?.message }}
            </Message>
          </FormField>
        </template>

        <FormField v-slot="$f" name="reason" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('attendance.correction.fields.reason') }}</label>
          <Textarea rows="3" autoResize />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">
            {{ $f.error?.message }}
          </Message>
        </FormField>

        <p class="text-xs text-muted-color">{{ $t('attendance.correction.approvalNote') }}</p>

        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="router.back()" />
          <Button type="submit" :label="$t('attendance.correction.submit')" :loading="submitting" />
        </div>
      </Form>
    </div>
  </div>
</template>
