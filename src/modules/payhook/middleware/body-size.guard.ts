import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

/**
 * PayHook Body Size Guard
 *
 * Protects webhook endpoints from excessively large payloads.
 * Prevents memory exhaustion and potential DoS attacks.
 *
 * Usage:
 * @UseGuards(PayHookBodySizeGuard)
 *
 * Configuration via constructor or module config:
 * - maxBodySize: Maximum body size in bytes
 * - checkContentLength: Whether to check Content-Length header first
 */
@Injectable()
export class PayHookBodySizeGuard implements CanActivate {
  private readonly maxBodySize: number;
  private readonly checkContentLength: boolean;

  constructor(config?: {
    maxBodySize?: number;
    checkContentLength?: boolean;
  }) {
    this.maxBodySize = config?.maxBodySize || 1048576; // 1MB default
    this.checkContentLength = config?.checkContentLength !== false; // Default true
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Check Content-Length header first if enabled
    if (this.checkContentLength) {
      const contentLength = request.headers['content-length'];
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (!isNaN(size) && size > this.maxBodySize) {
          throw new HttpException({
            statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
            message: `Payload too large. Maximum size is ${this.formatBytes(this.maxBodySize)}.`,
            error: 'Payload Too Large',
            maxSize: this.maxBodySize,
            actualSize: size,
          }, HttpStatus.PAYLOAD_TOO_LARGE);
        }
      }
    }

    // Check actual body size if body is available
    if (request.body) {
      let bodySize = 0;

      if (Buffer.isBuffer(request.body)) {
        bodySize = request.body.length;
      } else if (typeof request.body === 'string') {
        bodySize = Buffer.byteLength(request.body);
      } else if (typeof request.body === 'object') {
        // Estimate size for JSON objects
        try {
          bodySize = Buffer.byteLength(JSON.stringify(request.body));
        } catch (error) {
          // If we can't stringify, allow it through (might be a special object)
          return true;
        }
      }

      if (bodySize > this.maxBodySize) {
        throw new HttpException({
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          message: `Payload too large. Maximum size is ${this.formatBytes(this.maxBodySize)}.`,
          error: 'Payload Too Large',
          maxSize: this.maxBodySize,
          actualSize: bodySize,
        }, HttpStatus.PAYLOAD_TOO_LARGE);
      }
    }

    return true;
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get current configuration
   */
  getConfig(): { maxBodySize: number; checkContentLength: boolean } {
    return {
      maxBodySize: this.maxBodySize,
      checkContentLength: this.checkContentLength,
    };
  }

  /**
   * Validate payload size without throwing (useful for pre-checks)
   */
  isValidSize(size: number): boolean {
    return size <= this.maxBodySize;
  }
}