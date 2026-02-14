import { Module, DynamicModule, Global } from '@nestjs/common';
import { PayHookRateLimitGuard } from './rate-limit.guard';
import { PayHookBodySizeGuard } from './body-size.guard';
import { PayHookIpAllowlistGuard } from './ip-allowlist.guard';
import { PayHookSecurityGuard } from './security.guard';

/**
 * PayHook Middleware Configuration
 */
export interface PayHookMiddlewareConfig {
  /**
   * Rate limiting configuration
   */
  rateLimit?: {
    enabled?: boolean;
    windowMs?: number;
    maxRequests?: number;
    keyGenerator?: (req: any) => string;
  };

  /**
   * Body size validation configuration
   */
  bodySize?: {
    enabled?: boolean;
    maxBodySize?: number;
    checkContentLength?: boolean;
  };

  /**
   * IP allowlist configuration
   */
  ipAllowlist?: {
    enabled?: boolean;
    allowedIps?: string[];
    checkProxyHeaders?: boolean;
    denyMessage?: string;
    providerIpMappings?: Record<string, string[]>;
  };

  /**
   * Provider-specific configurations
   */
  providers?: {
    paystack?: {
      allowedIps?: string[];
    };
    stripe?: {
      allowedIps?: string[];
    };
    flutterwave?: {
      allowedIps?: string[];
    };
    [key: string]: {
      allowedIps?: string[];
    } | undefined;
  };
}

