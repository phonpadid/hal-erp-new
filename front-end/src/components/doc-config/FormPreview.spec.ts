import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import DatePicker from 'primevue/datepicker';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { describe, expect, it } from 'vitest';
import { i18n } from '../../i18n';
import type { FormFieldRow } from '../../api/docConfig';
import FormPreview from './FormPreview.vue';

const global = { plugins: [i18n, PrimeVue] };

function field(over: Partial<FormFieldRow>): FormFieldRow {
  return { id: over.id ?? 'x', fieldName: 'f', fieldLabel: 'F', fieldType: 'text', isRequired: false, sortOrder: 0, ...over };
}

describe('FormPreview', () => {
  it('maps each field type to its representative control', () => {
    const w = mount(FormPreview, {
      props: {
        fields: [
          field({ id: '1', fieldType: 'text' }),
          field({ id: '2', fieldType: 'number' }),
          field({ id: '3', fieldType: 'date' }),
          field({ id: '4', fieldType: 'dropdown', optionsJson: '["A","B"]' }),
        ],
      },
      global,
    });
    expect(w.findComponent(InputText).exists()).toBe(true);
    expect(w.findComponent(InputNumber).exists()).toBe(true);
    expect(w.findComponent(DatePicker).exists()).toBe(true);
    const select = w.findComponent(Select);
    expect(select.exists()).toBe(true);
    // Dropdown choices come straight from options_json.
    expect(select.props('options')).toEqual(['A', 'B']);
  });

  it('renders file and line-items placeholders', () => {
    const w = mount(FormPreview, {
      props: { fields: [field({ id: '1', fieldType: 'file' }), field({ id: '2', fieldType: 'line_items' })] },
      global,
    });
    // File → the uploader's empty-state cloud-upload icon; line_items → a header row with an amount column.
    expect(w.find('.pi-cloud-upload').exists()).toBe(true);
    expect(w.text()).toContain(i18n.global.t('common.amount'));
  });

  it('shows a required marker and flags conditional fields', () => {
    const w = mount(FormPreview, {
      props: {
        fields: [
          field({ id: '1', fieldLabel: 'Amount', isRequired: true }),
          field({ id: '2', fieldLabel: 'Reason', conditionJson: '{"field":"amount","op":"notEmpty"}' }),
        ],
      },
      global,
    });
    // Required marker asterisk is present.
    expect(w.text()).toContain('*');
    // The conditional field carries a "Conditional" tag; the plain required one does not.
    const tags = w.findAllComponents(Tag);
    expect(tags.some((tag) => tag.text() === i18n.global.t('admin.docConfig.conditional'))).toBe(true);
    expect(tags).toHaveLength(1);
  });

  it('degrades a malformed options_json to an empty option list', () => {
    const w = mount(FormPreview, {
      props: { fields: [field({ id: '1', fieldType: 'dropdown', optionsJson: 'not json' })] },
      global,
    });
    expect(w.findComponent(Select).props('options')).toEqual([]);
  });
});
