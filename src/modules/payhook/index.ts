/**
 * PayHook NestJS Module
 *
 * Main module for integrating PayHook into NestJS applications
 */

// Main module
export { PayHookModule } from './payhook.module';

// Configuration
export { PayHookModuleConfig, PayHookModuleAsyncConfig, defaultPayHookConfig } from './payhook.config';

// Controllers
export { WebhookController } from './controllers/webhook.controller';
export { CleanWebhookController } from './controllers/webhook.controller.clean';
export { TransactionController } from './controllers/transaction.controller';
export { HealthController } from './controllers/health.controller';

// Services
export { PayHookService } from './services/payhook.service';
export { ConfigurationService } from './services/configuration.service';
export { OutboxProcessor } from './services/outbox.processor';

// Decorators
export * from './decorators/webhook.decorators';

// Interceptors
export { RawBodyInterceptor } from './interceptors/raw-body.interceptor';

// Middleware (Optional Security Guards)
export {
  PayHookRateLimitGuard,
  PayHookBodySizeGuard,
  PayHookIpAllowlistGuard,
  PayHookSecurityGuard,
  PayHookMiddlewareModule,
} from './middleware';