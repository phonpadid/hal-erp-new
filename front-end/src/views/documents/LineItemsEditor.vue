<script setup lang="ts">
/**
 * Line-item editor for the Create Document wizard. Renders the per-line grid as a PrimeVue
 * DataTable in cell-edit mode (editMode="cell"): each editable column defines an #editor
 * template and the row object is mutated in place. Money stays a string end to end —
 * <InputNumber> is bridged through string conversion at the input edge and never stored as a
 * number; `lineAmount` does the math with Decimal. Columns gated by permission mirror the
 * server's scope (item/GL on MASTER_VIEW, budget on BUDGET_VIEW).
 */
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable, { type DataTableCellEditCompleteEvent } from 'primevue/datatable';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { lineAmount, lineInvalid } from '../../utils/form';
import type { Item } from '../../api/masterData';

export interface EditorLine {
  description: string;
  qty: string;
  unitPrice: string;
  budgetId?: string;
  itemId?: string;
  taxCodeId?: string;
}

const props = withDefaults(
  defineProps<{
    currency: string;
    items: Item[];
    budgets: Array<{ id: string; budgetName?: string; glAccount: string }>;
    canMaster: boolean;
    canBudget: boolean;
    // Active VAT codes; when empty the VAT column is hidden (feature off / no permission).
    vatCodes?: Array<{ id: string; code: string; name: string; rate: string }>;
  }>(),
  { vatCodes: () => [] },
);

function vatLabel(taxCodeId?: string): string | undefined {
  return taxCodeId ? props.vatCodes.find((v) => v.id === taxCodeId)?.code : undefined;
}

const lines = defineModel<EditorLine[]>({ required: true });

const { fmt, decimalPlacesOf } = useCurrencyFormat();

/** The GL account a chosen item maps to (read-only; the server resolves the same default). */
function glForItem(itemId?: string): string | undefined {
  return itemId ? props.items.find((i) => i.id === itemId)?.defaultGlAccount : undefined;
}

/** Display labels for the read-only cell body (the editor binds ids). */
function itemName(itemId?: string): string | undefined {
  return itemId ? props.items.find((i) => i.id === itemId)?.name : undefined;
}
function budgetLabel(budgetId?: string): string | undefined {
  return budgetId ? props.budgets.find((b) => b.id === budgetId)?.glAccount : undefined;
}

// InputNumber speaks number; bridge at the edge so the stored value stays a string.
function numOrNull(s: string): number | null {
  return s === '' || s == null ? null : Number(s);
}
function setNum(l: EditorLine, key: 'qty' | 'unitPrice', v: number | null) {
  l[key] = v == null ? '' : String(v);
}

// editMode="cell" edits a CLONE of the row; the change is only kept if we write newValue back
// to the original row here. `newValue` already carries the right type — a string for the
// qty/unitPrice editors (bridged via setNum on the clone), the selected id for the Selects.
function onCellEditComplete(e: DataTableCellEditCompleteEvent) {
  const { data, newValue, field } = e;
  if (field) (data as Record<string, unknown>)[field] = newValue;
}

/** Tint a row that fails validation so the problem is visible inside the grid. */
function rowClass(l: EditorLine): string {
  return lineInvalid(l) ? '!bg-red-50 dark:!bg-red-950/40' : '';
}

function addLine() {
  lines.value.push({ description: '', qty: '1', unitPrice: '0' });
}
function removeLine(i: number) {
  lines.value.splice(i, 1);
}

