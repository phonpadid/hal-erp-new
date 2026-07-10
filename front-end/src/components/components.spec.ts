import { beforeAll, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Skeleton from 'primevue/skeleton';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Editor from 'primevue/editor';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import ProgressSpinner from 'primevue/progressspinner';
import AppDataTable from './AppDataTable.vue';
import { i18n } from '../i18n';
import PageToolbar from './PageToolbar.vue';
import EmptyState from './EmptyState.vue';
import ErrorState from './ErrorState.vue';
import TableSkeleton from './TableSkeleton.vue';
import DetailHeader from './DetailHeader.vue';
import SectionCard from './SectionCard.vue';
import FormStepper from './FormStepper.vue';
import EventTimeline from './EventTimeline.vue';
import { fieldComponent } from '../utils/formFields';
import FormDatePicker from './FormDatePicker.vue';

const global = { plugins: [i18n, PrimeVue] };

describe('PageToolbar', () => {
  it('emits update:search as the user types', async () => {
    const w = mount(PageToolbar, { props: { search: '' }, global });
    await w.find('input').setValue('budget');
    expect(w.emitted('update:search')?.at(-1)).toEqual(['budget']);
  });

  it('renders filters and actions slots', () => {
    const w = mount(PageToolbar, {
      props: { search: '' },
      slots: { filters: '<span class="f">F</span>', actions: '<button class="a">A</button>' },
      global,
    });
    expect(w.find('.f').exists()).toBe(true);
    expect(w.find('.a').exists()).toBe(true);
  });

  it('shows the bulk slot only when rows are selected', () => {
    const make = (selectionCount: number) =>
      mount(PageToolbar, { props: { search: '', selectionCount }, slots: { bulk: '<span class="b">B</span>' }, global });
    expect(make(0).find('.b').exists()).toBe(false);
    expect(make(2).find('.b').exists()).toBe(true);
  });
});

describe('EmptyState / ErrorState / TableSkeleton', () => {
  it('EmptyState renders title and message', () => {
    const w = mount(EmptyState, { props: { title: 'Nothing', message: 'Add one' }, global });
    expect(w.text()).toContain('Nothing');
    expect(w.text()).toContain('Add one');
  });

  it('ErrorState shows the message and emits retry', async () => {
    const w = mount(ErrorState, { props: { message: 'Boom' }, global });
    expect(w.text()).toContain('Boom');
    await w.findComponent({ name: 'Button' }).trigger('click');
    expect(w.emitted('retry')).toHaveLength(1);
  });

  it('TableSkeleton renders columns × rows skeletons', () => {
    const w = mount(TableSkeleton, { props: { columns: 3, rows: 2 }, global });
    expect(w.findAllComponents(Skeleton)).toHaveLength(6);
  });
});

describe('DetailHeader / SectionCard', () => {
  it('DetailHeader renders title and a status tag', () => {
    const w = mount(DetailHeader, { props: { title: 'PR-001', status: 'APPROVED', statusSeverity: 'success' }, global });
    expect(w.text()).toContain('PR-001');
    expect(w.text()).toContain('APPROVED');
  });

  it('SectionCard renders its title and default slot', () => {
    const w = mount(SectionCard, { props: { title: 'Details' }, slots: { default: '<p class="body">x</p>' }, global });
    expect(w.text()).toContain('Details');
    expect(w.find('.body').exists()).toBe(true);
  });
});

describe('FormStepper', () => {
  const steps = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];

  it('blocks advancing when the step is invalid and emits step-error', async () => {
    const w = mount(FormStepper, { props: { steps, validateStep: () => 'fill it in' }, global });
    await (w.vm as any).next();
    expect((w.vm as any).index).toBe(0);
    expect(w.emitted('step-error')?.at(-1)).toEqual(['fill it in', 'a']);
  });

  it('advances when the step is valid', async () => {
    const w = mount(FormStepper, { props: { steps, validateStep: () => true }, global });
    await (w.vm as any).next();
    expect((w.vm as any).index).toBe(1);
  });

  it('emits submit from the last step when valid', async () => {
    const w = mount(FormStepper, { props: { steps, validateStep: () => true }, global });
    await (w.vm as any).next();
    await (w.vm as any).next(); // already last; next() no-ops
    // on last step, the submit button drives finish()
    await w.findAllComponents({ name: 'Button' }).at(-1)!.trigger('click');
    expect(w.emitted('submit')).toHaveLength(1);
  });

  it('opens on the step named by initialStep', () => {
    const w = mount(FormStepper, { props: { steps, initialStep: 'b' }, global });
    expect((w.vm as any).index).toBe(1);
  });

  it('falls back to the first step when initialStep is absent or unknown', () => {
    const none = mount(FormStepper, { props: { steps }, global });
    expect((none.vm as any).index).toBe(0);
    const bad = mount(FormStepper, { props: { steps, initialStep: 'zzz' }, global });
    expect((bad.vm as any).index).toBe(0);
  });
});

