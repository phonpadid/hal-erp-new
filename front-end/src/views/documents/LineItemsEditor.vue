<script setup lang="ts">
/**
 * Line-item editor for the Create Document wizard. Renders one card per line (not a wide
 * grid) so every field is a visible, labelled input with no horizontal scrolling — the fields
 * reflow responsively. Money stays a string end to end — <InputNumber> is bridged through
 * string conversion at the input edge and never stored as a number; the amount is derived with
 * Decimal. Fields are gated by permission mirroring the server's scope (item/GL on MASTER_VIEW,
 * budget on BUDGET_VIEW, VAT only when active codes exist).
 *
 * The requester picks WHAT they are buying (the item), never a raw GL code: choosing an item
 * shows its GL and the auto-resolved budget read-only, and the server is authoritative for both
 * (it derives the GL from the item and resolves the budget from GL + department + fiscal year).
 * The explicit budget picker is only a fallback for an item-less (free-text) line.
 */
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { computed } from 'vue';
import Message from 'primevue/message';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { lineAmount, lineInvalid, lineMissingItem } from '../../utils/form';
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
    budgets: Array<{ id: string; code: string; budgetName?: string }>;
    canMaster: boolean;
    canBudget: boolean;
    // Budget/item requirements of the selected document type (server-authoritative flags).
    // Budget affordances render only for a requires_budget type; the item is required (and an
    // item-less line blocked) for a requires_item type.
    requiresBudget?: boolean;
    requiresItem?: boolean;
    // The type's default GL: when set and it matches a loaded budget, an item-less line
    // auto-resolves its budget from it (shown read-only, no manual pick).
    defaultGlAccount?: string;
    // Active VAT codes; when empty the VAT field is hidden (feature off / no permission).
    vatCodes?: Array<{ id: string; code: string; name: string; rate: string }>;
  }>(),
  { requiresBudget: false, requiresItem: false, vatCodes: () => [] },
);

const lines = defineModel<EditorLine[]>({ required: true });

const { fmt, decimalPlacesOf } = useCurrencyFormat();

/**
 * Human label for a budget: its name with the GL in parentheses (e.g. "Utilities 2026 (5210)"),
 * so the requester picks a fund by name, not a raw GL code, while the GL stays visible. Falls
 * back to the GL alone when the budget has no name. Never shows amounts (invariant: the selector
 * exposes no balances).
 */
/** `code — name`, because the code is what the requester knows the budget by. */
function budgetLabel(b: { code: string; budgetName?: string }): string {
  return b.budgetName ? `${b.code} — ${b.budgetName}` : b.code;
}

// Options for the picker, labelled `code — name` so the requester recognises the code they
// already write on every row today.
const budgetOptions = computed(() =>
  props.budgets.map((b) => ({ id: b.id, label: budgetLabel(b) })),
);

// Budget affordances (fallback picker + resolved-budget chip) belong to budget-controlled
// types only; DOC_CREATE (canBudget) is implied by being in the wizard.
const showBudget = computed(() => props.requiresBudget && props.canBudget);

/**
 * EVERY budget-controlled line needs a budget named on it, item-backed or not.
 *
 * The editor used to auto-resolve one from the line's GL account — the type default's GL, or the
 * item's — and only ask when nothing matched. That cannot work any more: one account is charged by
 * several budgets, so the account has nothing to say about which of them this line means. Only the
 * requester knows, and they already write it on every row of the spreadsheet this replaces.
 */
function needsBudgetPick(l: EditorLine): boolean {
  return showBudget.value && !l.budgetId;
}

/** The GL account a chosen item maps to (read-only; the server resolves the same default). */
function glForItem(itemId?: string): string | undefined {
  return itemId ? props.items.find((i) => i.id === itemId)?.defaultGlAccount : undefined;
}

/** The chosen budget's label, for a line that has one. */
function chosenBudgetLabel(l: EditorLine): string | undefined {
  const b = props.budgets.find((x) => x.id === l.budgetId);
  return b ? budgetLabel(b) : undefined;
}

// InputNumber speaks number; bridge at the edge so the stored value stays a string.
function numOrNull(s: string): number | null {
  return s === '' || s == null ? null : Number(s);
}
function setNum(l: EditorLine, key: 'qty' | 'unitPrice', v: number | null) {
  l[key] = v == null ? '' : String(v);
}

// The requester picks the item, not the budget: once an item is chosen the server derives the
// GL and resolves the budget, so any explicitly-picked budgetId is dropped (it would be ignored
// server-side). Clearing the item re-exposes the fallback picker for a free-text line.
function onItemChange(l: EditorLine) {
  if (l.itemId) l.budgetId = undefined;
}

