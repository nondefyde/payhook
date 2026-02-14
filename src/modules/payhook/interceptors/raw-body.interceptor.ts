import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Raw Body Interceptor
 *
 * Preserves the raw request body for webhook signature verification
 */
@Injectable()
export class RawBodyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Check if raw body is already available
    if (request.rawBody) {
      // Already have raw body (from middleware)
      request.body = request.rawBody;
    } else if (Buffer.isBuffer(request.body)) {
      // Body is already a buffer
      request.rawBody = request.body;
    } else if (typeof request.body === 'string') {
      // Body is a string, convert to buffer
      request.rawBody = Buffer.from(request.body);
      request.body = request.rawBody;
    } else if (request.body && typeof request.body === 'object') {
      // Body has been parsed, try to reconstruct raw body
      // This is not ideal for signature verification!
      const bodyString = JSON.stringify(request.body);
      request.rawBody = Buffer.from(bodyString);
      request.body = request.rawBody;
    }

    return next.handle();
  }
}
