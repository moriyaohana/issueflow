import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * Param decorator that extracts the numeric version from the `If-Match`
 * request header used for HTTP optimistic concurrency. The header is expected
 * to be a weak ETag of the form `W/"<integer>"` (the `W/` prefix is optional,
 * but the double-quotes around the integer are required).
 *
 * Behaviour:
 *   - Missing header   → 428 Precondition Required (mutating routes MUST opt
 *     into optimistic concurrency by sending the header).
 *   - Malformed header → 400 Bad Request, per RFC 7232 §3.1 — a syntactically
 *     invalid `If-Match` is a client error, not a missing precondition.
 *   - Well-formed      → the captured integer is returned to the handler.
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
    // Anchor the whole header: optional weak prefix, then a quoted integer.
    // Anything else (`"12abc"`, `W/"123`, bare `123`) is a client-format error.
    const match = raw.match(/^(?:W\/)?"(\d+)"$/);
    if (!match) {
      throw new BadRequestException('Malformed If-Match header');
    }
    return parseInt(match[1], 10);
  },
);
