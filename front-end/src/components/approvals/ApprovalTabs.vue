<script setup lang="ts">
/**
 * The two faces of the approvals page: the INBOX (what I must sign — `DOC_APPROVE`, eligibility
 * decided by the server per document) and the SUMMARY (what my department submitted and is still
 * waiting, wherever it waits — `DOC_VIEW`, bounded by the reader's scope). Each tab is shown only
 * to a user who may open it, and the active one follows the route rather than local state, so a
 * deep link lands on the right tab.
 */
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import Tabs from 'primevue/tabs';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const tabs = computed(() =>
  [
    { name: 'approvals', label: 'approvals.tabs.inbox', permission: 'DOC_APPROVE' },
    { name: 'approvals-summary', label: 'approvals.tabs.summary', permission: 'DOC_VIEW' },
  ].filter((t) => auth.can(t.permission)),
);
const active = computed(() => String(route.name ?? ''));
</script>

<template>
  <Tabs v-if="tabs.length > 1" :value="active" class="mb-4">
    <TabList>
      <Tab
        v-for="t in tabs"
        :key="t.name"
        :value="t.name"
        :data-testid="`tab-${t.name}`"
        @click="t.name !== active && router.push({ name: t.name })"
      >
        {{ $t(t.label) }}
      </Tab>
    </TabList>
  </Tabs>
</template>
