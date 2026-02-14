import { StorageAdapter } from './storage.adapter';
import { PaymentProviderAdapter } from './payment-provider.adapter';
import { EventDispatcher } from './event-dispatcher.interface';

/**
 * Main PayHook configuration
 */
export interface PayHookConfig {
  /**
   * Storage adapter configuration
   */
  storage: StorageConfig;

  /**
   * Payment provider configurations
   */
  providers: ProvidersConfig;

  /**
   * Event dispatcher configuration
   */
  events?: EventConfig;

  /**
   * Webhook processing configuration
   */
  webhooks?: WebhookConfig;

  /**
   * Data retention configuration
   */
  retention?: RetentionConfig;

  /**
   * Outbox pattern configuration (optional feature)
   */
  outbox?: OutboxConfig;

  /**
   * Lifecycle hooks for monitoring and metrics
   */
  hooks?: LifecycleHooks;

  /**
   * Security configuration
   */
  security?: SecurityConfig;

  /**
   * Logging configuration
   */
  logging?: LoggingConfig;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /**
   * Storage adapter instance or factory
   */
  adapter: StorageAdapter | (() => StorageAdapter);

  /**
   * Whether to run migrations automatically on startup
   */
  autoMigrate?: boolean;

  /**
   * Connection pool configuration
   */
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMillis?: number;
  };

  /**
   * Transaction timeout in milliseconds
   */
  transactionTimeout?: number;

  /**
   * Whether to store raw webhook payloads
   */
  storeRawPayload?: boolean;

  /**
   * Keys to redact from raw payloads before storage
   */
  redactKeys?: string[];
}

/**
 * Providers configuration
 */
export interface ProvidersConfig {
  [providerName: string]: ProviderInstanceConfig;
}

/**
 * Individual provider configuration
 */
export interface ProviderInstanceConfig {
  /**
   * Provider adapter instance or factory
   */
  adapter: PaymentProviderAdapter | (() => PaymentProviderAdapter);

  /**
   * Provider secrets (supports multiple for rotation)
   */
  secrets: string[];

  /**
   * Provider-specific options
   */
  options?: Record<string, any>;

  /**
   * Whether this provider is enabled
   */
  enabled?: boolean;
}

/**
 * Event configuration
 */
export interface EventConfig {
  /**
   * Custom event dispatcher instance
   */
  dispatcher?: EventDispatcher;

  /**
   * Default timeout for event handlers (ms)
   */
  handlerTimeout?: number;

  /**
   * Default retry configuration for failed handlers
   */
  retryConfig?: {
    maxRetries?: number;
    retryDelay?: number;
    backoffMultiplier?: number;
  };

  /**
   * Whether to wait for all handlers to complete before responding
   */
  waitForHandlers?: boolean;

  /**
   * Whether to stop processing on first handler error
   */
  stopOnError?: boolean;
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  /**
   * Base path for webhook endpoints
   */
  basePath?: string;

  /**
   * Maximum webhook payload size
   */
  maxPayloadSize?: string;

  /**
   * Request timeout for webhook processing (ms)
   */
  timeout?: number;

  /**
   * Whether to validate webhook timestamps
   */
  validateTimestamp?: boolean;

  /**
   * Maximum age for webhook timestamps (seconds)
   */
  maxTimestampAge?: number;

  /**
   * IP allowlist for webhook sources
   */
  ipAllowlist?: string[];

  /**
   * Rate limiting configuration
   */
  rateLimit?: {
    windowMs?: number;
    maxRequests?: number;
    keyGenerator?: (req: any) => string;
  };
}

/**
 * Data retention configuration
 */
export interface RetentionConfig {
  /**
   * Webhook log retention in days
   */
  webhookLogDays?: number;

  /**
   * Dispatch log retention in days
   */
  dispatchLogDays?: number;

  /**
   * Audit log retention in days (often kept longer for compliance)
   */
  auditLogDays?: number;

  /**
   * Outbox event retention in days (for processed events)
   */
  outboxEventDays?: number;

  /**
   * Whether to automatically run cleanup
   */
  autoCleanup?: boolean;

  /**
   * Cleanup schedule (cron expression)
   */
  cleanupSchedule?: string;
}