describe('EventTimeline', () => {
  it('renders an empty state when there are no events', () => {
    const w = mount(EventTimeline, { props: { events: [] }, global });
    expect(w.findComponent(EmptyState).exists()).toBe(true);
  });

  it('renders the events when present', () => {
    const w = mount(EventTimeline, {
      props: { events: [{ title: 'Submitted', subtitle: 'Alice', at: 'today', severity: 'info' }] },
      global,
    });
    expect(w.findComponent(EmptyState).exists()).toBe(false);
    expect(w.text()).toContain('Submitted');
    expect(w.text()).toContain('Alice');
  });
});

describe('AppDataTable', () => {
  const tableGlobal = { plugins: [i18n, PrimeVue], components: { Column } };

  // PrimeVue's paginator rows-per-page Select calls matchMedia, absent in jsdom.
  beforeAll(() => {
    if (!(globalThis as any).matchMedia) {
      (globalThis as any).matchMedia = () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      });
    }
  });

  it('renders the row-number column and the caller rows', () => {
    const w = mount(AppDataTable, {
      props: { value: [{ id: 'a', name: 'Alpha' }], total: 1, page: 1, rows: 20 },
      slots: { default: '<Column field="name" header="Name" />' },
      global: tableGlobal,
    });
    expect(w.text()).toContain('Alpha');
    expect(w.text()).toContain('1'); // leading # row number
  });

  it('maps the paginator event to a 1-based { page, limit } emit', async () => {
    const w = mount(AppDataTable, {
      props: { value: [], total: 100, page: 1, rows: 20 },
      global: tableGlobal,
    });
    w.findComponent(DataTable).vm.$emit('page', { page: 2, rows: 50 });
    expect(w.emitted('page')?.at(-1)).toEqual([{ page: 3, limit: 50 }]);
  });

  it('shows a progress spinner while loading', () => {
    const w = mount(AppDataTable, {
      props: { value: [], total: 0, loading: true },
      global: tableGlobal,
    });
    expect(w.findComponent(ProgressSpinner).exists()).toBe(true);
  });
});

describe('fieldComponent', () => {
  it('maps each field type to the expected control', () => {
    expect(fieldComponent('string').component).toBe(InputText);
    expect(fieldComponent('text').component).toBe(Editor);
    expect(fieldComponent('number').component).toBe(InputText);
    expect(fieldComponent('number').props).toMatchObject({ type: 'number' });
    expect(fieldComponent('date').component).toBe(FormDatePicker);
    expect(fieldComponent('textarea').component).toBe(Textarea);
    expect(fieldComponent('long_text').component).toBe(Textarea);
    expect(fieldComponent('richtext').component).toBe(Editor);
    expect(fieldComponent('html').component).toBe(Editor);
    expect(fieldComponent(undefined).component).toBe(InputText);
  });
});
