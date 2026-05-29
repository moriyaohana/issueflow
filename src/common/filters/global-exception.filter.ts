import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Catch-all exception filter registered globally via `APP_FILTER`.
 *
 * - `HttpException`s pass through with their original status and payload so
 *   Nest's documented behaviour for typed errors (400, 404, 412, etc.) is
 *   preserved end-to-end.
 * - Any other thrown value is treated as an unexpected internal failure: the
 *   original error is logged via `Logger` (stack + message) and the client
 *   receives a generic `500 Internal Server Error` body. We never leak the
 *   raw exception message because it can carry stack traces, SQL fragments,
 *   or PII captured in error strings.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(body);
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request?.method} ${request?.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
