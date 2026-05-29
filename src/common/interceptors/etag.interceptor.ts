import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Translates the internal `version` field on a response body into a weak
 * ETag header (`W/"<n>"`) and strips it from the JSON payload, so that
 * optimistic concurrency is conveyed exclusively via HTTP headers.
 *
 * Only acts on plain object responses — arrays and other shapes pass through
 * unchanged. Used by controllers that expose versioned entities.
 */
@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map((body) => {
        if (
          body &&
          typeof body === 'object' &&
          !Array.isArray(body) &&
          typeof (body as { version?: unknown }).version === 'number'
        ) {
          const { version, ...rest } = body as Record<string, unknown> & {
            version: number;
          };
          res.setHeader('ETag', `W/"${version}"`);
          return rest;
        }
        return body;
      }),
    );
  }
}
