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
import { useI18n } from 'vue-i18n';
import Message from 'primevue/message';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { lineAmount, lineInvalid, lineMissingItem, unavailableValue } from '../../utils/form';
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
    budgets: Array<{ id: string; code: string; budgetName?: string; parentId?: string; parentCode?: string; parentName?: string }>;
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
    // Whether `items` and `budgets` have finished loading. Only then can a value they do not
    // contain be called gone rather than not-yet-arrived.
    optionsReady?: boolean;
  }>(),
  { requiresBudget: false, requiresItem: false, vatCodes: () => [], optionsReady: false },
);

const lines = defineModel<EditorLine[]>({ required: true });

const { fmt, decimalPlacesOf } = useCurrencyFormat();
// Group headings are built in script, so the catalog is needed here and not only in the template.
const { t } = useI18n();

/**
 * `code — name`, because the code is what the requester knows the budget by. Never shows amounts:
 * this picker is fed by a `DOC_CREATE` read that carries no balance, so a requester who may not
 * read budget figures can still raise a document.
 */
function budgetLabel(b: { code: string; budgetName?: string }): string {
  return b.budgetName ? `${b.code} — ${b.budgetName}` : b.code;
}

/**
 * Options GROUPED by the category each budget's node hangs under.
 *
 * A department's budgets are a tree and the leaves are named as if the branch were visible. The
 * customer's largest department offers 92 of them, including six reading `ງົບເດີນທາງ ພນ ບໍລິຫານ`,
 * `… ພນ ບຸກຄະລາກອນ`, `… ພນ ມາດຕະຖານ` — one word apart, meaningless in isolation. Under their
 * category, `ເງິນເດີນທາງ ໄປວຽກຕ່າງແຂວງ`, they are six departments' travel budgets and the choice is
 * obvious.
 *
 * The category is the only thing that distinguishes them, and it is NOT the balance: showing how
 * much is left would either leak figures to a requester without `BUDGET_VIEW` or take this picker
 * away from them. A category name is a label, so it crosses that line cleanly.
 *
 * Order follows parent code then child code, so a requester who does know the codes still finds
 * them where they expect. Budgets whose node has no parent land in one labelled group at the end
 * rather than being scattered or dropped — omitting a selectable budget would make a line
 * unbudgetable through the UI while the server still accepts it.
 */
const UNGROUPED = '\u0000ungrouped';
const budgetGroups = computed(() => {
  const groups = new Map<string, { key: string; label: string; sort: string; items: Array<{ id: string; label: string; group: string }> }>();
  for (const b of props.budgets) {
    const key = b.parentId ?? UNGROUPED;
    const label =
      key === UNGROUPED
        ? t('documents.create.line.budgetUngrouped')
        : b.parentName
          ? `${b.parentCode ?? ''} — ${b.parentName}`.replace(/^ — /, '')
          : (b.parentCode ?? t('documents.create.line.budgetUngrouped'));
    let group = groups.get(key);
    if (!group) {
      // Ungrouped sorts last: '\uffff' after every real code.
      group = { key, label, sort: key === UNGROUPED ? '\uffff' : (b.parentCode ?? '\uffff'), items: [] };
      groups.set(key, group);
    }
    group.items.push({ id: b.id, label: budgetLabel(b), group: label });
  }
  for (const g of groups.values()) g.items.sort((a, z) => a.label.localeCompare(z.label));
  return [...groups.values()].sort((a, z) => a.sort.localeCompare(z.sort));
});


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
  return showBudget.value && (!l.budgetId || budgetLost(l));
}

/**
 * A line reopened naming a budget or an item this picker cannot offer back.
 *
 * The picker would render its placeholder and stay valid, so the line would look untouched and
 * would keep carrying the stale id all the way to a submit refusal. Said out loud instead, and
 * counted as missing so the step gate stops here rather than there.
 */
const budgetIds = computed(() => props.budgets.map((b) => b.id));
const itemIds = computed(() => props.items.map((i) => i.id));
function budgetLost(l: EditorLine): boolean {
  return showBudget.value && unavailableValue(l.budgetId, budgetIds.value, props.optionsReady);
}
function itemLost(l: EditorLine): boolean {
  return props.canMaster && unavailableValue(l.itemId, itemIds.value, props.optionsReady);
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
              :invalid="lineMissingItem(line, requiresItem) || itemLost(line)"
              showClear
              filter
              fluid
              @change="onItemChange(line)"
            />
            <!-- Mirror of the server requires_item rule (UX-only; server re-rejects at submit).
                 The withdrawn-item case is said first: it is the one the user cannot deduce from
                 an empty control. -->
            <Message v-if="itemLost(line)" severity="error" size="small" variant="simple" class="mt-1">
              {{ $t('documents.create.line.itemUnavailable') }}
            </Message>
            <Message v-else-if="lineMissingItem(line, requiresItem)" severity="error" size="small" variant="simple" class="mt-1">
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
            <!-- Grouped by category: 92 flat options in the customer's largest department become
                 ~13 headings a requester reads before choosing. `filterFields` includes the
                 heading, so typing a category narrows to its members; `filterPlaceholder` is what
                 makes the box discoverable at all — it worked before and looked like decoration. -->
            <Select
              v-model="line.budgetId"
              :options="budgetGroups"
              optionGroupLabel="label"
              optionGroupChildren="items"
              optionLabel="label"
              optionValue="id"
              :placeholder="$t('documents.create.line.budgetPlaceholder')"
              :filterPlaceholder="$t('documents.create.line.budgetFilterPlaceholder')"
              :filterFields="['label', 'group']"
              :invalid="needsBudgetPick(line)"
              showClear
              filter
              fluid
            />
            <!-- Mirror of the server's complete-budget-coverage rule, now for EVERY line. A
                 budget closed since the draft was saved says so, rather than reading as a budget
                 the requester never chose. -->
            <Message v-if="budgetLost(line)" severity="error" size="small" variant="simple" class="mt-1">
              {{ $t('documents.create.line.budgetUnavailable') }}
            </Message>
            <Message v-else-if="needsBudgetPick(line)" severity="error" size="small" variant="simple" class="mt-1">
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
