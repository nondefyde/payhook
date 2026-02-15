import { Injectable, Inject } from '@nestjs/common';
import type { PayHookModuleConfig } from '../payhook.config';
import { PAYHOOK_CONFIG } from '../constants';

/**
 * Configuration Service
 *
 * Provides access to PayHook configuration
 */
@Injectable()
export class ConfigurationService {
  constructor(
    @Inject(PAYHOOK_CONFIG)
    private readonly config: PayHookModuleConfig,
  ) {}

  /**
   * Get full configuration
   */
  getConfig(): PayHookModuleConfig {
    return this.config;
  }

  /**
   * Get webhook configuration
   */
  getWebhookConfig() {
    return this.config.webhooks;
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(providerName: string) {
    return this.config.providers.find((p) => p.name === providerName);
  }

  /**
   * Check if signature verification is enabled
   */
  isSignatureVerificationEnabled(): boolean {
    return !this.config.webhooks?.skipSignatureVerification;
  }

  /**
   * Check if raw payload storage is enabled
   */
  isRawPayloadStorageEnabled(): boolean {
    return this.config.webhooks?.storeRawPayload !== false;
  }

  /**
   * Get redacted keys
   */
  getRedactedKeys(): string[] {
    return this.config.webhooks?.redactKeys || [];
  }

  /**
   * Check if outbox is enabled
   */
  isOutboxEnabled(): boolean {
    return this.config.outbox?.enabled === true;
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugMode(): boolean {
    return this.config.debug === true;
  }

  /**
   * Get environment
   */
  getEnvironment(): string {
    return this.config.environment || 'development';
  }

  /**
   * Check if Swagger is enabled
   */
  isSwaggerEnabled(): boolean {
    return this.config.api?.enableSwagger !== false;
  }

  /**
   * Get webhook route path
   */
  getWebhookRoute(): string {
    return this.config.api?.routes?.webhooks || 'webhooks';
  }

  /**
   * Get transaction route path
   */
  getTransactionRoute(): string {
    return this.config.api?.routes?.transactions || 'transactions';
  }

  /**
   * Get global API prefix
   */
  getGlobalPrefix(): string | undefined {
    return this.config.api?.globalPrefix;
  }
}
