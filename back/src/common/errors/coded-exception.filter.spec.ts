import {
  BadRequestException, ConflictException, ForbiddenException, HttpStatus, NotFoundException,
} from '@nestjs/common';
import { ValidationError } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';
import { CodedExceptionFilter } from './coded-exception.filter';
import { coded, ErrorCode } from './error-code';

/** A minimal ArgumentsHost that captures what the filter sent. */
function capture() {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
      return this;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as never;
  return { sent, host };
}

/**
 * The filter adds a field and changes nothing else.
 *
 * Every error toast in the web app comes from `utils/apiError.ts`, which reads
 * `response.data.message` and nothing else — so the pass-through matters more than the codes. Most
 * of these tests exist to prove the ~250 throw sites this change never touched still answer exactly
 * as they did.
 */
describe('CodedExceptionFilter', () => {
  const filter = new CodedExceptionFilter();

  it('a coded failure is still the Nest exception it always was', () => {
    // The reason this is a factory and not a subclass: ~40 specs and any future catch assert
    // `instanceof BadRequestException`, and a new class extending HttpException would silently
    // stop matching all of them.
    expect(coded(ErrorCode.BUDGET_EXCEEDED, 'x')).toBeInstanceOf(BadRequestException);
    expect(coded(ErrorCode.INVALID_STATE, 'x', HttpStatus.CONFLICT)).toBeInstanceOf(ConflictException);
  });

  it('names a coded exception', () => {
    const { sent, host } = capture();
    filter.catch(coded(ErrorCode.BUDGET_EXCEEDED, 'Over budget: 4500 …'), host);

    expect(sent.status).toBe(400);
    expect(sent.body?.code).toBe('BUDGET_EXCEEDED');
    expect(sent.body?.message).toBe('Over budget: 4500 …');
  });

  it('leaves an uncoded BadRequestException exactly as it was, plus the derived code', () => {
    // The regression guard for every site this change did not edit.
    const { sent, host } = capture();
    filter.catch(new BadRequestException('Something the caller did'), host);

    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({
      statusCode: 400,
      message: 'Something the caller did',
      error: 'Bad Request',
      code: 'BAD_REQUEST',
    });
  });

  it('keeps the validator array intact and codes it', () => {
    // ValidationPipe's shape. The web app JOINS this array for display, so losing it would break
    // every form error in the product.
    const { sent, host } = capture();
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['qty must be a number string', 'lineNo must not be less than 1'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(sent.body?.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(sent.body?.message).toEqual([
      'qty must be a number string',
      'lineNo must not be less than 1',
    ]);
  });

  it('derives the code from the status for the other standard exceptions', () => {
    for (const [exception, code, status] of [
      [new NotFoundException('nope'), 'NOT_FOUND', 404],
      [new ForbiddenException('no'), 'FORBIDDEN', 403],
      [new ConflictException('clash'), 'CONFLICT', 409],
    ] as const) {
      const { sent, host } = capture();
      filter.catch(exception, host);
      expect(sent.status).toBe(status);
      expect(sent.body?.code).toBe(code);
    }
  });

  it('answers a non-HTTP fault as a 500 without leaking it', () => {
    const { sent, host } = capture();
    vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(new Error('connection reset by peer'), host);

    expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(sent.body?.code).toBe('INTERNAL_ERROR');
    // The internal message must not reach the caller.
    expect(sent.body?.message).toBe('Internal server error');
  });

  it('carries a coded exception raised at a non-400 status', () => {
    const { sent, host } = capture();
    filter.catch(
      coded(ErrorCode.INVALID_STATE, 'wrong state', HttpStatus.CONFLICT),
      host,
    );

    expect(sent.status).toBe(409);
    expect(sent.body?.code).toBe(ErrorCode.INVALID_STATE);
    expect(sent.body?.error).toBe('Conflict');
  });
  /**
   * A value can satisfy every decorator on its DTO and still be refused when the row is built, so
   * the ORM's refusal is a statement about the request. Answering 500 told the caller the opposite,
   * and told it with INTERNAL_ERROR — the code an integration is told to retry or escalate on. The
   * live instance was `PUT /documents/:id/lines` with a line missing `lineAmount`.
   */
  describe('a refusal from below the DTO layer', () => {
    const ormError = () =>
      new ValidationError('Value for DocumentLine.lineAmount is required, but is not set.');

    it('answers 400 with the validation code, not 500', () => {
      const { sent, host } = capture();
      vi.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
      filter.catch(ormError(), host);

      expect(sent.status).toBe(HttpStatus.BAD_REQUEST);
      expect(sent.body?.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(sent.body?.code).not.toBe('INTERNAL_ERROR');
    });

    it('names the value, because a 400 that does not is no more actionable than the 500', () => {
      const { sent, host } = capture();
      vi.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
      filter.catch(ormError(), host);

      expect(sent.body?.message).toContain('lineAmount');
    });

    it('keeps the four fields every other error body has', () => {
      // `utils/apiError.ts` reads `message` and nothing else, and must not be able to tell this
      // branch exists.
      const { sent, host } = capture();
      vi.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
      filter.catch(ormError(), host);

      expect(Object.keys(sent.body ?? {}).sort()).toEqual(['code', 'error', 'message', 'statusCode']);
      expect(sent.body?.statusCode).toBe(400);
      expect(sent.body?.error).toBe('Bad Request');
    });

    it('is still logged, because the same shape can mean OUR code failed to set a value', () => {
      // After this branch the status no longer distinguishes a bad payload from a server bug. The
      // log is the only thing that does, so losing it would hide one class of fault entirely.
      const { host } = capture();
      const warn = vi.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
      filter.catch(ormError(), host);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('lineAmount');
    });

    it('leaves every other non-HTTP error answering 500', () => {
      // The assertion that stops the new branch from swallowing genuine faults.
      const { sent, host } = capture();
      vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
      filter.catch(new Error('connection reset by peer'), host);

      expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(sent.body?.message).toBe('Internal server error');
    });
  });
});
