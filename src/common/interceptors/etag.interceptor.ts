import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

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

  private stripVersion(value: unknown): unknown {
    if (!this.isPlainObject(value)) return value;
    if (!('version' in value)) return value;
    const { version: _drop, ...rest } = value;
    void _drop;
    return rest;
  }
}
