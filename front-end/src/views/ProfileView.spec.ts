import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../test/mountView';
import ProfileView from './ProfileView.vue';

// The view calls the profile API directly (not a store), so mock the module. The embedded
// SignaturePanel also imports from here, so provide its exports too (signature load is stubbed).
vi.mock('../api/profile', () => ({
  profileApi: { get: vi.fn(), changePassword: vi.fn() },
  signatureApi: { get: vi.fn().mockResolvedValue({ hasSignature: false, signature: null }), presignUpload: vi.fn(), register: vi.fn() },
  uploadSignature: vi.fn(),
  removeSignatureBackground: vi.fn(),
  uploadUserProfileImage: vi.fn(),
  SIGNATURE_ACCEPT: ['image/png', 'image/jpeg'],
  SIGNATURE_MAX_KB: 1024,
}));
import { profileApi } from '../api/profile';

const mockApi = profileApi as unknown as {
  get: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
};

const PROFILE = {
  username: 'alice',
  email: 'alice@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  status: 'ACTIVE',
  employee: { fullName: 'Alice Example', position: 'Analyst', departmentName: 'Finance' },
  roles: ['Approver'],
  permissions: [{ code: 'DOC_APPROVE', scope: 'DEPARTMENT' }],
  profileImageUrl: null,
};

/** Fill the three password fields by their input ids. */
async function fill(w: Awaited<ReturnType<typeof mountView>>, cur: string, next: string, confirm: string) {
  await w.find('#currentPassword').setValue(cur);
  await w.find('#newPassword').setValue(next);
  await w.find('#confirmPassword').setValue(confirm);
}

async function mountLoaded() {
  mockApi.get.mockResolvedValue(PROFILE);
  const w = await mountView(ProfileView, { path: '/profile', routeName: 'profile' });
  await flushPromises();
  return w;
}

describe('ProfileView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the identity and linked-employee fields', async () => {
    const w = await mountLoaded();
    expect(w.text()).toContain('alice');
    expect(w.text()).toContain('alice@example.com');
    expect(w.text()).toContain('Alice Example');
    expect(w.text()).toContain('Finance');
  });

  it('renders a header with the display name and a profile-image panel', async () => {
    const w = await mountLoaded();
    // Display name is the linked employee's full name; the header carries the uploadable image.
    expect(w.text()).toContain('Alice Example');
    expect(w.findComponent({ name: 'ProfileImagePanel' }).exists()).toBe(true);
  });

  it('renders the roles and permissions grouped by scope for the active company', async () => {
    const w = await mountLoaded();
    expect(w.text()).toContain('Approver');
    expect(w.text()).toContain('DOC_APPROVE');
    // Permissions are grouped under a scope heading (la label for DEPARTMENT).
    expect(w.text()).toContain('ພະແນກ');
  });

  it('shows an empty state when no employee is linked', async () => {
    mockApi.get.mockResolvedValue({ ...PROFILE, employee: null });
    const w = await mountView(ProfileView, { path: '/profile', routeName: 'profile' });
    await flushPromises();
    // la: "No employee record is linked to this account…" — and the username still shows.
    expect(w.text()).toContain('ບໍ່ມີຂໍ້ມູນພະນັກງານ');
    expect(w.text()).toContain('alice');
  });

  it('shows empty-state copy when no role or permission is held', async () => {
    mockApi.get.mockResolvedValue({ ...PROFILE, roles: [], permissions: [] });
    const w = await mountView(ProfileView, { path: '/profile', routeName: 'profile' });
    await flushPromises();
    // en fallback/la: no-roles and no-permissions copy render instead of empty lists
    expect(w.text()).toContain('ບໍ່ມີບົດບາດ');
    expect(w.text()).toContain('ບໍ່ມີສິດອະນຸຍາດ');
  });

  it('does not submit when the new password is too weak', async () => {
    const w = await mountLoaded();
    await fill(w, 'OldPass123', 'short', 'short');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(mockApi.changePassword).not.toHaveBeenCalled();
  });

  it('does not submit when the confirmation does not match', async () => {
    const w = await mountLoaded();
    await fill(w, 'OldPass123', 'NewPass456', 'Different9');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(mockApi.changePassword).not.toHaveBeenCalled();
  });

  it('does not submit when the new password equals the current one', async () => {
    const w = await mountLoaded();
    await fill(w, 'SamePass123', 'SamePass123', 'SamePass123');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(mockApi.changePassword).not.toHaveBeenCalled();
  });

  it('submits a valid change and shows success (fields cleared)', async () => {
    mockApi.changePassword.mockResolvedValueOnce({ ok: true });
    const w = await mountLoaded();
    await fill(w, 'OldPass123', 'NewPass456', 'NewPass456');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    expect(mockApi.changePassword).toHaveBeenCalledWith({
      currentPassword: 'OldPass123',
      newPassword: 'NewPass456',
    });
    // la: "Your password has been changed."
    expect(w.text()).toContain('ປ່ຽນລະຫັດຜ່ານຂອງທ່ານແລ້ວ');
  });

  it('shows a non-disclosing error when the current password is wrong (401)', async () => {
    mockApi.changePassword.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    const w = await mountLoaded();
    await fill(w, 'WrongPass9', 'NewPass456', 'NewPass456');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    // la: "The current password is incorrect."
    expect(w.text()).toContain('ລະຫັດຜ່ານປັດຈຸບັນບໍ່ຖືກຕ້ອງ');
  });
});
