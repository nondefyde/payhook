/**
 * PayHook - Transaction Truth Engine
 *
 * A database and provider agnostic library for converting payment webhooks
 * into verified, deduplicated, normalized transaction facts.
 */

// Export all core components
export * from './core';

// Export testing utilities from _shared
export {
  MockWebhookFactory,
  WebhookScenarios,
} from './_shared/testing/mock-webhook-factory';
export type {
  WebhookOptions,
  WebhookPayload,
} from './_shared/testing/mock-webhook-factory';

// Export adapters
export * from './adapters/storage/mock';
export * from './adapters/storage/typeorm';
export * from './adapters/providers/mock';
export * from './adapters/providers/paystack';

// Export NestJS modules
export { PayHookModule } from './modules/payhook/payhook.module';
export { PayHookService } from './modules/payhook/services/payhook.service';
export { TransactionService } from './core/services/transaction.service';

// Export constants for dependency injection
export {
  STORAGE_ADAPTER,
  EVENT_DISPATCHER,
  PROVIDER_ADAPTERS,
  PROVIDER_SECRETS,
  PAYHOOK_CONFIG,
  TRANSACTION_SERVICE,
  WEBHOOK_PROCESSOR,
  PAYHOOK_SERVICE,
  TRANSACTION_STATE_MACHINE,
} from './modules/payhook/constants';

// Export controllers (if needed for custom implementations)
export { WebhookController } from './modules/payhook/controllers/webhook.controller';
export { TransactionController } from './modules/payhook/controllers/transaction.controller';

// Export guards and middleware
export { PayHookIpAllowlistGuard } from './modules/payhook/middleware/ip-allowlist.guard';
export { PayHookRateLimitGuard } from './modules/payhook/middleware/rate-limit.guard';
export { PayHookBodySizeGuard } from './modules/payhook/middleware/body-size.guard';
export { PayHookSecurityGuard } from './modules/payhook/middleware/security.guard';

// Export decorators
export {
  WebhookEndpoint,
  TransactionQuery,
  PaginatedQuery,
  CreateTransactionDocs,
  MarkAsProcessingDocs,
  ReconciliationDocs,
  HealthCheckDocs,
  StatisticsDocs,
} from './modules/payhook/decorators/webhook.decorators';

// Export configuration types
export type {
  PayHookModuleConfig,
  PayHookModuleAsyncConfig,
} from './modules/payhook/payhook.config';

// Export default configuration
export { defaultPayHookConfig } from './modules/payhook/payhook.config';

// Export interceptors (for raw body handling)
export { RawBodyInterceptor } from './modules/payhook/interceptors/raw-body.interceptor';

// Export TypeORM entities
export * from './adapters/storage/typeorm/entities';
