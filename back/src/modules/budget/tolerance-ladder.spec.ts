import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ToleranceLadder } from './tolerance-ladder';

describe('tolerance ladder', () => {
  describe('reproduces the binary policy exactly', () => {
    it('blocks at the ceiling like HARD_STOP', () => {
      const outcome = ToleranceLadder.evaluate(ToleranceLadder.BLOCK_AT_CEILING, {
        ceiling: '50000',
        used: '0',
        requested: '60000',
      });
      expect(outcome).toBe('BLOCK');
    });

    it('warns at the ceiling like SOFT_WARNING', () => {
      const outcome = ToleranceLadder.evaluate(ToleranceLadder.WARN_AT_CEILING, {
        ceiling: '50000',
        used: '0',
        requested: '60000',
      });
      expect(outcome).toBe('WARN');
    });

    it('treats spending exactly to the ceiling as within budget', () => {
      // The boundary the old check used: available 100,000, requesting 100,000 succeeded.
      expect(
        ToleranceLadder.evaluate(ToleranceLadder.BLOCK_AT_CEILING, {
          ceiling: '100000',
          used: '0',
          requested: '100000',
        }),
      ).toBe('OK');
      expect(
        ToleranceLadder.evaluate(ToleranceLadder.BLOCK_AT_CEILING, {
          ceiling: '100000',
          used: '0',
          requested: '100000.01',
        }),
      ).toBe('BLOCK');
    });
  });

  describe('multi-rung ladders', () => {
    const ladder = ToleranceLadder.parse([
      { at: 80, action: 'WARN' },
      { at: 100, action: 'BLOCK' },
    ]);

    it('warns once past the lower rung but under the ceiling', () => {
      expect(
        ToleranceLadder.evaluate(ladder, { ceiling: '100000', used: '0', requested: '85000' }),
      ).toBe('WARN');
    });

    it('is silent below every rung', () => {
      expect(
        ToleranceLadder.evaluate(ladder, { ceiling: '100000', used: '0', requested: '50000' }),
      ).toBe('OK');
    });

    it('lets a matched block dominate a matched warning', () => {
      expect(
        ToleranceLadder.evaluate(ladder, { ceiling: '100000', used: '0', requested: '120000' }),
      ).toBe('BLOCK');
    });

    it('gives the same outcome however the rungs are ordered', () => {
      const reversed = ToleranceLadder.parse([
        { at: 100, action: 'BLOCK' },
        { at: 80, action: 'WARN' },
      ]);
      for (const requested of ['50000', '85000', '120000']) {
        const input = { ceiling: '100000', used: '0', requested };
        expect(ToleranceLadder.evaluate(reversed, input)).toBe(
          ToleranceLadder.evaluate(ladder, input),
        );
      }
    });

    it('counts what is already used, not just the new request', () => {
      expect(
        ToleranceLadder.evaluate(ladder, { ceiling: '100000', used: '75000', requested: '10000' }),
      ).toBe('WARN');
      expect(
        ToleranceLadder.evaluate(ladder, { ceiling: '100000', used: '95000', requested: '10000' }),
      ).toBe('BLOCK');
    });
  });

  describe('degenerate ceilings do not divide by zero', () => {
    it('treats any positive request against a zero ceiling as over', () => {
      expect(
        ToleranceLadder.evaluate(ToleranceLadder.BLOCK_AT_CEILING, {
          ceiling: '0',
          used: '0',
          requested: '1',
        }),
      ).toBe('BLOCK');
    });

    it('allows a zero request against a zero ceiling', () => {
      expect(
        ToleranceLadder.evaluate(ToleranceLadder.BLOCK_AT_CEILING, {
          ceiling: '0',
          used: '0',
          requested: '0',
        }),
      ).toBe('OK');
    });

    it('handles a ceiling already overdrawn by an approved decrease', () => {
      // ADJUST_DECREASE is applied without an availability check, so `used` can exceed `ceiling`.
      expect(
        ToleranceLadder.evaluate(ToleranceLadder.BLOCK_AT_CEILING, {
          ceiling: '100000',
          used: '150000',
          requested: '0',
        }),
      ).toBe('BLOCK');
    });
  });

  describe('validation happens on write, never permissively on read', () => {
    it('rejects an empty ladder', () => {
      // A control point with no rungs would check nothing while looking configured.
      expect(() => ToleranceLadder.parse([])).toThrow(BadRequestException);
    });

    it('rejects a non-array', () => {
      expect(() => ToleranceLadder.parse({ at: 100, action: 'BLOCK' })).toThrow(BadRequestException);
    });

    it('rejects an unknown action', () => {
      expect(() => ToleranceLadder.parse([{ at: 100, action: 'ESCALATE' }])).toThrow(
        BadRequestException,
      );
    });

    it('rejects a non-numeric or negative threshold', () => {
      expect(() => ToleranceLadder.parse([{ at: '100', action: 'BLOCK' }])).toThrow(
        BadRequestException,
      );
      expect(() => ToleranceLadder.parse([{ at: -1, action: 'BLOCK' }])).toThrow(
        BadRequestException,
      );
    });

    it('rejects malformed JSON rather than allowing the spend', () => {
      expect(() => ToleranceLadder.parseJson('not json')).toThrow(BadRequestException);
      expect(() => ToleranceLadder.parseJson('[]')).toThrow(BadRequestException);
    });

    it('round-trips a valid ladder through storage', () => {
      const rungs = ToleranceLadder.parse([
        { at: 80, action: 'WARN' },
        { at: 100, action: 'BLOCK' },
      ]);
      expect(ToleranceLadder.parseJson(ToleranceLadder.stringify(rungs))).toEqual(rungs);
    });

    it('stores the migration translations in the shape it reads back', () => {
      expect(ToleranceLadder.parseJson(ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING)))
        .toEqual([{ at: 100, action: 'BLOCK' }]);
      expect(ToleranceLadder.parseJson(ToleranceLadder.stringify(ToleranceLadder.WARN_AT_CEILING)))
        .toEqual([{ at: 100, action: 'WARN' }]);
    });
  });
});