/**
 * PayHook Middleware Module
 *
 * Provides optional security middleware for webhook endpoints.
 *
 * Usage:
 * ```typescript
 * @Module({
 *   imports: [
 *     PayHookMiddlewareModule.forRoot({
 *       rateLimit: {
 *         enabled: true,
 *         windowMs: 60000,
 *         maxRequests: 100,
 *       },
 *       bodySize: {
 *         enabled: true,
 *         maxBodySize: 1048576, // 1MB
 *       },
 *       ipAllowlist: {
 *         enabled: true,
 *         allowedIps: ['192.168.1.0/24'],
 *         providerIpMappings: {
 *           paystack: ['52.31.139.75', '52.49.173.169', '52.214.14.220'],
 *         },
 *       },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class PayHookMiddlewareModule {
  static forRoot(config?: PayHookMiddlewareConfig): DynamicModule {
    // Build provider IP mappings
    const providerIpMappings: Record<string, string[]> = {};

    if (config?.providers) {
      for (const [provider, providerConfig] of Object.entries(config.providers)) {
        if (providerConfig?.allowedIps) {
          providerIpMappings[provider] = providerConfig.allowedIps;
        }
      }
    }

    // Merge with ipAllowlist providerIpMappings
    if (config?.ipAllowlist?.providerIpMappings) {
      Object.assign(providerIpMappings, config.ipAllowlist.providerIpMappings);
    }

    // Create guard providers
    const providers = [
      {
        provide: PayHookRateLimitGuard,
        useFactory: () => new PayHookRateLimitGuard(config?.rateLimit),
      },
      {
        provide: PayHookBodySizeGuard,
        useFactory: () => new PayHookBodySizeGuard(config?.bodySize),
      },
      {
        provide: PayHookIpAllowlistGuard,
        useFactory: () => new PayHookIpAllowlistGuard({
          ...config?.ipAllowlist,
          providerIpMappings,
        }),
      },
      {
        provide: PayHookSecurityGuard,
        useFactory: (
          rateLimitGuard: PayHookRateLimitGuard,
          bodySizeGuard: PayHookBodySizeGuard,
          ipAllowlistGuard: PayHookIpAllowlistGuard,
        ) => {
          // Create combined guard with injected instances
          return new PayHookSecurityGuard({
            rateLimit: config?.rateLimit,
            bodySize: config?.bodySize,
            ipAllowlist: {
              ...config?.ipAllowlist,
              providerIpMappings,
            },
            enabled: {
              rateLimit: config?.rateLimit?.enabled,
              bodySize: config?.bodySize?.enabled,
              ipAllowlist: config?.ipAllowlist?.enabled,
            },
          });
        },
        inject: [PayHookRateLimitGuard, PayHookBodySizeGuard, PayHookIpAllowlistGuard],
      },
      {
        provide: 'PAYHOOK_MIDDLEWARE_CONFIG',
        useValue: config || {},
      },
    ];

    return {
      module: PayHookMiddlewareModule,
      providers,
      exports: [
        PayHookRateLimitGuard,
        PayHookBodySizeGuard,
        PayHookIpAllowlistGuard,
        PayHookSecurityGuard,
        'PAYHOOK_MIDDLEWARE_CONFIG',
      ],
    };
  }

  static forRootAsync(options: {
    imports?: any[];
    useFactory: (...args: any[]) => Promise<PayHookMiddlewareConfig> | PayHookMiddlewareConfig;
    inject?: any[];
  }): DynamicModule {
    const configProvider = {
      provide: 'PAYHOOK_MIDDLEWARE_CONFIG',
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    const guardProviders = [
      {
        provide: PayHookRateLimitGuard,
        useFactory: (config: PayHookMiddlewareConfig) => new PayHookRateLimitGuard(config?.rateLimit),
        inject: ['PAYHOOK_MIDDLEWARE_CONFIG'],
      },
      {
        provide: PayHookBodySizeGuard,
        useFactory: (config: PayHookMiddlewareConfig) => new PayHookBodySizeGuard(config?.bodySize),
        inject: ['PAYHOOK_MIDDLEWARE_CONFIG'],
      },
      {
        provide: PayHookIpAllowlistGuard,
        useFactory: (config: PayHookMiddlewareConfig) => {
          // Build provider IP mappings
          const providerIpMappings: Record<string, string[]> = {};

          if (config?.providers) {
            for (const [provider, providerConfig] of Object.entries(config.providers)) {
              if (providerConfig?.allowedIps) {
                providerIpMappings[provider] = providerConfig.allowedIps;
              }
            }
          }

          if (config?.ipAllowlist?.providerIpMappings) {
            Object.assign(providerIpMappings, config.ipAllowlist.providerIpMappings);
          }

          return new PayHookIpAllowlistGuard({
            ...config?.ipAllowlist,
            providerIpMappings,
          });
        },
        inject: ['PAYHOOK_MIDDLEWARE_CONFIG'],
      },
      {
        provide: PayHookSecurityGuard,
        useFactory: (config: PayHookMiddlewareConfig) => {
          const providerIpMappings: Record<string, string[]> = {};

          if (config?.providers) {
            for (const [provider, providerConfig] of Object.entries(config.providers)) {
              if (providerConfig?.allowedIps) {
                providerIpMappings[provider] = providerConfig.allowedIps;
              }
            }
          }

          if (config?.ipAllowlist?.providerIpMappings) {
            Object.assign(providerIpMappings, config.ipAllowlist.providerIpMappings);
          }

          return new PayHookSecurityGuard({
            rateLimit: config?.rateLimit,
            bodySize: config?.bodySize,
            ipAllowlist: {
              ...config?.ipAllowlist,
              providerIpMappings,
            },
            enabled: {
              rateLimit: config?.rateLimit?.enabled,
              bodySize: config?.bodySize?.enabled,
              ipAllowlist: config?.ipAllowlist?.enabled,
            },
          });
        },
        inject: ['PAYHOOK_MIDDLEWARE_CONFIG'],
      },
    ];

    return {
      module: PayHookMiddlewareModule,
      imports: options.imports || [],
      providers: [configProvider, ...guardProviders],
      exports: [
        PayHookRateLimitGuard,
        PayHookBodySizeGuard,
        PayHookIpAllowlistGuard,
        PayHookSecurityGuard,
        'PAYHOOK_MIDDLEWARE_CONFIG',
      ],
    };
  }
}

/**
 * Known provider IP addresses (for reference)
 *
 * These are example IPs - always verify with your provider's documentation
 */
export const KNOWN_PROVIDER_IPS = {
  paystack: [
    '52.31.139.75',
    '52.49.173.169',
    '52.214.14.220',
  ],
  stripe: [
    // Stripe publishes their webhook IPs dynamically
    // See: https://stripe.com/docs/ips
  ],
  flutterwave: [
    // Flutterwave IPs - verify with documentation
  ],
  // Add more providers as needed
};