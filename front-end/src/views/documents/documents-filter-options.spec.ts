import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import MyDocumentsView from './MyDocumentsView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/**
 * The type and vendor filters used to render PrimeVue's own `No available options` over a list
 * of twenty documents — an English sentence in a Lao UI, stating as a fact about the data what
 * was really a failed read. A control has to tell those two apart.
 */
/** The filter panel lives in a Popover, which renders nothing until it is opened. */
async function openFilters(w: VueWrapper): Promise<HTMLElement> {
  const toggle = w
    .findAll('button')
    .find((b) => b.text().includes('ຕົວກອງ'));
  if (!toggle) throw new Error('filter toggle not found');
  await toggle.trigger('click');
  await flushPromises();
  return document.body;
}

async function mount(state: Record<string, unknown>, permissions = ['DOC_VIEW', 'MASTER_VIEW']) {
  const w = await mountView(MyDocumentsView, {
    path: '/documents',
    routeName: 'documents',
    permissions,
    initialState: {
      documents: { list: [], total: 0, page: 1, limit: 20, filters: {}, loading: false, error: '' },
      masterData: { vendors: [], vendorsStatus: 'loaded', loading: false, error: '' },
      // `mountView` spreads initialState over its own auth defaults, so an auth override has to
      // carry `permissions` too or it silently un-grants everything the mount just granted.
      auth: { permissions, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      ...state,
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const withTypeOptions = (status: string, items: unknown[] = []) => ({
  documents: {
    list: [], total: 0, page: 1, limit: 20, filters: {}, loading: false, error: '',
    typeOptions: { status, items },
  },
});

describe('documents list filter options', () => {
  it('says the choices could not be read when the type option read failed', async () => {
    const panel = await openFilters(await mount(withTypeOptions('failed')));
    expect(panel.querySelector('[data-testid="type-options-failed"]')).not.toBeNull();
  });

  it('says nothing of the kind when the type options loaded and are simply empty', async () => {
    const panel = await openFilters(await mount(withTypeOptions('loaded')));
    expect(panel.querySelector('[data-testid="type-options-failed"]')).toBeNull();
  });

  it('says nothing of the kind when the type options loaded with rows', async () => {
    const w = await mount(withTypeOptions('loaded', [{ id: 't1', code: 'PR', name: 'ໃບຂໍຊື້' }]));
    const panel = await openFilters(w);
    expect(panel.querySelector('[data-testid="type-options-failed"]')).toBeNull();
  });

  it('says the choices could not be read when the vendor read failed', async () => {
    const w = await mount({
      ...withTypeOptions('loaded'),
      masterData: { vendors: [], vendorsStatus: 'failed', loading: false, error: 'boom' },
    });
    const panel = await openFilters(w);
    expect(panel.querySelector('[data-testid="vendor-options-failed"]')).not.toBeNull();
  });

  it('offers the type filter to a reader who may not create documents', async () => {
    // DOC_VIEW only — no DOC_CREATE. This reviewer used to get no type filter at all.
    const w = await mount(
      withTypeOptions('loaded', [{ id: 't1', code: 'PR', name: 'ໃບຂໍຊື້' }]),
      ['DOC_VIEW'],
    );
    const panel = await openFilters(w);
    expect(panel.textContent).toContain('ປະເພດເອກະສານ');
  });
});
