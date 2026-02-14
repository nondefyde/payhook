import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { PayHookRateLimitGuard } from './rate-limit.guard';
import { PayHookBodySizeGuard } from './body-size.guard';
import { PayHookIpAllowlistGuard } from './ip-allowlist.guard';

/**
 * PayHook Security Guard
 *
 * Combines all security guards into a single guard for convenience.
 * Applies rate limiting, body size validation, and IP allowlisting.
 *
 * Usage:
 * @UseGuards(PayHookSecurityGuard)
 *
 * Or configure individually:
 * @UseGuards(PayHookRateLimitGuard, PayHookBodySizeGuard, PayHookIpAllowlistGuard)
 */
@Injectable()
export class PayHookSecurityGuard implements CanActivate {
  private readonly rateLimitGuard: PayHookRateLimitGuard;
  private readonly bodySizeGuard: PayHookBodySizeGuard;
  private readonly ipAllowlistGuard: PayHookIpAllowlistGuard;

  constructor(config?: {
    rateLimit?: {
      windowMs?: number;
      maxRequests?: number;
      keyGenerator?: (req: any) => string;
    };
    bodySize?: {
      maxBodySize?: number;
      checkContentLength?: boolean;
    };
    ipAllowlist?: {
      allowedIps?: string[];
      checkProxyHeaders?: boolean;
      denyMessage?: string;
      providerIpMappings?: Record<string, string[]>;
    };
    enabled?: {
      rateLimit?: boolean;
      bodySize?: boolean;
      ipAllowlist?: boolean;
    };
  }) {
    // Initialize individual guards with configuration
    this.rateLimitGuard = new PayHookRateLimitGuard(config?.rateLimit);
    this.bodySizeGuard = new PayHookBodySizeGuard(config?.bodySize);
    this.ipAllowlistGuard = new PayHookIpAllowlistGuard(config?.ipAllowlist);

    // Store enabled flags
    this.enabledGuards = {
      rateLimit: config?.enabled?.rateLimit !== false,
      bodySize: config?.enabled?.bodySize !== false,
      ipAllowlist: config?.enabled?.ipAllowlist !== false,
    };
  }

  private readonly enabledGuards: {
    rateLimit: boolean;
    bodySize: boolean;
    ipAllowlist: boolean;
  };

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Apply guards in order of performance impact (fastest first)

    // 1. Body size check (fast, prevents large payload processing)
    if (this.enabledGuards.bodySize) {
      const bodySizeResult = await this.bodySizeGuard.canActivate(context);
      if (!bodySizeResult) {
        return false;
      }
    }

    // 2. IP allowlist check (fast lookup)
    if (this.enabledGuards.ipAllowlist) {
      const ipResult = await this.ipAllowlistGuard.canActivate(context);
      if (!ipResult) {
        return false;
      }
    }

    // 3. Rate limit check (involves counter updates)
    if (this.enabledGuards.rateLimit) {
      const rateLimitResult = await this.rateLimitGuard.canActivate(context);
      if (!rateLimitResult) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get current configuration for all guards
   */
  getConfig(): {
    rateLimit: any;
    bodySize: any;
    ipAllowlist: any;
    enabled: any;
  } {
    return {
      rateLimit: this.rateLimitGuard.getConfig ? this.rateLimitGuard.getConfig() : {},
      bodySize: this.bodySizeGuard.getConfig(),
      ipAllowlist: this.ipAllowlistGuard.getConfig(),
      enabled: this.enabledGuards,
    };
  }

  /**
   * Enable or disable specific guards at runtime
   */
  setEnabled(guard: 'rateLimit' | 'bodySize' | 'ipAllowlist', enabled: boolean): void {
    this.enabledGuards[guard] = enabled;
  }
}