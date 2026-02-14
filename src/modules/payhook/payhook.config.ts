import { DataSourceOptions } from 'typeorm';
import {
  StorageAdapter,
  PaymentProviderAdapter,
  EventDispatcher,
  LifecycleHooks,
} from '../../core';

/**
 * PayHook Module Configuration
 */
export interface PayHookModuleConfig {
  /**
   * Storage configuration
   */
  storage: {
    type: 'mock' | 'typeorm' | 'custom';
    options?: DataSourceOptions;
    adapter?: StorageAdapter;
  };

  /**
   * Provider configurations
   *
   * Unified configuration that handles all provider authentication patterns:
   * - Some providers use same key for webhooks and API (Paystack)
   * - Some use separate keys (Stripe, Flutterwave)
   * - All support key rotation via arrays
   */
  providers: Array<{
    /**
     * Unique provider identifier
     */
    name: string;

    /**
     * Provider adapter instance or name
     */
    adapter:
      | PaymentProviderAdapter
      | 'mock'
      | 'paystack'
      | 'stripe'
      | 'flutterwave';

    /**
     * Authentication keys configuration
     *
     * This unified structure handles all provider patterns:
     * - Paystack: secretKey is used for both webhooks and API
     * - Stripe: secretKey for API, webhookSecret for webhooks
     * - Flutterwave: secretKey for API, webhookSecret for webhooks
     */
    keys: {
      /**
       * Secret/Private key for API operations
       * Examples:
       * - Paystack: sk_test_xxx or sk_live_xxx
       * - Stripe: sk_test_xxx or sk_live_xxx
       * - Flutterwave: FLWSECK_TEST-xxx or FLWSECK-xxx
       */
      secretKey: string;

      /**
       * Public/Publishable key for frontend operations (optional)
       * Examples:
       * - Paystack: pk_test_xxx or pk_live_xxx
       * - Stripe: pk_test_xxx or pk_live_xxx
       * - Flutterwave: FLWPUBK_TEST-xxx or FLWPUBK-xxx
       */
      publicKey?: string;

      /**
       * Webhook signature verification secret(s)
       * - If not provided, secretKey will be used (Paystack pattern)
       * - If provided, this will be used instead (Stripe pattern)
       * - Array supports key rotation (try each until one matches)
       *
       * Examples:
       * - Paystack: Not needed (uses secretKey)
       * - Stripe: ['whsec_xxx', 'whsec_old_xxx']
       * - Flutterwave: ['webhook_hash_xxx']
       */
      webhookSecret?: string | string[];

      /**
       * Previous keys for rotation period (optional)
       * During key rotation, both old and new keys are accepted
       */
      previousKeys?: {
        secretKey?: string;
        webhookSecret?: string | string[];
      };
    };

    /**
     * Provider-specific options
     */
    options?: {
      /**
       * API base URL (for custom/sandbox environments)
       * Default: Provider's production URL
       */
      apiUrl?: string;

      /**
       * Timeout for API calls in milliseconds
       * Default: 30000 (30 seconds)
       */
      apiTimeout?: number;

      /**
       * Enable test mode (auto-detected from keys if not specified)
       * Default: Detected from key prefix (sk_test_, pk_test_, etc.)
       */
      testMode?: boolean;

      /**
       * Additional provider-specific options
       */
      [key: string]: any;
    };
  }>;

  /**
   * Event configuration
   */
  events?: {
    dispatcher?: EventDispatcher;
    enableLogging?: boolean;
    enableMetrics?: boolean;
    handlers?: Array<{
      eventType: string;
      handler: (eventType: string, payload: any) => Promise<void>;
    }>;
  };

  /**
   * Webhook processing configuration
   */
  webhooks?: {
    skipSignatureVerification?: boolean;
    storeRawPayload?: boolean;
    redactKeys?: string[];
    timeoutMs?: number;
    autoCreateTransactions?: boolean;
  };

  /**
   * Lifecycle hooks
   */
  hooks?: LifecycleHooks;

  /**
   * API configuration
   */
  api?: {
    prefix?: string;
    globalPrefix?: string;
    rawBodyLimit?: string;
    enableSwagger?: boolean;
  };

  /**
   * Outbox configuration
   */
  outbox?: {
    enabled?: boolean;
    pollIntervalMs?: number;
    batchSize?: number;
    maxRetries?: number;
  };

  /**
   * Environment-specific settings
   */
  environment?: 'development' | 'staging' | 'production';
  debug?: boolean;
}

/**
 * Async configuration factory
 */
export interface PayHookModuleAsyncConfig {
  imports?: any[];
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<PayHookModuleConfig> | PayHookModuleConfig;
}

/**
 * Default configuration values
 */
export const defaultPayHookConfig: Partial<PayHookModuleConfig> = {
  webhooks: {
    skipSignatureVerification: false,
    storeRawPayload: true,
    redactKeys: [
      'password',
      'secret',
      'token',
      'api_key',
      'card_number',
      'cvv',
    ],
    timeoutMs: 30000,
    autoCreateTransactions: false,
  },
  api: {
    prefix: '/webhooks',
    rawBodyLimit: '10mb',
    enableSwagger: true,
  },
  outbox: {
    enabled: false,
    pollIntervalMs: 5000,
    batchSize: 100,
    maxRetries: 3,
  },
  environment: 'development',
  debug: false,
};
