<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

/**
 * The one answer to a missing signature, wherever it blocks: a submit, an approve, a new document.
 * Says why the button beside it is disabled and takes the person to the profile page where the
 * signature panel lives. The server still refuses with SIGNATURE_REQUIRED; this is the UX mirror.
 */
withDefaults(defineProps<{ variant?: 'submit' | 'approve' }>(), { variant: 'submit' });

const { t } = useI18n();
const router = useRouter();
</script>

<template>
  <Message severity="warn" icon="pi pi-pencil" data-testid="signature-required">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="flex-1 min-w-48">
        <div class="font-semibold">{{ t('documents.signatureRequired.title') }}</div>
        <div class="text-sm">
          {{ t(variant === 'approve' ? 'documents.signatureRequired.approveBody' : 'documents.signatureRequired.body') }}
        </div>
      </div>
      <Button
        :label="t('documents.signatureRequired.goToProfile')"
        icon="pi pi-upload"
        size="small"
        severity="warn"
        data-testid="signature-required-link"
        @click="router.push({ name: 'profile' })"
      />
    </div>
  </Message>
</template>
