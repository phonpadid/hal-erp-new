import { describe, expect, it } from 'vitest';
import { compareDocumentSummaryRows, type DocumentSummaryRow } from './reporting.service';

// Pure, DB-free coverage for the crash fixed here: the document-summary sort used to call
// `a.typeCode.localeCompare(...)` directly and threw `Cannot read properties of undefined
// (reading 'localeCompare')` when a document's `documentType` could not be resolved, leaving
// `typeCode` undefined. The comparator must tolerate that and stay a total order.
const row = (over: Partial<DocumentSummaryRow>): DocumentSummaryRow => ({
  documentTypeId: 'id',
  typeCode: 'PR',
  typeName: 'Purchase Req',
  category: 'PROCUREMENT',
  status: 'APPROVED',
  count: 1,
  baseTotal: '0',
  ...over,
});

describe('compareDocumentSummaryRows', () => {
  it('does not throw when typeCode is missing (the original 500)', () => {
    const a = row({ typeCode: undefined as unknown as string });
    const b = row({ typeCode: 'PR' });
    expect(() => [a, b].sort(compareDocumentSummaryRows)).not.toThrow();
  });

  it('does not throw when status is missing', () => {
    const a = row({ status: undefined as unknown as string });
    const b = row({ status: 'APPROVED' });
    expect(() => [a, b].sort(compareDocumentSummaryRows)).not.toThrow();
  });

  it('orders by typeCode then status, with missing keys sorting first', () => {
    const missing = row({ typeCode: undefined as unknown as string, status: 'APPROVED' });
    const prApproved = row({ typeCode: 'PR', status: 'APPROVED' });
    const prInApproval = row({ typeCode: 'PR', status: 'IN_APPROVAL' });
    const poApproved = row({ typeCode: 'PO', status: 'APPROVED' });

    const sorted = [prInApproval, poApproved, missing, prApproved].sort(compareDocumentSummaryRows);

    expect(sorted.map((r) => [r.typeCode, r.status])).toEqual([
      [undefined, 'APPROVED'],
      ['PO', 'APPROVED'],
      ['PR', 'APPROVED'],
      ['PR', 'IN_APPROVAL'],
    ]);
  });
});
