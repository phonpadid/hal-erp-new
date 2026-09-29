import { Form } from '@primevue/forms';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { i18n } from '../../i18n';
import DocTypeFormFields from './DocTypeFormFields.vue';

const global = { plugins: [createTestingPinia({ createSpy: vi.fn }), i18n, PrimeVue] };

const CATEGORIES = [{ label: 'Admin', value: 'ADMIN' }];
const POST_ACTIONS = [{ label: 'None', value: 'NONE' }];
const PRINT_TEMPLATES = [
  { label: 'Official letter', value: 'LETTER' },
  { label: 'Purchase request', value: 'PR' },
];
const ACCOUNTS = [{ label: '5210 — Supplies', value: '5210' }];

// The field set only works inside a Form (FormField reads the form context), so mount it in one.
function mountFields(props: Record<string, unknown>) {
  return mount(Form, {
    props: { initialValues: { code: '', name: '', category: 'ADMIN', postAction: null, defaultGlAccount: null } },
    slots: {
      default: () =>
        h(DocTypeFormFields, { postActions: POST_ACTIONS, printTemplates: PRINT_TEMPLATES, accountOptions: ACCOUNTS, ...props } as never),
    },
    global,
  });
}

const FLAGS = ['requiresBudget', 'requiresQuota', 'requiresVendor', 'requiresItem', 'requiresPayee'];

describe('DocTypeFormFields', () => {
  it('binds every label to its control, so clicking the text hits the input', () => {
    const w = mountFields({ mode: 'create', categories: CATEGORIES });
    const labels = w.findAll('label');
    // code, name, shortName, category, postAction, matchMode, receivesGoods, printTemplates, GL,
    // viewPermissionCode (who may read the type), the five requester flags, recordsPastEvents and
    // accruesOnApproval — labelled and bound like the rest but not in FLAGS: they decide what the
    // DOCUMENT may carry and when its expense is booked, not what the requester must supply.
    expect(labels).toHaveLength(17);
    // A label whose `for` matches no id in the dialog is a label that does nothing.
    for (const label of labels) {
      const target = label.attributes('for');
      expect(target).toBeTruthy();
      expect(w.find(`#${target}`).exists()).toBe(true);
    }
  });

  it('renders every requester-facing flag with an explanation, not just a label', () => {
    const w = mountFields({ mode: 'create', categories: CATEGORIES });
    for (const flag of FLAGS) {
      const label = w.find(`label[for="dt-${flag}"]`);
      expect(label.exists()).toBe(true);
      // The hint sits next to the label inside the same field wrapper.
      expect(label.element.parentElement?.textContent).toContain(i18n.global.t(`admin.docConfig.fields.${flag}Hint`));
    }
  });

  it('marks the required fields', () => {
    const w = mountFields({ mode: 'create', categories: CATEGORIES });
    for (const id of ['dt-code', 'dt-name', 'dt-category']) {
      expect(w.find(`label[for="${id}"]`).text()).toContain('*');
    }
  });

  // Regression: with no active category, `category` can never satisfy the schema, so submit
  // failed with nothing on screen explaining why.
  it('warns on the category field when the company has no active category', () => {
    const w = mountFields({ mode: 'create', categories: [] });
    expect(w.find('[data-testid="no-categories"]').exists()).toBe(true);
  });

  it('does not warn when categories exist', () => {
    const w = mountFields({ mode: 'create', categories: CATEGORIES });
    expect(w.find('[data-testid="no-categories"]').exists()).toBe(false);
  });

  it('hides code and category in edit mode (both immutable after creation)', () => {
    const w = mountFields({ mode: 'edit' });
    expect(w.find('#dt-code').exists()).toBe(false);
    expect(w.find('label[for="dt-category"]').exists()).toBe(false);
    expect(w.find('#dt-name').exists()).toBe(true);
    // The flags stay editable after creation.
    for (const flag of FLAGS) expect(w.find(`label[for="dt-${flag}"]`).exists()).toBe(true);
  });
});
