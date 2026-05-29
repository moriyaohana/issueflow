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

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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
        return new BadRequestException('Invalid upload');
    }
  }
}
