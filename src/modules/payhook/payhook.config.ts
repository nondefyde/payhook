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
   */
  providers: Array<{
    name: string;
    adapter: PaymentProviderAdapter | 'mock' | 'paystack';
    secrets: string[];
    options?: Record<string, any>;
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