defineExpose({ addLine });
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-semibold text-color">{{ $t('documents.create.lineItems') }}</h2>
      <Button v-if="lines.length" :label="$t('documents.create.addLine')" icon="pi pi-plus" size="small" text @click="addLine" />
    </div>

    <!-- Empty state: invite the first line rather than showing a bare blank step. -->
    <div v-if="!lines.length" class="rounded-lg border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
      <i class="pi pi-list text-2xl text-muted-color" />
      <p class="mt-2 text-sm text-muted-color">{{ $t('documents.create.emptyLines') }}</p>
      <Button class="mt-3" :label="$t('documents.create.addFirstLine')" icon="pi pi-plus" size="small" @click="addLine" />
    </div>

    <!-- Cell editing: editMode="cell" + per-column #editor templates + cell-edit-complete. -->
    <DataTable
      v-else
      :value="lines"
      editMode="cell"
      :rowClass="rowClass"
      scrollable
      scrollHeight="24rem"
      class="text-sm"
      :pt="{
        table: { style: 'min-width: 50rem' },
        column: { bodycell: ({ state }) => ({ class: [{ '!py-0': state['d_editing'] }] }) },
      }"
      @cell-edit-complete="onCellEditComplete"
    >
      <!-- Item: enabled-for-company; the editor binds the id, the body shows its name. -->
      <Column v-if="canMaster" field="itemId" :header="$t('documents.create.line.item')" style="width: 14rem">
        <template #body="{ data }">
          <span :class="data.itemId ? 'text-color' : 'text-muted-color'">{{ itemName(data.itemId) ?? $t('documents.create.line.itemPlaceholder') }}</span>
        </template>
        <template #editor="{ data }">
          <Select v-model="data.itemId" :options="items" optionLabel="name" optionValue="id" :placeholder="$t('documents.create.line.itemPlaceholder')" showClear filter fluid />
        </template>
      </Column>

      <!-- GL account: read-only, auto-filled from the chosen item (no editor). -->
      <Column v-if="canMaster" :header="$t('documents.create.line.glAccount')" style="width: 9rem">
        <template #body="{ data }">
          <span :class="glForItem(data.itemId) ? 'text-color' : 'text-muted-color'">{{ glForItem(data.itemId) ?? $t('documents.create.none') }}</span>
        </template>
      </Column>

      <Column field="description" :header="$t('documents.create.line.description')">
        <template #body="{ data }">
          <span :class="data.description ? 'text-color' : 'text-muted-color'">{{ data.description || $t('documents.create.none') }}</span>
        </template>
        <template #editor="{ data }">
          <InputText v-model="data.description" autofocus fluid />
        </template>
      </Column>

      <Column field="qty" :header="$t('documents.create.line.qty')" style="width: 7rem">
        <template #body="{ data }">{{ data.qty }}</template>
        <template #editor="{ data }">
          <InputNumber
            :model-value="numOrNull(data.qty)"
            :min="0"
            :min-fraction-digits="0"
            :max-fraction-digits="3"
            autofocus
            fluid
            @update:model-value="(v) => setNum(data, 'qty', v as number | null)"
          />
        </template>
      </Column>

      <Column field="unitPrice" :header="$t('documents.create.line.unitPrice')" style="width: 10rem">
        <template #body="{ data }">{{ fmt(data.unitPrice, currency) }}</template>
        <template #editor="{ data }">
          <InputNumber
            :model-value="numOrNull(data.unitPrice)"
            :min="0"
            :min-fraction-digits="decimalPlacesOf(currency)"
            :max-fraction-digits="decimalPlacesOf(currency)"
            autofocus
            fluid
            @update:model-value="(v) => setNum(data, 'unitPrice', v as number | null)"
          />
        </template>
      </Column>

      <Column v-if="canBudget" field="budgetId" :header="$t('documents.create.line.budget')" style="width: 12rem">
        <template #body="{ data }">
          <span :class="budgetLabel(data.budgetId) ? 'text-color' : 'text-muted-color'">{{ budgetLabel(data.budgetId) ?? $t('documents.create.none') }}</span>
        </template>
        <template #editor="{ data }">
          <Select v-model="data.budgetId" :options="budgets" optionLabel="glAccount" optionValue="id" :placeholder="$t('documents.create.line.budgetPlaceholder')" showClear filter fluid />
        </template>
      </Column>

      <!-- VAT: optional per-line tax code; the server computes the tax at submit. -->
      <Column v-if="vatCodes.length" field="taxCodeId" :header="$t('documents.create.line.vat')" style="width: 9rem">
        <template #body="{ data }">
          <span :class="vatLabel(data.taxCodeId) ? 'text-color' : 'text-muted-color'">{{ vatLabel(data.taxCodeId) ?? $t('documents.create.none') }}</span>
        </template>
        <template #editor="{ data }">
          <Select v-model="data.taxCodeId" :options="vatCodes" optionLabel="code" optionValue="id" :placeholder="$t('documents.create.line.vatPlaceholder')" showClear fluid />
        </template>
      </Column>

      <!-- Amount: derived (qty × unitPrice via Decimal); read-only. -->
      <Column :header="$t('documents.create.line.amount')" style="width: 8rem" bodyStyle="text-align: right">
        <template #body="{ data }">
          <span class="font-medium text-color">{{ fmt(lineAmount(data.qty, data.unitPrice), currency) }}</span>
        </template>
      </Column>

      <Column style="width: 3rem" bodyStyle="text-align: right">
        <template #body="{ index }">
          <Button icon="pi pi-trash" text severity="danger" size="small" :aria-label="$t('common.delete')" @click="removeLine(index)" />
        </template>
      </Column>
    </DataTable>
  </div>
</template>
