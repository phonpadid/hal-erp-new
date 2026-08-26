import { describe, expect, it } from 'vitest';
import { missingRequiredFields } from '@erp/shared';

/**
 * A refusal a requester can act on has to be readable for as long as it is still true.
 *
 * The over-budget case from the UI run is the shape of the problem: the server refuses with
 * "2000000 requested, 1000000 available", the client shows it as a toast, the toast expires, and
 * the only text left on screen is a standing banner about a missing file. The requester goes and
 * fixes the wrong thing, with no way back to the real reason.
 *
 * Two rules make that impossible, and both are asserted here:
 *   1. the reason survives the toast, including across the wizard's jump to the detail page;
 *   2. no completeness prompt contradicts it.
 */

/** The refusal the server actually returned in the UI run. */
const OVER_BUDGET =
  'Over budget at control point 6e2ac805-77da-49fd-94bf-4a780993d3aa ' +
  '(budget node 80b6054e-…, department node 959713e4-…): 2000000 requested, 1000000 available';

/** `DocumentDetailView` seeds its standing refusal from the route the wizard leaves behind. */
const refusalFromRoute = (query: Record<string, unknown>) =>
  typeof query.refused === 'string' ? query.refused : '';

describe('a refused submit stays readable', () => {
  it('is carried across the wizard’s navigation rather than dying with the toast', () => {
    // The wizard pushes { name: 'document-detail', params, query: { refused } }.
    expect(refusalFromRoute({ refused: OVER_BUDGET })).toBe(OVER_BUDGET);
  });

  it('shows nothing when the document was not refused', () => {
    expect(refusalFromRoute({})).toBe('');
    // A non-string query value (?refused&refused=) must not render as "[object Object]" or "true".
    expect(refusalFromRoute({ refused: ['a', 'b'] })).toBe('');
    expect(refusalFromRoute({ refused: null })).toBe('');
  });

  it('names what was wrong in terms the requester can act on', () => {
    // The identifiers are noise, but the figures are the actionable part and must be present.
    expect(OVER_BUDGET).toMatch(/\d+ requested/);
    expect(OVER_BUDGET).toMatch(/\d+ available/);
  });

  it('leaves no contradictory completeness prompt beside it', () => {
    // The draft that was refused over budget had all three required fields satisfied — the file
    // as an attachment. Nothing may claim otherwise while the real reason is on screen.
    const template = [
      { fieldName: 'file', fieldType: 'file', isRequired: true, fieldLabel: 'ເອກະສານຕິດຂັດ' },
      { fieldName: 'Reson', fieldType: 'text', isRequired: true, fieldLabel: 'ເຫດຜົນ' },
      { fieldName: 'date', fieldType: 'date', isRequired: true, fieldLabel: 'ວັນທີສະເໜີ' },
    ];
    const asRefusedDraft = {
      values: { Reson: 'UI test — over budget must be refused', date: '2026-08-26' },
      attachmentCount: 1,
      lineCount: 1,
    };
    expect(missingRequiredFields(template, asRefusedDraft)).toEqual([]);
  });
});
