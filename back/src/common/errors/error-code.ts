import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus,
  NotFoundException,
} from '@nestjs/common';

/**
 * Failure codes a caller branches on.
 *
 * A code exists because someone does something different when they see it — not because a line can
 * throw. There are ~250 `BadRequestException` sites in this backend and almost none of them are
 * here, deliberately: a code nobody reads is a maintenance cost with no reader, and the derived
 * defaults already give every one of those a stable value.
 *
 * The named ones and the reaction that earns each its place:
 *
 * - `BUDGET_EXCEEDED`   hold the work, tell someone, try again once the budget is topped up
 * - `QUOTA_EXCEEDED`    the same shape, but what has to be topped up is different
 * - `INVALID_STATE`     stop; the operation no longer applies to this document
 * - `VALIDATION_FAILED` a bug in the caller — never retry
 * - `EVIDENCE_IS_LOAD_BEARING` attach the replacement slip first, then remove this one — the
 *                       screen offers an upload rather than repeating a refusal
 * - `PAYMENT_SLIP_REQUIRED` attach the transfer slip, then approve again — the approval screen
 *                       shows an upload instead of an error, which is a different reaction from
 *                       every other refusal an approve can produce
 *
 * Anything else answers with a code derived from the HTTP status. Those are NOT a contract and may
 * change when a case earns a name.
 */
export const ErrorCode = {
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_STATE: 'INVALID_STATE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PAYMENT_SLIP_REQUIRED: 'PAYMENT_SLIP_REQUIRED',
  EVIDENCE_IS_LOAD_BEARING: 'EVIDENCE_IS_LOAD_BEARING',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The code an uncoded exception answers with, from its status. Never a promise to a caller. */
export function codeFromStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE_ENTITY';
    case HttpStatus.INTERNAL_SERVER_ERROR:
      return 'INTERNAL_ERROR';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}

/** An exception carrying a machine-readable code, whatever Nest class it is. */
export interface CodedError {
  code: ErrorCode;
}

export function isCoded(e: unknown): e is HttpException & CodedError {
  return e instanceof HttpException && typeof (e as Partial<CodedError>).code === 'string';
}

/**
 * Throw a failure that names itself, without changing what kind of exception it is.
 *
 * A factory rather than a subclass, and that is the whole point: `throw new SomeCodedException()`
 * extending `HttpException` would stop being an instance of `BadRequestException`, and every
 * `expect(...).rejects.toThrow(BadRequestException)` and every `catch (e instanceof …)` in the
 * codebase would quietly stop matching. Found the hard way — a settlement test failed for exactly
 * that reason. So the real Nest exception is constructed and the code is attached to it: callers,
 * catches and tests see precisely what they saw before, plus a field.
 *
 * Raise it where the refusal is decided — inside the ledger that says no, not at the endpoint that
 * called it — so a path written later inherits the code without anyone remembering to add it.
 */
export function coded(
  code: ErrorCode,
  message: string,
  status: HttpStatus = HttpStatus.BAD_REQUEST,
): HttpException {
  const exception = build(message, status);
  Object.defineProperty(exception, 'code', { value: code, enumerable: true });
  return exception;
}

function build(message: string, status: HttpStatus): HttpException {
  switch (status) {
    case HttpStatus.CONFLICT:
      return new ConflictException(message);
    case HttpStatus.FORBIDDEN:
      return new ForbiddenException(message);
    case HttpStatus.NOT_FOUND:
      return new NotFoundException(message);
    default:
      return new BadRequestException(message);
  }
}
