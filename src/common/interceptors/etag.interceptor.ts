import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Strips the internal `version` field from response bodies so optimistic
 * concurrency is conveyed exclusively via HTTP headers, and emits a weak
 * `ETag` header (`W/"<n>"`) for single-object responses.
 *
 * Behaviour summary:
 *   - Single object with numeric `version`: ETag header is set, `version` is
 *     stripped from the JSON payload.
 *   - Single object without `version`, or with a non-numeric `version`: the
 *     header is NOT emitted; `version` is still stripped if the key is
 *     present (e.g. `null`) so we never leak it.
 *   - Arrays: each element has its `version` key stripped (header is not
 *     emitted — collection endpoints don't have a single "version").
 *   - Other shapes (primitives, null, undefined): passed through unchanged.
 *
 * Registered globally in AppModule so every controller benefits without
 * opt-in.
 */
@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map((body) => {
        if (Array.isArray(body)) {
          return body.map((item) => this.stripVersion(item));
        }
        if (this.isPlainObject(body)) {
          const version = (body as { version?: unknown }).version;
          if (typeof version === 'number') {
            res.setHeader('ETag', `W/"${version}"`);
          }
          return this.stripVersion(body);
        }
        return body;
      }),
    );
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Removes the `version` key if it is present, regardless of its value. We
   * key off presence (not type) because a response shape can legitimately
   * carry `version: null` (e.g. a draft row) and we still don't want to leak
   * the internal column.
   */
  private stripVersion(value: unknown): unknown {
    if (!this.isPlainObject(value)) return value;
    if (!('version' in value)) return value;
    const { version: _drop, ...rest } = value;
    void _drop;
    return rest;
  }
}
