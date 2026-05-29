import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MulterError } from 'multer';
import { MAX_UPLOAD_BYTES } from '../constants/upload';

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

    // Multer surfaces upload guard rails (size cap, unexpected field) as its
    // own `MulterError` subclass, which Nest otherwise lets bubble up to a
    // generic 500 with an opaque message. Translate them to typed HTTP
    // exceptions so clients see a clear, documented body — the PDF (§4.1)
    // requires "clear error" for an oversized attachment / CSV import.
    if (exception instanceof MulterError) {
      const mapped = this.translateMulterError(exception);
      const status = mapped.getStatus();
      response.status(status).json(mapped.getResponse());
      return;
    }

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

  private translateMulterError(err: MulterError): HttpException {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return new PayloadTooLargeException(
          `Upload exceeds ${limitMb} MB limit`,
        );
      case 'LIMIT_UNEXPECTED_FILE':
        return new BadRequestException(
          err.field
            ? `Unexpected file field "${err.field}"`
            : 'Unexpected file field',
        );
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_PART_COUNT':
      case 'LIMIT_FIELD_KEY':
      case 'LIMIT_FIELD_VALUE':
      case 'LIMIT_FIELD_COUNT':
        return new BadRequestException(`Upload rejected: ${err.code}`);
      default:
        // Fallthrough for codes the typings might add later — still better
        // than a 500 with the raw message.
        return new BadRequestException('Invalid upload');
    }
  }
}
