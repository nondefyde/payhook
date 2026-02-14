import {
  NormalizedWebhookEvent,
  ProviderVerificationResult,
} from './common.types';

/**
 * Payment provider adapter interface - abstracts provider-specific logic
 * Each provider implementation handles signature verification, normalization, and API calls
 */
export interface PaymentProviderAdapter {
  /**
   * Unique identifier for this provider (e.g., 'paystack', 'stripe')
   */
  readonly providerName: string;

  /**
   * Supported webhook event types for this provider
   * Used for validation and documentation
   */
  readonly supportedEvents: string[];

  /**
   * Provider-specific configuration (e.g., API endpoints, timeout settings)
   */
  readonly config: ProviderConfig;

  // ==================== Webhook Processing ====================

  /**
   * Verify webhook signature using provider-specific algorithm
   * @param rawBody - Raw request body (Buffer)
   * @param headers - HTTP headers including signature
   * @param secrets - Array of secrets to try (supports rotation)
   * @returns true if signature is valid
   */
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secrets: string[],
  ): boolean;

  /**
   * Parse and validate the raw webhook payload
   * @param rawBody - Raw request body
   * @returns Parsed payload or throws if invalid
   */
  parsePayload(rawBody: Buffer): Record<string, any>;

  /**
   * Normalize provider-specific event to PayHook schema
   * @param rawPayload - Provider's raw webhook payload
   * @returns Normalized event or throws NormalizationError
   */
  normalize(rawPayload: Record<string, any>): NormalizedWebhookEvent;

  /**
   * Extract idempotency key from webhook payload
   * Used for deduplication
   */
  extractIdempotencyKey(rawPayload: Record<string, any>): string;

  /**
   * Extract transaction references from webhook payload
   * @returns Provider reference and optional application reference
   */
  extractReferences(rawPayload: Record<string, any>): {
    providerRef: string;
    applicationRef?: string;
  };

  /**
   * Get the provider's event type from raw payload
   */
  extractEventType(rawPayload: Record<string, any>): string;

  /**
   * Check if an event type indicates a successful payment
   */
  isSuccessEvent(eventType: string): boolean;

  /**
   * Check if an event type indicates a failed payment
   */
  isFailureEvent(eventType: string): boolean;

  /**
   * Check if an event type indicates a refund
   */
  isRefundEvent(eventType: string): boolean;

  /**
   * Check if an event type indicates a dispute
   */
  isDisputeEvent(eventType: string): boolean;

  // ==================== API Verification (Optional) ====================

  /**
   * Verify transaction status with provider's API
   * Not all providers support this - return null if unsupported
   * @param providerRef - Provider's transaction reference
   * @param options - Additional options (e.g., API keys if not in config)
   * @returns Verification result or null if not supported
   */
  verifyWithProvider?(
    providerRef: string,
    options?: VerifyOptions,
  ): Promise<ProviderVerificationResult | null>;

  /**
   * Fetch transaction details from provider's API
   * More detailed than verification - includes full transaction data
   */
  fetchTransaction?(
    providerRef: string,
    options?: FetchOptions,
  ): Promise<ProviderTransaction | null>;

  /**
   * Initiate a refund through provider's API
   * Not required for webhook processing but useful for full integration
   */
  initiateRefund?(
    providerRef: string,
    amount: number,
    reason?: string,
    options?: RefundOptions,
  ): Promise<ProviderRefundResult | null>;

  // ==================== Provider-Specific Helpers ====================

  /**
   * Validate provider-specific metadata or configuration
   * Called during adapter initialization
   */
  validateConfig(config: Record<string, any>): boolean;

  /**
   * Transform provider error to standardized format
   */
  transformError(error: any): ProviderError;

  /**
   * Get provider-specific headers for API calls
   */
  getApiHeaders(secrets: string[]): Record<string, string>;

  /**
   * Check if provider is in test mode based on config or webhook
   */
  isTestMode(rawPayload?: Record<string, any>): boolean;

  /**
   * Get webhook URL path for this provider
   * Used for routing (e.g., '/webhooks/paystack')
   */
  getWebhookPath(): string;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiBaseUrl?: string;
  webhookPath?: string;
  timeout?: number;
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
  };
  testMode?: boolean;
  customHeaders?: Record<string, string>;
}

/**
 * Provider API credentials for authentication
 */
export interface ProviderApiCredentials {
  /**
   * Secret/Private key for API authentication
   * - Paystack: sk_test_xxx or sk_live_xxx
   * - Stripe: sk_test_xxx or sk_live_xxx
   * - Flutterwave: FLWSECK_xxx
   */
  secretKey?: string;

  /**
   * Public key (if required by provider)
   * - Paystack: pk_test_xxx or pk_live_xxx
   * - Stripe: pk_test_xxx or pk_live_xxx
   * - Flutterwave: FLWPUBK_xxx
   */
  publicKey?: string;

  /**
   * Additional provider-specific credentials
   */
  [key: string]: string | undefined;
}

/**
 * Options for API verification
 */
export interface VerifyOptions {
  /**
   * @deprecated Use apiCredentials in provider configuration instead
   */
  apiKey?: string;
  timeout?: number;
  retryOnFailure?: boolean;
}

/**
 * Options for fetching transaction
 */
export interface FetchOptions extends VerifyOptions {
  includeCustomer?: boolean;
  includeTimeline?: boolean;
}

/**
 * Options for refund
 */
export interface RefundOptions extends VerifyOptions {
  metadata?: Record<string, any>;
}

/**
 * Provider transaction details
 */
export interface ProviderTransaction {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: Date;
  paidAt?: Date;
  customer?: {
    email?: string;
    id?: string;
    metadata?: Record<string, any>;
  };
  metadata?: Record<string, any>;
  timeline?: Array<{
    event: string;
    timestamp: Date;
    details?: Record<string, any>;
  }>;
}

/**
 * Provider refund result
 */
export interface ProviderRefundResult {
  reference: string;
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed';
  reason?: string;
  createdAt: Date;
}

/**
 * Standardized provider error
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public providerName: string,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Normalization error - when webhook cannot be normalized
 */
export class NormalizationError extends Error {
  constructor(
    message: string,
    public providerName: string,
    public eventType: string,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'NormalizationError';
  }
}
