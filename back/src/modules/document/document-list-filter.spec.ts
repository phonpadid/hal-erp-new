import { describe, expect, it } from 'vitest';
import { DocStatus } from '../../common/enums';
import { buildDocumentFilter } from './document.service';
import type { DocumentListQueryDto } from './dto/document.dto';

/**
 * Pure unit tests for the document-list `where` builder (no DB). The company scope is
 * applied separately by `forActiveCompany()`, so these assert only the narrowing filters.
 */
describe('buildDocumentFilter', () => {
  it('returns an empty where when no filters are given (3.4 — preserves existing behavior)', () => {
    expect(buildDocumentFilter({})).toEqual({});
  });

  it('maps status to an $in over the enum values', () => {
    const where = buildDocumentFilter({ status: [DocStatus.SUBMITTED, DocStatus.IN_APPROVAL] });
    expect(where).toEqual({ status: { $in: [DocStatus.SUBMITTED, DocStatus.IN_APPROVAL] } });
  });

  it('maps type/department/vendor to equality on the relation', () => {
    const q: DocumentListQueryDto = {
      documentTypeId: '11111111-1111-1111-1111-111111111111',
      departmentId: '22222222-2222-2222-2222-222222222222',
      vendorId: '33333333-3333-3333-3333-333333333333',
    };
    expect(buildDocumentFilter(q)).toMatchObject({
      documentType: q.documentTypeId,
      department: q.departmentId,
      vendor: q.vendorId,
    });
  });

  it('maps docNo to a case-insensitive contains match', () => {
    expect(buildDocumentFilter({ docNo: 'PR-A' })).toEqual({ docNo: { $ilike: '%PR-A%' } });
  });

  it('combines a created-date range with createdTo inclusive of the end day (boundary)', () => {
    const where = buildDocumentFilter({ createdFrom: '2026-06-01', createdTo: '2026-06-24' }) as {
      createdAt: { $gte: Date; $lte: Date };
    };
    expect(where.createdAt.$gte).toEqual(new Date('2026-06-01'));
    // end-of-day inclusive, not midnight (which would exclude same-day documents)
    expect(where.createdAt.$lte).toEqual(new Date('2026-06-24T23:59:59.999Z'));
  });

  it('keeps amount bounds as decimal strings — never a JS number (no coercion)', () => {
    const where = buildDocumentFilter({ minAmount: '1000.00', maxAmount: '9007199254740993.01' }) as {
      baseTotalAmount: { $gte: unknown; $lte: unknown };
    };
    expect(where.baseTotalAmount.$gte).toBe('1000.00');
    // a value beyond Number.MAX_SAFE_INTEGER survives intact as a string
    expect(where.baseTotalAmount.$lte).toBe('9007199254740993.01');
    expect(typeof where.baseTotalAmount.$gte).toBe('string');
    expect(typeof where.baseTotalAmount.$lte).toBe('string');
  });

  it('filters combine conjunctively in one where object', () => {
    const where = buildDocumentFilter({
      status: [DocStatus.APPROVED],
      documentTypeId: '11111111-1111-1111-1111-111111111111',
      minAmount: '50',
    });
    expect(Object.keys(where).sort()).toEqual(['baseTotalAmount', 'documentType', 'status']);
  });
});
