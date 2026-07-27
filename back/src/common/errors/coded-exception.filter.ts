import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { codeFromStatus, ErrorCode, isCoded } from './error-code';
import type { Response } from 'express';

/**
 * Adds a machine-readable `code` to every error response, and changes nothing else.
 *
 * An integration cannot tell "the budget refused this" from "your payload is wrong" when both
 * answer 400 with prose — and the prose carries ids and amounts, so matching on it breaks the day
 * someone rewords a message. This is the field they branch on instead.
 *
 * The body is passed through exactly as Nest produced it: `statusCode`, `message` (a string, or the
 * array `ValidationPipe` produces, which the web app joins for display) and `error`. Only `code` is
 * added. `utils/apiError.ts` in the web app reads `message` and nothing else, and must not notice
 * this filter exists.
 *
 * A code comes from the exception when it carries one, and from the HTTP status otherwise. That
 * default is what keeps this change small: ~250 existing throw sites become coded without being
 * edited.
 */
@Catch()
export class CodedExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CodedExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      // Not an HTTP exception: a genuine fault. Log it and answer with the shape Nest would have,
      // rather than leaking the error to the caller.
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: codeFromStatus(HttpStatus.INTERNAL_SERVER_ERROR),
        message: 'Internal server error',
        error: 'Internal Server Error',
      });
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse();
    // A string response is what `new BadRequestException('text')` produces internally; normalise it
    // to the object shape Nest sends on the wire so the added field has somewhere to live.
    const base: Record<string, unknown> =
      typeof body === 'string'
        ? { statusCode: status, message: body, error: exception.name }
        : { ...(body as Record<string, unknown>) };

    res.status(status).json({ ...base, code: this.codeOf(exception, base, status) });
  }

  /**
   * The code for this exception: its own if it named one; `VALIDATION_FAILED` when the payload
   * failed DTO validation — recognised by the array message `ValidationPipe` produces, so the most
   * common caller bug is coded without touching a single DTO; otherwise derived from the status.
   */
  private codeOf(
    exception: HttpException,
    body: Record<string, unknown>,
    status: number,
  ): string {
    if (isCoded(exception)) return exception.code;
    if (status === HttpStatus.BAD_REQUEST && Array.isArray(body.message)) {
      return ErrorCode.VALIDATION_FAILED;
    }
    return codeFromStatus(status);
  }
}
