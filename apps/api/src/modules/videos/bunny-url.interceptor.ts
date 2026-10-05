import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { BunnyService } from './bunny.service';

/**
 * Expiring video links.
 *
 * With Bunny token authentication on, a bare CDN link no longer plays: it
 * needs a signature that runs out after a few hours. Bunny links are stored
 * in many places (Video rows, clips copied into report content, drills, the
 * MLB library...), so rather than sign each one where it is read, every API
 * response is passed through here and each Bunny link in it -- including
 * links inside JSON-in-a-string report content -- gets a fresh signature.
 *
 * Requests go the other way: a page that saves back a link it was given
 * (report content, say) has its signature stripped first, so the database
 * only ever holds plain links.
 *
 * Does nothing until BUNNY_STREAM_TOKEN_KEY is set.
 */
@Injectable()
export class BunnyUrlInterceptor implements NestInterceptor {
  constructor(private bunny: BunnyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !this.bunny.signingEnabled()) return next.handle();

    const req = context.switchToHttp().getRequest();
    if (req.body && typeof req.body === 'object') {
      req.body = mapStrings(req.body, (s) => this.bunny.canonicalizeUrlsIn(s));
    }
    return next.handle().pipe(map((data) => mapStrings(data, (s) => this.bunny.signUrlsIn(s))));
  }
}

/** Copy of `value` with `fn` applied to every string in plain objects and
 *  arrays. Anything else (Dates, Buffers, streams) is passed through. */
function mapStrings(value: unknown, fn: (s: string) => string): any {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}
