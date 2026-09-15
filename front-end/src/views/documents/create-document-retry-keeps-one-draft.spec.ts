import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useRouter } from 'vue-router';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import CreateDocumentView from './CreateDocumentView.vue';
import { useDocumentsStore } from '../../stores/documents';

/**
 * One press, one draft — however many presses follow.
 *
 * The create screen used to make a fresh draft on EVERY press of Save or Save & submit, because
 * nothing on it remembered that an earlier press had already succeeded at creating. Anything that
 * failed after the create (the file upload, the submit, the trip to the detail page) left the
 * user on this screen looking at an error, and the natural reaction — press again — created
 * another empty draft, number spent, each time. The dozens of blank drafts under one requester
 * were this.
 *
 * Three rules now, each asserted below:
 *   1. a failure after the draft exists hands over to the EDIT screen for that draft, with the
 *      reason on the route, so the URL says the document is made — which survives a reload;
 *   2. once the create screen has made its draft, its buttons stay disabled — every path from
 *      there leaves the screen, and the gap is where the second press used to land;
 *   3. the success path is untouched: save, then the detail page.
 * The store side of the same bug — three requests where one atomic one would do — is covered in
 * `stores/documents.spec.ts`.
 */
const { TYPES } = vi.hoisted(() => ({
  TYPES: [
    { id: 't-memo', code: 'MEMO', name: 'Memo', category: 'ADMIN', requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false },
  ],
}));

vi.mock('../../api/documents', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    documentsApi: {
      ...(actual.documentsApi as object),
      creatableTypes: vi.fn(() => Promise.resolve(TYPES)),
      formForType: vi.fn(() =>
        Promise.resolve({ documentTypeId: 't-memo', formTemplateId: 'tmpl', version: 1, fields: [] }),
      ),
    },
    uploadAttachment: vi.fn(),
  };
});

