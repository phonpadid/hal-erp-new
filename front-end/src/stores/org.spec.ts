import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { departmentSchema, fiscalYearSchema, holidaySchema } from '@erp/shared';
import { useOrgStore } from './org';
import { orgApi } from '../api/org';

vi.mock('../api/org', () => {
  const ns = (extra = {}) => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), ...extra });
  return {
    orgApi: {
      companies: ns(),
      departments: ns(),
      fiscalYears: ns({ close: vi.fn() }),
      holidays: ns({ remove: vi.fn() }),
      currencies: vi.fn(),
    },
  };
});

const o = orgApi as any;

describe('org shared schemas', () => {
  it('accepts valid payloads', () => {
    expect(departmentSchema.safeParse({ deptCode: 'IT', name: 'IT' }).success).toBe(true);
    expect(fiscalYearSchema.safeParse({ year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }).success).toBe(true);
    expect(holidaySchema.safeParse({ holidayDate: '2026-01-01', name: 'New Year' }).success).toBe(true);
  });

  it('rejects missing required and out-of-range year', () => {
    expect(departmentSchema.safeParse({ name: 'no code' }).success).toBe(false);
    expect(fiscalYearSchema.safeParse({ year: 1999, startDate: '2026-01-01', endDate: '2026-12-31' }).success).toBe(false);
    expect(holidaySchema.safeParse({ holidayDate: '2026-01-01' }).success).toBe(false);
  });
});

describe('useOrgStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    const emptyPage = { items: [], total: 0, page: 1, limit: 20 };
    for (const ns of ['companies', 'departments', 'fiscalYears', 'holidays']) o[ns].list.mockResolvedValue(emptyPage);
    o.currencies.mockResolvedValue([]);
  });

  it('loadAll populates every collection', async () => {
    o.companies.list.mockResolvedValueOnce({ items: [{ id: 'c1', code: 'DEMO' }], total: 1, page: 1, limit: 20 });
    o.fiscalYears.list.mockResolvedValueOnce({ items: [{ id: 'fy1', year: 2026, status: 'OPEN' }], total: 1, page: 1, limit: 20 });
    const s = useOrgStore();
    await s.loadAll();
    expect(s.companies).toHaveLength(1);
    expect(s.fiscalYears).toHaveLength(1);
  });

  it('createDepartment + closeFiscalYear + removeHoliday call the endpoint and refresh', async () => {
    o.departments.create.mockResolvedValueOnce(undefined);
    o.fiscalYears.close.mockResolvedValueOnce(undefined);
    o.holidays.remove.mockResolvedValueOnce(undefined);
    const s = useOrgStore();
    expect(await s.createDepartment({ deptCode: 'IT', name: 'IT' })).toBe(true);
    expect(o.departments.create).toHaveBeenCalled();
    await s.closeFiscalYear('fy1');
    expect(o.fiscalYears.close).toHaveBeenCalledWith('fy1');
    await s.removeHoliday('h1');
    expect(o.holidays.remove).toHaveBeenCalledWith('h1');
    expect(o.departments.list).toHaveBeenCalled(); // refreshed via loadAll
  });

  it('captures a server error and returns false', async () => {
    o.companies.create.mockRejectedValueOnce({ response: { data: { message: 'denied' } } });
    const s = useOrgStore();
    expect(await s.createCompany({})).toBe(false);
    expect(s.error).toBe('denied');
  });
});
