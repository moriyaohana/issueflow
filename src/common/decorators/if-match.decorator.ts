import {
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * Param decorator that extracts the numeric version from the `If-Match`
 * request header used for HTTP optimistic concurrency. The header is expected
 * to be a weak ETag of the form `W/"<integer>"` (the surrounding quotes and
 * the `W/` prefix are both tolerated and stripped).
 *
 * Throws 428 Precondition Required when the header is missing or
 * non-numeric — mutating routes that use this decorator therefore enforce
 * the presence of an explicit version expectation.
 */
export const IfMatch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers['if-match'];
    if (!raw || typeof raw !== 'string') {
      throw new HttpException(
        'If-Match header is required',
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    // Strip weak prefix W/ and surrounding double-quotes.
    const cleaned = raw.replace(/^W\//, '').replace(/^"|"$/g, '');
    const n = parseInt(cleaned, 10);
    if (!Number.isInteger(n)) {
      throw new HttpException(
        'If-Match must be a numeric ETag',
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    return n;
  },
);
