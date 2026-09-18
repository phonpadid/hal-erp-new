import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { itemSchema, vendorSchema } from '@erp/shared';
import { useMasterDataStore } from './masterData';
import { masterDataApi } from '../api/masterData';

vi.mock('../api/masterData', () => {
  const ns = () => ({ list: vi.fn(), enabled: vi.fn(), create: vi.fn(), update: vi.fn(), enable: vi.fn(), disable: vi.fn(), remove: vi.fn() });
  return { masterDataApi: { vendors: ns(), items: ns() } };
});

const v = masterDataApi.vendors as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('shared master-data schemas', () => {
  it('accepts a valid vendor and item', () => {
    expect(vendorSchema.safeParse({ vendorCode: 'V1', name: 'Acme' }).success).toBe(true);
    expect(itemSchema.safeParse({ itemCode: 'I1', name: 'Paper' }).success).toBe(true);
  });

  it('rejects a missing required field', () => {
    expect(vendorSchema.safeParse({}).success).toBe(false);
    expect(itemSchema.safeParse({ defaultUnit: 'ea' }).success).toBe(false);
  });

  it('asks for no code — the server issues it', () => {
    expect(vendorSchema.safeParse({ name: 'no code' }).success).toBe(true);
    expect(itemSchema.safeParse({ name: 'no code' }).success).toBe(true);
    // A code sent anyway is dropped by parsing, never forwarded as the caller's choice.
    expect(vendorSchema.safeParse({ vendorCode: 'MINE', name: 'x' }).data).toEqual({ name: 'x' });
  });

  it('rejects a negative payment term', () => {
    expect(vendorSchema.safeParse({ name: 'Acme', paymentTermDays: -1 }).success).toBe(false);
  });
});

describe('useMasterDataStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('loadVendors merges the enabled flag', async () => {
    v.list.mockResolvedValueOnce({ items: [{ id: 'a', vendorCode: 'A' }, { id: 'b', vendorCode: 'B' }], total: 2, page: 1, limit: 20 });
    v.enabled.mockResolvedValueOnce([{ id: 'a', vendorCode: 'A' }]);
    const s = useMasterDataStore();
    await s.loadVendors();
    expect(s.vendors.find((x) => x.id === 'a')!.enabled).toBe(true);
    expect(s.vendors.find((x) => x.id === 'b')!.enabled).toBe(false);
  });

  it('merge overlays per-company fields from the /enabled read (item GL survives reload)', async () => {
    const i = masterDataApi.items as unknown as Record<string, ReturnType<typeof vi.fn>>;
    // Group list carries no GL; the per-company GL lives only on the /enabled record.
    i.list.mockResolvedValueOnce({ items: [{ id: 'a', itemCode: 'A' }], total: 1, page: 1, limit: 20 });
    i.enabled.mockResolvedValueOnce([{ id: 'a', itemCode: 'A', defaultGlAccount: '5000' }]);
    const s = useMasterDataStore();
    await s.loadItems();
    const row = s.items.find((x) => x.id === 'a')!;
    expect(row.enabled).toBe(true);
    expect(row.defaultGlAccount).toBe('5000');
  });

  it('saveVendor creates without an id and updates with one, resolving to the issued code', async () => {
    v.create.mockResolvedValue({ id: 'id1', vendorCode: 'V-00007', name: 'X' });
    v.update.mockResolvedValue({ id: 'id1', vendorCode: 'V-00007', name: 'X2' });
    v.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }); v.enabled.mockResolvedValue([]);
    const s = useMasterDataStore();
    // No code in the payload: the server issues it and the store hands it back.
    expect(await s.saveVendor({ name: 'X' })).toBe('V-00007');
    expect(v.create).toHaveBeenCalledWith({ name: 'X' });
    expect(await s.saveVendor({ name: 'X2' }, 'id1')).toBe('V-00007');
    expect(v.update).toHaveBeenCalledWith('id1', { name: 'X2' });
  });

  it('saveVendor resolves to null when the server refuses', async () => {
    v.create.mockRejectedValue(new Error('nope'));
    const s = useMasterDataStore();
    expect(await s.saveVendor({ name: 'X' })).toBeNull();
    expect(s.error).toBeTruthy();
  });

  it('setVendorEnabled calls enable/disable then refreshes', async () => {
    v.enable.mockResolvedValue(undefined); v.disable.mockResolvedValue(undefined);
    v.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }); v.enabled.mockResolvedValue([]);
    const s = useMasterDataStore();
    await s.setVendorEnabled('id1', true);
    // Enable now carries per-company options; none passed here → an empty options body.
    expect(v.enable).toHaveBeenCalledWith('id1', {});
    await s.setVendorEnabled('id1', false);
    expect(v.disable).toHaveBeenCalledWith('id1');
    expect(v.list).toHaveBeenCalled();
  });

  it('captures an error', async () => {
    v.list.mockRejectedValueOnce({ response: { data: { message: 'denied' } } });
    const s = useMasterDataStore();
    await s.loadVendors();
    expect(s.error).toBe('denied');
  });
});
