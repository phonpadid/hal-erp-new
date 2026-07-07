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
    expect(vendorSchema.safeParse({ name: 'no code' }).success).toBe(false);
    expect(itemSchema.safeParse({ itemCode: 'I1' }).success).toBe(false);
  });

  it('rejects a negative payment term', () => {
    expect(vendorSchema.safeParse({ vendorCode: 'V1', name: 'Acme', paymentTermDays: -1 }).success).toBe(false);
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

  it('saveVendor creates without an id and updates with one', async () => {
    v.create.mockResolvedValue(undefined); v.update.mockResolvedValue(undefined);
    v.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }); v.enabled.mockResolvedValue([]);
    const s = useMasterDataStore();
    await s.saveVendor({ vendorCode: 'X', name: 'X' });
    expect(v.create).toHaveBeenCalled();
    await s.saveVendor({ name: 'X2' }, 'id1');
    expect(v.update).toHaveBeenCalledWith('id1', { name: 'X2' });
  });

  it('setVendorEnabled calls enable/disable then refreshes', async () => {
    v.enable.mockResolvedValue(undefined); v.disable.mockResolvedValue(undefined);
    v.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }); v.enabled.mockResolvedValue([]);
    const s = useMasterDataStore();
    await s.setVendorEnabled('id1', true);
    expect(v.enable).toHaveBeenCalledWith('id1');
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