vi.mock('../../api/currency', () => ({
  currencyApi: { rates: { resolve: vi.fn(() => Promise.resolve({ rate: '1' })) } },
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

type Vm = { save: (submit: boolean) => Promise<void> };
type Spy = ReturnType<typeof vi.fn>;

/**
 * The wizard in create mode with a type chosen. Which named routes exist decides what fails:
 * `document-detail` absent makes the post-save navigation reject — the "something failed after
 * the create" the screen has to survive, and the simplest one to stage since it needs no network.
 */
async function mountWizardOnMemo(routes: { detail?: boolean; edit?: boolean } = {}) {
  const w = await mountView(CreateDocumentView, {
    path: '/documents/new',
    routeName: 'document-create',
    permissions: ['DOC_SUBMIT', 'DOC_CREATE'],
    // What the (stubbed) detail load would put in the store once the edit route reloads the draft.
    // Create mode reads none of it, so it is inert until the hand-over.
    initialState: {
      documents: { current: { id: 'd-first', documentType: { id: 't-memo' }, status: 'DRAFT' }, fieldValues: [], lines: [], attachments: [] },
    },
    extraRoutes: [
      ...(routes.detail ? [{ path: '/documents/:id', name: 'document-detail' }] : []),
      ...(routes.edit ? [{ path: '/documents/:id/edit', name: 'document-edit' }] : []),
    ],
  });
  await flushPromises();
  await w.findAll('[role="radio"]')[0].trigger('click');
  await flushPromises();
  return w;
}

/** Walk an empty memo to the review step, where the two buttons live. */
async function goToReview(w: Awaited<ReturnType<typeof mountWizardOnMemo>>) {
  for (let i = 0; i < 5; i++) {
    const btn = w.findAll('button').find((b) => b.text().trim() === 'Next');
    if (!btn) break;
    await btn.trigger('click');
    await flushPromises();
  }
}

const isDisabled = (w: Awaited<ReturnType<typeof mountWizardOnMemo>>, testId: string) =>
  (w.find(`[data-testid="${testId}"]`).element as HTMLButtonElement).disabled;

describe('a save that created the draft and then failed', () => {
  it('hands over to the edit screen for that draft, reason on the route, and loads it', async () => {
    const w = await mountWizardOnMemo({ edit: true });
    const docs = useDocumentsStore();
    (docs.createDraft as Spy).mockResolvedValue('d-first');
    const router = (w.vm as unknown as { $router: ReturnType<typeof useRouter> }).$router;

    await (w.vm as unknown as Vm).save(false);
    await flushPromises();

    expect(docs.createDraft).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe('document-edit');
    expect(router.currentRoute.value.params.id).toBe('d-first');
    expect(typeof router.currentRoute.value.query.saveFailed).toBe('string');
    // Same component instance across the two routes, so this is the reload the watcher owes.
    expect(docs.loadDetail).toHaveBeenCalledWith('d-first');
    expect(w.find('[data-testid="saved-but-failed"]').exists()).toBe(true);
  });

  it('saves into that draft on the next press, never creating another', async () => {
    const w = await mountWizardOnMemo({ edit: true });
    const docs = useDocumentsStore();
    (docs.createDraft as Spy).mockResolvedValue('d-first');
    (docs.saveDraft as Spy).mockResolvedValue(true);
    const vm = w.vm as unknown as Vm;

    await vm.save(false);
    await flushPromises();
    await vm.save(false);
    await flushPromises();
    await vm.save(true);
    await flushPromises();

    expect(docs.createDraft).toHaveBeenCalledTimes(1);
    expect(docs.saveDraft).toHaveBeenCalledTimes(2);
    for (const call of (docs.saveDraft as Spy).mock.calls) expect(call[0]).toBe('d-first');
    expect((docs.submit as Spy).mock.calls[0][0]).toBe('d-first');
  });

  it('still saves into that draft when even the hand-over could not happen', async () => {
    // No edit route to go to (the same navigation failure that stranded the user in the first
    // place). The in-memory id is the fallback, and it must be enough on its own.
    const w = await mountWizardOnMemo();
    const docs = useDocumentsStore();
    (docs.createDraft as Spy).mockResolvedValue('d-first');
    (docs.saveDraft as Spy).mockResolvedValue(true);
    const vm = w.vm as unknown as Vm;

    await vm.save(false);
    await flushPromises();
    await vm.save(false);
    await flushPromises();

    expect(docs.createDraft).toHaveBeenCalledTimes(1);
    expect((docs.saveDraft as Spy).mock.calls[0][0]).toBe('d-first');
  });

  it('leaves the create screen’s buttons disabled once its draft exists', async () => {
    const w = await mountWizardOnMemo();
    const docs = useDocumentsStore();
    (docs.createDraft as Spy).mockResolvedValue('d-first');
    await goToReview(w);
    expect(isDisabled(w, 'save-draft')).toBe(false);

    await w.find('[data-testid="save-draft"]').trigger('click');
    await flushPromises();

    // The press created; the navigation failed; the user is still here — and cannot press again.
    expect(docs.createDraft).toHaveBeenCalledTimes(1);
    expect(isDisabled(w, 'save-draft')).toBe(true);
    expect(isDisabled(w, 'save-submit')).toBe(true);
  });

  it('re-enables them on the edit screen, where a retry is the point', async () => {
    const w = await mountWizardOnMemo({ edit: true });
    const docs = useDocumentsStore();
    (docs.createDraft as Spy).mockResolvedValue('d-first');
    await goToReview(w);

    await w.find('[data-testid="save-draft"]').trigger('click');
    await flushPromises();

    expect(isDisabled(w, 'save-draft')).toBe(false);
  });
});

describe('a refused create', () => {
  it('leaves nothing to hand over to: the next press creates again', async () => {
    // A refused create is no draft (the server applies header, fields and lines atomically), so
    // the screen stays, the buttons work, and the next press tries the create again.
    const w = await mountWizardOnMemo({ edit: true, detail: true });
    const docs = useDocumentsStore();
    (docs.createDraft as Spy).mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce('d-second-try');
    const router = (w.vm as unknown as { $router: ReturnType<typeof useRouter> }).$router;
    await goToReview(w);

    await w.find('[data-testid="save-draft"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('document-create');
    expect(isDisabled(w, 'save-draft')).toBe(false);

    await w.find('[data-testid="save-draft"]').trigger('click');
    await flushPromises();
    expect(docs.createDraft).toHaveBeenCalledTimes(2);
    expect(docs.saveDraft).not.toHaveBeenCalled();
  });
});

describe('a save that succeeded', () => {
  it('goes to the detail page exactly as before', async () => {
    const w = await mountWizardOnMemo({ edit: true, detail: true });
    const docs = useDocumentsStore();
    (docs.createDraft as Spy).mockResolvedValue('d-ok');
    const router = (w.vm as unknown as { $router: ReturnType<typeof useRouter> }).$router;

    await (w.vm as unknown as Vm).save(false);
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('document-detail');
    expect(router.currentRoute.value.params.id).toBe('d-ok');
    expect(router.currentRoute.value.query.saveFailed).toBeUndefined();
  });
});
