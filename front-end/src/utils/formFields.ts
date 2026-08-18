import type { Component } from 'vue';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Editor from 'primevue/editor';
import Select from 'primevue/select';
import FormDatePicker from '../components/FormDatePicker.vue';

/**
 * Resolve the input control for a dynamic (configuration-driven) form field from its
 * type, so the form renders the right control instead of a single generic text box
 * (configuration over code). `string` gets a single-line InputText; long text gets an
 * auto-growing Textarea; `text` and rich text get the PrimeVue Editor; numbers get a typed
 * InputText; dates get a PrimeVue DatePicker (wrapped so the bound value stays an ISO
 * string); dropdown gets a Select fed from the field's `optionsJson`.
 *
 * `file` and `line_items` have no inline control — they are captured by dedicated UI
 * (attachment uploader / line-item table), so `component` is null and the view renders
 * that special affordance instead.
 *
 * The bound value stays a string: Textarea/InputText/Select bind plain text, Editor binds
 * an HTML string — both fit the existing document field-value payload.
 */
export interface FieldControl {
  component: Component | null;
  props: Record<string, unknown>;
  /** True when the control stores an HTML string (the rich Editor) — render with sanitized v-html. */
  html?: boolean;
}

export interface SelectOption {
  label: string;
  value: string;
}

/**
 * Parse a dropdown field's `optionsJson` into Select options. Accepts either a JSON array
 * of strings (`["A","B"]`) or of `{label,value}` objects. Returns [] on any malformed input.
 */
export function parseOptions(optionsJson?: string | null): SelectOption[] {
  if (!optionsJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(optionsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((o) =>
      typeof o === 'string'
        ? { label: o, value: o }
        : o && typeof o === 'object' && 'value' in o
          ? { label: String((o as any).label ?? (o as any).value), value: String((o as any).value) }
          : null,
    )
    .filter((o): o is SelectOption => o !== null);
}

export function fieldComponent(fieldType: string | undefined, optionsJson?: string | null): FieldControl {
  switch ((fieldType ?? '').toLowerCase()) {
    case 'string':
      // Single-line plain text (the value stays a plain string, no HTML).
      return { component: InputText, props: { type: 'text', class: 'w-full' } };
    case 'number':
      return { component: InputText, props: { type: 'number', class: 'w-full' } };
    case 'date':
      // PrimeVue DatePicker via a string-valued wrapper, so the field value stays the ISO
      // `yyyy-mm-dd` string the rest of the form (payload/review) expects.
      return { component: FormDatePicker, props: {} };
    case 'dropdown':
      return {
        component: Select,
        props: {
          options: parseOptions(optionsJson),
          optionLabel: 'label',
          optionValue: 'value',
          filter: true,
          showClear: true,
          class: 'w-full',
        },
      };
    case 'file':
    case 'line_items':
      // Captured by dedicated UI in the view, not an inline value control.
      return { component: null, props: {} };
    case 'textarea':
    case 'long_text':
    case 'longtext':
      return { component: Textarea, props: { autoResize: true, rows: 3, class: 'w-full' } };
    case 'richtext':
    case 'rich_text':
    case 'html':
    case 'text':
      // These are the rich-text types, and `HTML_FIELD_TYPES` in @erp/shared is the same list —
      // the server refuses markup in any type outside it. Keep the two in step: a type that draws
      // this editor but is not in that list would store HTML the server then rejects.
      return { component: Editor, props: { editorStyle: 'height: 220px', class: 'w-full' }, html: true };
    default:
      return { component: InputText, props: { type: 'text', class: 'w-full' } };
  }
}