/** Highlight a card that fails validation so the problem is visible. */
function cardClass(l: EditorLine): string {
  return lineInvalid(l)
    ? 'border-red-300 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30'
    : 'border-surface-300 dark:border-surface-700';
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

    <!-- One card per line: labelled inputs in a responsive grid; no horizontal scroll. -->
    <div v-else class="flex flex-col gap-3">
      <div
        v-for="(line, i) in lines"
        :key="i"
        class="rounded-xl border p-4 transition-colors"
        :class="cardClass(line)"
      >
        <!-- Header: line number + remove action. -->
        <div class="mb-3 flex items-center justify-between">
          <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-200 px-2 text-xs font-semibold text-muted-color dark:bg-surface-700">
            {{ i + 1 }}
          </span>
          <Button icon="pi pi-trash" text severity="danger" size="small" :aria-label="$t('common.delete')" @click="removeLine(i)" />
        </div>

        <!-- Item (+ GL chip) and Description share the top row so neither stretches emptily. -->
        <div class="mb-3 grid grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-2">
          <div v-if="canMaster">
            <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label class="text-xs font-medium text-muted-color">
                {{ $t('documents.create.line.item') }}<span v-if="requiresItem" class="text-red-500"> *</span>
              </label>
              <div class="flex items-center gap-1">
                <!-- GL is derived from the item, shown read-only — the requester never types a GL. -->
                <span class="inline-flex items-center gap-1 rounded-md bg-surface-200 px-2 py-0.5 text-xs font-medium dark:bg-surface-700">
                  <span class="text-muted-color">{{ $t('documents.create.line.glAccount') }}</span>
                  <span :class="glForItem(line.itemId) ? 'text-color' : 'text-muted-color'">{{ glForItem(line.itemId) ?? $t('documents.create.none') }}</span>
                </span>
                <!-- The chosen budget, shown BESIDE the derived GL rather than in place of it.
                     They are two independent facts about the line — what kind of expense it is,
                     and whose money pays for it — and the screen must not imply that either one
                     determines the other. -->
                <span v-if="showBudget && line.itemId" class="inline-flex items-center gap-1 rounded-md bg-surface-200 px-2 py-0.5 text-xs font-medium dark:bg-surface-700">
                  <span class="text-muted-color">{{ $t('documents.create.line.budget') }}</span>
                  <span :class="chosenBudgetLabel(line) ? 'text-color' : 'text-muted-color'">{{ chosenBudgetLabel(line) ?? $t('documents.create.none') }}</span>
                </span>
              </div>
            </div>
            <Select
              v-model="line.itemId"
              :options="items"
              optionLabel="name"
              optionValue="id"
              :placeholder="$t('documents.create.line.itemPlaceholder')"
              :aria-required="requiresItem || undefined"
              :invalid="lineMissingItem(line, requiresItem)"
              showClear
              filter
              fluid
              @change="onItemChange(line)"
            />
            <!-- Mirror of the server requires_item rule (UX-only; server re-rejects at submit). -->
            <Message v-if="lineMissingItem(line, requiresItem)" severity="error" size="small" variant="simple" class="mt-1">
              {{ $t('documents.create.line.itemRequired') }}
            </Message>
          </div>

          <div :class="{ 'lg:col-span-2': !canMaster }">
            <label class="mb-1 block text-xs font-medium text-muted-color">{{ $t('documents.create.line.description') }}</label>
            <Textarea v-model="line.description"  rows="3" :maxlength="255" fluid class="resize-none" />
          </div>
        </div>

        <!-- Measures: qty / unit price / budget / VAT share one balanced row. -->
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          <div>
            <label class="mb-1 block text-xs font-medium text-muted-color">{{ $t('documents.create.line.qty') }}</label>
            <InputNumber
              :model-value="numOrNull(line.qty)"
              :min="0"
              :min-fraction-digits="0"
              :max-fraction-digits="3"
              :invalid="lineInvalid(line)"
              :aria-describedby="lineInvalid(line) ? `line-err-${i}` : undefined"
              fluid
              @update:model-value="(v) => setNum(line, 'qty', v as number | null)"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-muted-color">{{ $t('documents.create.line.unitPrice') }}</label>
            <InputNumber
              :model-value="numOrNull(line.unitPrice)"
              :min="0"
              :min-fraction-digits="decimalPlacesOf(currency)"
              :max-fraction-digits="decimalPlacesOf(currency)"
              :invalid="lineInvalid(line)"
              :aria-describedby="lineInvalid(line) ? `line-err-${i}` : undefined"
              fluid
              @update:model-value="(v) => setNum(line, 'unitPrice', v as number | null)"
            />
          </div>

          <!-- EVERY budget-controlled line, item-backed or not. The picker used to appear only
               on an item-less line because the account resolved the budget for the others; one
               account is charged by several budgets, so it cannot, and the requester names it. -->
          <div v-if="showBudget">
            <label class="mb-1 block text-xs font-medium text-muted-color">
              {{ $t('documents.create.line.budget') }}<span class="text-red-500"> *</span>
            </label>
            <Select
              v-model="line.budgetId"
              :options="budgetOptions"
              optionLabel="label"
              optionValue="id"
              :placeholder="$t('documents.create.line.budgetPlaceholder')"
              :invalid="needsBudgetPick(line)"
              showClear
              filter
              fluid
            />
            <!-- Mirror of the server's complete-budget-coverage rule, now for EVERY line. -->
            <Message v-if="needsBudgetPick(line)" severity="error" size="small" variant="simple" class="mt-1">
              {{ $t('documents.create.line.budgetRequired') }}
            </Message>
          </div>

          <!-- VAT: optional per-line tax code; the server computes the tax at submit. -->
          <div v-if="vatCodes.length">
            <label class="mb-1 block text-xs font-medium text-muted-color">{{ $t('documents.create.line.vat') }}</label>
            <Select
              v-model="line.taxCodeId"
              :options="vatCodes"
              optionLabel="code"
              optionValue="id"
              :placeholder="$t('documents.create.line.vatPlaceholder')"
              showClear
              fluid
            />
          </div>
        </div>

        <!-- Numeric-validity error, associated to the qty/price inputs via aria-describedby. -->
        <Message v-if="lineInvalid(line)" :id="`line-err-${i}`" severity="error" size="small" variant="simple" class="mt-2">
          {{ $t('documents.create.line.invalid') }}
        </Message>

        <!-- Amount: derived (qty × unitPrice via Decimal); read-only, emphasised. -->
        <div class="mt-4 flex items-baseline justify-end gap-2 border-t border-surface-200 pt-3 dark:border-surface-700">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-color">{{ $t('documents.create.line.amount') }}</span>
          <span class="text-xl font-bold text-primary">{{ fmt(lineAmount(line.qty, line.unitPrice), currency) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
