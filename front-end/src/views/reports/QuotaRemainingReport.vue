<script setup lang="ts">
import PageHeader from "@/components/PageHeader.vue";
import PageToolbar from "@/components/PageToolbar.vue";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import InputNumber from "primevue/inputnumber";
import Button from "primevue/button";
import { onMounted, ref, watch } from "vue";
import { useReportsStore } from "../../stores/reports";
import { exportReportCsv } from "../../api/reports";
import ErrorState from "@/components/ErrorState.vue";
import EmptyState from "@/components/EmptyState.vue";

const reports = useReportsStore();
const year = ref<number | null>(null);

function load() {
  reports.loadQuotaRemaining(year.value ? { year: year.value } : {});
}
onMounted(load);

// Reload as soon as the year is changed or cleared — no Apply button needed.
watch(year, () => load());
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.tabs.quotaRemaining')" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="load()" />
    <PageToolbar>
      <template #filters>
        <InputNumber
          v-model="year"
          :useGrouping="false"
          :min="2000"
          :max="9999"
          :placeholder="$t('reports.quotaRemaining.currentCycle')"
          showButtons
        />
      </template>
      <template #actions>
        <Button
          :label="$t('reports.export')"
          icon="pi pi-download"
          severity="secondary"
          outlined
          :disabled="!reports.quota.length"
          @click="exportReportCsv('quota-remaining', year ? { year } : {})"
        />
      </template>
    </PageToolbar>
    <DataTable
      :value="reports.quota"
      :loading="reports.loading"
      dataKey="employeeId"
      class="text-sm"
      :sortOrder="1"
    >
      <template #empty
        ><EmptyState :title="$t('reports.quotaRemaining.empty')"
      /></template>
      <Column header="#" class="w-12"
        ><template #body="{ index }">{{ index + 1 }}</template></Column
      >
      <Column field="quotaType" :header="$t('reports.quotaRemaining.quota')" />
      <Column
        field="employeeName"
        :header="$t('reports.quotaRemaining.employee')"
      />
      <Column
        field="departmentName"
        :header="$t('reports.quotaRemaining.department')"
        ><template #body="{ data }">{{
          data.departmentName ?? "—"
        }}</template></Column
      >
      <Column field="year" :header="$t('reports.quotaRemaining.yearCol')" />
      <Column :header="$t('reports.quotaRemaining.entitled')"
        ><template #body="{ data }"
          >{{ data.entitled }} {{ data.unit }}</template
        ></Column
      >
      <Column :header="$t('reports.quotaRemaining.used')"
        ><template #body="{ data }"
          >{{ data.used }} {{ data.unit }}</template
        ></Column
      >
      <Column :header="$t('reports.quotaRemaining.remaining')"
        ><template #body="{ data }"
          ><span class="font-semibold"
            >{{ data.remaining }} {{ data.unit }}</span
          ></template
        ></Column
      >
    </DataTable>
  </div>
</template>
