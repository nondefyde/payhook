import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

/**
 * PayHook Rate Limit Guard
 *
 * Protects webhook endpoints from being overwhelmed by too many requests.
 * Implements a sliding window rate limiting strategy.
 *
 * Usage:
 * @UseGuards(PayHookRateLimitGuard)
 *
 * Configuration via constructor or module config:
 * - windowMs: Time window in milliseconds
 * - maxRequests: Maximum requests per window
 * - keyGenerator: Function to generate rate limit key (default: IP address)
 */
@Injectable()
export class PayHookRateLimitGuard implements CanActivate {
  private readonly requestCounts = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly keyGenerator: (req: Request) => string;

  constructor(config?: {
    windowMs?: number;
    maxRequests?: number;
    keyGenerator?: (req: Request) => string;
  }) {
    this.windowMs = config?.windowMs || 60000; // 1 minute default
    this.maxRequests = config?.maxRequests || 100; // 100 requests per window default
    this.keyGenerator = config?.keyGenerator || ((req) => {
      // Default: Use IP address as key
      const forwarded = req.headers['x-forwarded-for'] as string;
      return forwarded?.split(',')[0] || req.connection.remoteAddress || 'unknown';
    });

    // Clean up expired entries periodically
    setInterval(() => this.cleanup(), this.windowMs);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = this.keyGenerator(request);
    const now = Date.now();

    // Get or create rate limit entry
    let entry = this.requestCounts.get(key);

    if (!entry || now > entry.resetAt) {
      // New window
      entry = {
        count: 1,
        resetAt: now + this.windowMs,
      };
      this.requestCounts.set(key, entry);

      // Add rate limit headers
      this.setRateLimitHeaders(request, entry);
      return true;
    }

    // Check if limit exceeded
    if (entry.count >= this.maxRequests) {
      // Add rate limit headers
      this.setRateLimitHeaders(request, entry);

      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
        error: 'Too Many Requests',
        retryAfter,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Increment counter
    entry.count++;

    // Add rate limit headers
    this.setRateLimitHeaders(request, entry);
    return true;
  }

  /**
   * Set rate limit headers on response
   */
  private setRateLimitHeaders(request: any, entry: { count: number; resetAt: number }): void {
    const remaining = Math.max(0, this.maxRequests - entry.count);
    const resetAt = new Date(entry.resetAt);

    // Store headers to be set on response
    request.rateLimitHeaders = {
      'X-RateLimit-Limit': this.maxRequests.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': resetAt.toISOString(),
    };
  }

  /**
   * Clean up expired entries to prevent memory leak
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requestCounts.entries()) {
      if (now > entry.resetAt + this.windowMs) {
        this.requestCounts.delete(key);
      }
    }
  }

  /**
   * Reset rate limit for a specific key (useful for testing)
   */
  reset(key?: string): void {
    if (key) {
      this.requestCounts.delete(key);
    } else {
      this.requestCounts.clear();
    }
  }

  /**
   * Get current rate limit status for a key
   */
  getStatus(key: string): { count: number; remaining: number; resetAt: Date } | null {
    const entry = this.requestCounts.get(key);
    if (!entry) {
      return null;
    }

    return {
      count: entry.count,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetAt: new Date(entry.resetAt),
    };
  }
}