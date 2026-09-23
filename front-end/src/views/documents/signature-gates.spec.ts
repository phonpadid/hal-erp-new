import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import MyDocumentsView from './MyDocumentsView.vue';
import DocumentDetailView from './DocumentDetailView.vue';
import { useAuthStore } from '../../stores/auth';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
});

/**
 * Submitting and approving stamp a signature, so a person with none on file cannot do either.
 * The server refuses with SIGNATURE_REQUIRED; these views disable the buttons ahead of time, say
 * why, and point at the profile page. Reject / Return stamp nothing and stay open; so does saving
 * a draft. `hasSignature` comes from /auth/me and is flipped by the profile page's upload — the
 * button must follow the store, not the page load.
 */
const PROFILE = [{ path: '/profile', name: 'profile' }];
const LIST_STATE = {
  list: [], total: 0, page: 1, limit: 20, filters: {},
  typeOptions: { status: 'loaded', items: [] }, loading: false, error: '',
};

async function mountList(hasSignature: boolean) {
  const perms = ['DOC_VIEW', 'DOC_CREATE'];
  const w = await mountView(MyDocumentsView, {
    path: '/documents',
    routeName: 'documents',
    permissions: perms,
    extraRoutes: PROFILE,
    initialState: {
      documents: LIST_STATE,
      masterData: { vendors: [], vendorsStatus: 'loaded', loading: false, error: '' },
      auth: { permissions: perms, hasSignature, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

async function mountDetail(over: {
  hasSignature: boolean;
  status: string;
  canAct?: boolean;
  canActReason?: 'SIGNATURE_REQUIRED' | null;
}) {
  const perms = ['DOC_VIEW', 'DOC_SUBMIT', 'DOC_APPROVE'];
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: perms,
    extraRoutes: PROFILE,
    initialState: {
      documents: {
        // Created by somebody else, so the signed-in `user-1` is not blocked as the creator.
        current: { id: 'doc-1', docNo: 'D-1', status: over.status, createdBy: { id: 'user-9' } },
        fieldValues: [], lines: [], attachments: [], refDocument: null, approvalLog: [],
        canAct: over.canAct ?? false, canActReason: over.canActReason ?? null,
        sla: null, pendingApprovers: null, matching: null, loading: false, error: '',
      },
      auth: { permissions: perms, hasSignature: over.hasSignature, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const disabled = (w: VueWrapper, sel: string) => (w.find(sel).element as HTMLButtonElement).disabled;

describe('documents list — New document waits for a signature', () => {
  it('disables New document and says where to upload when no signature is on file', async () => {
    const w = await mountList(false);
    expect(disabled(w, '[data-testid="new-document"]')).toBe(true);
    expect(w.find('[data-testid="signature-required"]').exists()).toBe(true);
    expect(w.find('[data-testid="signature-required-link"]').exists()).toBe(true);
  });

  it('enables New document and shows no notice when a signature is on file', async () => {
    const w = await mountList(true);
    expect(disabled(w, '[data-testid="new-document"]')).toBe(false);
    expect(w.find('[data-testid="signature-required"]').exists()).toBe(false);
  });

  it('comes alive the moment the profile page reports an upload — no reload', async () => {
    const w = await mountList(false);
    expect(disabled(w, '[data-testid="new-document"]')).toBe(true);
    useAuthStore().hasSignature = true; // what setHasSignature(true) does after an upload
    await flushPromises();
    expect(disabled(w, '[data-testid="new-document"]')).toBe(false);
    expect(w.find('[data-testid="signature-required"]').exists()).toBe(false);
  });
});

describe('document detail — Submit and Approve wait for a signature', () => {
  it('disables Submit on a draft when no signature is on file', async () => {
    const w = await mountDetail({ hasSignature: false, status: 'DRAFT' });
    expect(disabled(w, '[data-testid="submit-btn"]')).toBe(true);
    expect(w.find('[data-testid="signature-required"]').exists()).toBe(true);
  });

  it('leaves Submit enabled when a signature is on file', async () => {
    const w = await mountDetail({ hasSignature: true, status: 'DRAFT' });
    expect(disabled(w, '[data-testid="submit-btn"]')).toBe(false);
    expect(w.find('[data-testid="signature-required"]').exists()).toBe(false);
  });

  it('disables Approve alone when the session has no signature; Reject and Return stay open', async () => {
    const w = await mountDetail({ hasSignature: false, status: 'IN_APPROVAL', canAct: true });
    expect(disabled(w, '[data-testid="approve-btn"]')).toBe(true);
    expect(disabled(w, '[data-testid="reject-btn"]')).toBe(false);
    expect(disabled(w, '[data-testid="return-btn"]')).toBe(false);
    // The approve wording is the one that names the way out — rejecting or returning stays theirs.
    expect(w.find('[data-testid="signature-required"]').text()).not.toBe('');
  });

  it('disables Approve when the server says SIGNATURE_REQUIRED, whatever the session believes', async () => {
    const w = await mountDetail({
      hasSignature: true, status: 'IN_APPROVAL', canAct: true, canActReason: 'SIGNATURE_REQUIRED',
    });
    expect(disabled(w, '[data-testid="approve-btn"]')).toBe(true);
    expect(w.find('[data-testid="signature-required"]').exists()).toBe(true);
  });

  it('leaves Approve enabled for an eligible approver with a signature', async () => {
    const w = await mountDetail({ hasSignature: true, status: 'IN_APPROVAL', canAct: true });
    expect(disabled(w, '[data-testid="approve-btn"]')).toBe(false);
    expect(w.find('[data-testid="signature-required"]').exists()).toBe(false);
  });
});
