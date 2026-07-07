<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDocumentsStore } from '@/stores/documents';
import StatCard from './StatCard.vue';

const { t } = useI18n();
const documents = useDocumentsStore();
onMounted(() => documents.loadList());
</script>

<template>
  <StatCard
    icon="pi-file"
    :label="t('dashboard.myDocuments')"
    :hint="t('dashboard.myDocumentsHint')"
    :value="documents.total"
    :loading="documents.loading"
    :error="documents.error"
    to="/documents"
  />
</template>
