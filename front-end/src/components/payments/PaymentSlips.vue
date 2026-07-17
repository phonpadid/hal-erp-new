<script setup lang="ts">
/**
 * The slips proving a payment left the bank: list, attach, remove.
 *
 * Keyed by DOCUMENT id — a payment is unique per document and the client is never handed the
 * payment's own id. Mounted in two places: the record confirmation, where the slip is in hand,
 * and the paid disbursement's document, which is where it can still be read tomorrow (the
 * ready-to-pay queue drops a disbursement the moment it is paid).
 *
 * Controls follow permission CODES, mirroring the server; the client guard is UX only.
 * `absent` tells the caller the document has no payment at all, so a never-paid document can
 * render no panel rather than an empty one.
 */
import Button from 'primevue/button';
import FileUpload from 'primevue/fileupload';
import type { FileUploadUploaderEvent } from 'primevue/fileupload';
import Message from 'primevue/message';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { paymentsApi, type PaymentSlip } from '../../api/payments';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/useFeedback';

const props = defineProps<{ documentId: string }>();
const emit = defineEmits<{ absent: [] }>();

const { t } = useI18n();
const auth = useAuthStore();
const fb = useFeedback();

const slips = ref<PaymentSlip[]>([]);
const loading = ref(true);
const busy = ref(false);

const canAttach = () => auth.can('PAYMENT_MANAGE');
const canDelete = () => auth.can('PAYMENT_SLIP_DELETE');

async function load() {
  loading.value = true;
  try {
    slips.value = await paymentsApi.slips.list(props.documentId);
  } catch {
    // No payment recorded for this document — there is nothing for a slip to be evidence of, so
    // tell the caller to render nothing rather than an empty evidence panel.
    slips.value = [];
    emit('absent');
  } finally {
    loading.value = false;
  }
}

async function onUpload(event: FileUploadUploaderEvent) {
  const files = (Array.isArray(event.files) ? event.files : [event.files]) as File[];
  busy.value = true;
  try {
    for (const file of files) await paymentsApi.slips.upload(props.documentId, file);
    await load();
    fb.success(t('payments.slips.attached'));
  } catch (e) {
    fb.error(e, t('payments.slips.uploadFailed'));
  } finally {
    busy.value = false;
  }
}

async function download(slip: PaymentSlip) {
  try {
    // A short-lived presigned URL — the storage key never reaches the client.
    window.open(await paymentsApi.slips.downloadUrl(props.documentId, slip.id), '_blank');
  } catch (e) {
    fb.error(e, t('payments.slips.downloadFailed'));
  }
}

async function remove(slip: PaymentSlip) {
  busy.value = true;
  try {
    await paymentsApi.slips.remove(props.documentId, slip.id);
    await load();
    fb.success(t('payments.slips.deleted'));
  } catch (e) {
    fb.error(e, t('payments.slips.deleteFailed'));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="payment-slips">
    <div class="flex items-center gap-2">
      <i class="pi pi-paperclip text-muted-color text-sm" />
      <span class="text-sm font-medium text-color">{{ $t('payments.slips.title') }}</span>
    </div>

    <div v-if="loading" class="text-xs text-muted-color">{{ $t('common.loading') }}</div>

    <template v-else>
      <!-- Say it plainly: an empty area reads as a broken panel. -->
      <Message v-if="!slips.length" severity="secondary" variant="simple" size="small" data-testid="no-slips">
        {{ $t('payments.slips.empty') }}
      </Message>

      <ul v-else class="flex flex-col gap-1" data-testid="slip-list">
        <li
          v-for="slip in slips"
          :key="slip.id"
          class="flex items-center gap-2 rounded border border-surface-200 px-2 py-1 dark:border-surface-700"
        >
          <i class="pi pi-file text-xs text-muted-color" />
          <button type="button" class="flex-1 truncate text-left text-sm text-primary hover:underline" @click="download(slip)">
            {{ slip.fileName }}
          </button>
          <span v-if="slip.fileSizeKb" class="text-xs text-muted-color tabular-nums">{{ slip.fileSizeKb }} KB</span>
          <Button
            v-if="canDelete()"
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="danger"
            :disabled="busy"
            :aria-label="$t('common.delete')"
            data-testid="slip-delete"
            @click="remove(slip)"
          />
        </li>
      </ul>

      <FileUpload
        v-if="canAttach()"
        mode="basic"
        name="file"
        customUpload
        auto
        multiple
        :disabled="busy"
        :chooseLabel="$t('payments.slips.attach')"
        chooseIcon="pi pi-upload"
        data-testid="slip-upload"
        @uploader="onUpload"
      />
    </template>
  </div>
</template>