/**
 * Outbox configuration
 */
export interface OutboxConfig {
  /**
   * Whether outbox pattern is enabled
   */
  enabled: boolean;

  /**
   * Maximum events to process in a single batch
   */
  batchSize?: number;

  /**
   * Polling interval for outbox processor (ms)
   */
  pollingInterval?: number;

  /**
   * Maximum retries for failed outbox events
   */
  maxRetries?: number;

  /**
   * Stale event threshold in minutes
   */
  staleThresholdMinutes?: number;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  /**
   * Whether to enforce signature verification (should always be true in production)
   */
  enforceSignatureVerification?: boolean;

  /**
   * Whether to use timing-safe comparison for signatures
   */
  timingSafeComparison?: boolean;

  /**
   * Secret rotation grace period (ms)
   */
  secretRotationGracePeriod?: number;

  /**
   * Whether to log security violations
   */
  logSecurityViolations?: boolean;

  /**
   * Custom security headers to add to webhook responses
   */
  responseHeaders?: Record<string, string>;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /**
   * Log level
   */
  level?: 'error' | 'warn' | 'log' | 'debug' | 'verbose';

  /**
   * Whether to include sensitive data in logs
   */
  includeSensitiveData?: boolean;

  /**
   * Fields to exclude from logs
   */
  excludeFields?: string[];

  /**
   * Whether to log raw webhook payloads
   */
  logRawPayloads?: boolean;

  /**
   * Custom logger instance
   */
  logger?: Logger;
}

/**
 * Logger interface
 */
export interface Logger {
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  log(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  verbose(message: string, ...args: any[]): void;
}

/**
 * Lifecycle hooks for monitoring and metrics
 */
export interface LifecycleHooks {
  /**
   * Called when a webhook is received and its fate determined
   */
  onWebhookFate?: (event: WebhookFateEvent) => void | Promise<void>;

  /**
   * Called when a transaction transitions state
   */
  onTransition?: (event: TransitionEvent) => void | Promise<void>;

  /**
   * Called after event dispatch to handlers
   */
  onDispatchResult?: (event: DispatchResultEvent) => void | Promise<void>;

  /**
   * Called after reconciliation attempt
   */
  onReconciliation?: (event: ReconciliationEvent) => void | Promise<void>;

  /**
   * Called when an error occurs
   */
  onError?: (error: Error, context: ErrorContext) => void | Promise<void>;

  /**
   * Called periodically with metrics
   */
  onMetrics?: (metrics: PayHookMetrics) => void | Promise<void>;
}

/**
 * Webhook fate event
 */
export interface WebhookFateEvent {
  provider: string;
  processingStatus: string;
  eventType: string;
  latencyMs: number;
  transactionId?: string;
  error?: Error;
}

/**
 * Transition event
 */
export interface TransitionEvent {
  provider: string;
  transactionId: string;
  fromStatus: string | null;
  toStatus: string;
  triggerType: string;
  verificationMethod: string;
}

/**
 * Dispatch result event
 */
export interface DispatchResultEvent {
  eventType: string;
  handlerName: string;
  status: 'success' | 'failed' | 'skipped';
  isReplay: boolean;
  durationMs: number;
  error?: Error;
}

/**
 * Reconciliation event
 */
export interface ReconciliationEvent {
  provider: string;
  transactionId: string;
  applicationRef: string;
  result: string;
  latencyMs: number;
  divergence?: Record<string, any>;
}

/**
 * Error context
 */
export interface ErrorContext {
  operation: string;
  provider?: string;
  transactionId?: string;
  webhookLogId?: string;
  metadata?: Record<string, any>;
}

/**
 * PayHook metrics
 */
export interface PayHookMetrics {
  transactions: {
    total: number;
    byStatus: Record<string, number>;
    byProvider: Record<string, number>;
  };
  webhooks: {
    total: number;
    byFate: Record<string, number>;
    unmatched: number;
  };
  events: {
    dispatched: number;
    successful: number;
    failed: number;
  };
  performance: {
    webhookProcessingP50: number;
    webhookProcessingP95: number;
    webhookProcessingP99: number;
    eventDispatchP50: number;
    eventDispatchP95: number;
  };
}