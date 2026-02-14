import * as crypto from 'crypto';
import {
  PaymentProviderAdapter,
  NormalizedWebhookEvent,
  NormalizedEventType,
  ProviderVerificationResult,
  VerifyOptions,
  ProviderConfig,
  ProviderApiCredentials,
  ProviderError,
} from '../../../core';

/**
 * Paystack Provider Adapter
 *
 * Handles Paystack webhook signature verification and event normalization.
 *
 * Authentication:
 * - Webhook Signature: HMAC-SHA512 using secret key
 * - API Calls: Bearer token using secret key
 *
 * Note: Paystack uses the same secret key for both webhook signatures
 * and API authentication, unlike some other providers.
 *
 * @see https://paystack.com/docs/payments/webhooks
 * @see https://paystack.com/docs/api/
 */
export class PaystackProviderAdapter implements PaymentProviderAdapter {
  readonly providerName = 'paystack';
  readonly config: ProviderConfig;
  private readonly secretKey?: string;
  private readonly publicKey?: string;
  private readonly webhookSecrets: string[];

  constructor(config?: {
    keys?: {
      secretKey: string;
      publicKey?: string;
      webhookSecret?: string | string[];
      previousKeys?: {
        secretKey?: string;
        webhookSecret?: string | string[];
      };
    };
    options?: ProviderConfig;
  }) {
    this.secretKey = config?.keys?.secretKey;
    this.publicKey = config?.keys?.publicKey;

    // For Paystack, webhook secret is the same as secret key if not explicitly provided
    const webhookSecrets: string[] = [];

    // Add current webhook secret(s) or fall back to secret key
    if (config?.keys?.webhookSecret) {
      const secrets = Array.isArray(config.keys.webhookSecret)
        ? config.keys.webhookSecret
        : [config.keys.webhookSecret];
      webhookSecrets.push(...secrets);
    } else if (config?.keys?.secretKey) {
      // Paystack pattern: use secret key for webhooks
      webhookSecrets.push(config.keys.secretKey);
    }

    // Add previous keys for rotation support
    if (config?.keys?.previousKeys?.webhookSecret) {
      const prevSecrets = Array.isArray(config.keys.previousKeys.webhookSecret)
        ? config.keys.previousKeys.webhookSecret
        : [config.keys.previousKeys.webhookSecret];
      webhookSecrets.push(...prevSecrets);
    } else if (config?.keys?.previousKeys?.secretKey) {
      webhookSecrets.push(config.keys.previousKeys.secretKey);
    }

    this.webhookSecrets = webhookSecrets.filter(Boolean);

    this.config = {
      apiBaseUrl: config?.options?.apiBaseUrl || 'https://api.paystack.co',
      webhookPath: config?.options?.webhookPath || '/webhooks/paystack',
      timeout: config?.options?.timeout || 30000,
      testMode: config?.options?.testMode ?? this.isTestKey(this.secretKey),
      retryConfig: config?.options?.retryConfig,
      customHeaders: config?.options?.customHeaders,
    };
  }

  readonly supportedEvents = [
    'charge.success',
    'charge.failed',
    'transfer.success',
    'transfer.failed',
    'transfer.reversed',
    'invoice.payment_failed',
    'invoice.update',
    'subscription.create',
    'subscription.disable',
    'subscription.expiring_cards',
    'subscription.not_renew',
    'paymentrequest.pending',
    'paymentrequest.success',
    'refund.failed',
    'refund.pending',
    'refund.processed',
    'refund.processing',
    'dispute.create',
    'dispute.remind',
    'dispute.resolve',
  ];

  /**
   * Check if key is a test key
   */
  private isTestKey(key?: string): boolean {
    if (!key) return false;
    return key.startsWith('sk_test_') || key.startsWith('pk_test_');
  }

  /**
   * Verify webhook signature using HMAC-SHA512
   * Paystack sends signature in 'x-paystack-signature' header
   *
   * Note: For Paystack, the webhook secret is the same as the secret key
   */
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secrets?: string[], // Optional, uses internal webhookSecrets if not provided
  ): boolean {
    const signature = headers['x-paystack-signature'];
    if (!signature) {
      return false;
    }

    // Use provided secrets or fall back to configured webhook secrets
    const secretsToTry =
      secrets && secrets.length > 0 ? secrets : this.webhookSecrets;

    if (!secretsToTry || secretsToTry.length === 0) {
      console.warn('PaystackProviderAdapter: No webhook secrets configured');
      return false;
    }

    // Try each secret until one matches (supports key rotation)
    for (const secret of secretsToTry) {
      const hash = crypto
        .createHmac('sha512', secret)
        .update(rawBody)
        .digest('hex');

      if (this.timingSafeEqual(hash, signature)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse Paystack webhook payload
   */
  parsePayload(rawBody: Buffer): Record<string, any> {
    try {
      const payload = JSON.parse(rawBody.toString());

      // Paystack webhooks have 'event' and 'data' structure
      if (!payload.event || !payload.data) {
        throw new Error('Invalid Paystack webhook structure');
      }

      return payload;
    } catch (error) {
      throw new Error(
        `Failed to parse Paystack payload: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Normalize Paystack event to unified schema
   */
  normalize(rawPayload: Record<string, any>): NormalizedWebhookEvent {
    const event = rawPayload.event;
    const data = rawPayload.data;

    // Map Paystack event to normalized event type
    const eventType = this.mapEventType(event);

    // Extract amount and currency
    const amount = data.amount || 0; // Paystack amounts are in kobo (NGN) or cents
    const currency = (data.currency || 'NGN').toUpperCase();

    // Extract references
    const providerRef = data.reference || data.id?.toString();
    const applicationRef =
      data.metadata?.order_id || data.metadata?.transaction_id;

    // Extract customer information
    const customer = this.extractCustomer(data);
    const metadata = this.extractMetadata(data);

    return {
      eventType,
      providerEventId: `${event}_${data.id || Date.now()}`,
      providerRef,
      amount,
      currency,
      applicationRef,
      providerTimestamp: data.created_at || data.createdAt,
      customerEmail: customer?.email,
      providerMetadata: {
        ...metadata,
        rawEvent: event,
        customer,
      },
    };
  }

  /**
   * Extract idempotency key from Paystack payload
   */
  extractIdempotencyKey(rawPayload: Record<string, any>): string {
    // Paystack doesn't have a specific idempotency key, but we can use
    // event + id combination for deduplication
    const event = rawPayload.event;
    const data = rawPayload.data;
    const id = data.id || data.reference;

    return `${event}_${id}`;
  }

  /**
   * Extract provider and application references
   */
  extractReferences(rawPayload: Record<string, any>): {
    providerRef: string;
    applicationRef?: string;
  } {
    const data = rawPayload.data;

    return {
      providerRef: data.reference || data.id?.toString() || '',
      applicationRef:
        data.metadata?.order_id ||
        data.metadata?.transaction_id ||
        data.metadata?.application_ref,
    };
  }

  /**
   * Extract event type from payload
   */
  extractEventType(rawPayload: Record<string, any>): string {
    return rawPayload.event || 'unknown';
  }

  /**
   * Check if event represents a successful payment
   */
  isSuccessEvent(eventType: string): boolean {
    return [
      'charge.success',
      'transfer.success',
      'paymentrequest.success',
    ].includes(eventType);
  }

  /**
   * Check if event represents a failed payment
   */
  isFailureEvent(eventType: string): boolean {
    return [
      'charge.failed',
      'transfer.failed',
      'invoice.payment_failed',
      'refund.failed',
    ].includes(eventType);
  }

  /**
   * Check if event is a refund event
   */
  isRefundEvent(eventType: string): boolean {
    return [
      'refund.pending',
      'refund.processing',
      'refund.processed',
      'refund.failed',
    ].includes(eventType);
  }

  /**
   * Check if event is a dispute event
   */
  isDisputeEvent(eventType: string): boolean {
    return ['dispute.create', 'dispute.remind', 'dispute.resolve'].includes(
      eventType,
    );
  }

  /**
   * Verify transaction with Paystack API
   *
   * Uses the secret key configured during initialization.
   * Falls back to options.apiKey for backward compatibility.
   */
  async verifyWithProvider?(
    providerRef: string,
    options?: VerifyOptions,
  ): Promise<ProviderVerificationResult | null> {
    // Use configured secret key, fall back to options for backward compatibility
    const secretKey = this.secretKey || options?.apiKey;

    if (!secretKey) {
      console.warn(
        'PaystackProviderAdapter: No secret key available for API verification. ' +
          'Configure keys.secretKey in provider configuration.',
      );
      return null;
    }

    try {
      const url = `${this.config.apiBaseUrl}/transaction/verify/${providerRef}`;
      const timeout = options?.timeout || this.config.timeout || 30000;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(
          `Paystack API error: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const result = await response.json();

      if (!result.status || !result.data) {
        return null;
      }

      const data = result.data;

      return {
        status: this.mapApiStatus(data.status),
        providerRef: data.reference,
        amount: data.amount,
        currency: data.currency || 'NGN',
        providerTimestamp: data.paid_at || data.created_at,
        metadata: {
          providerTransactionId: data.id?.toString(),
          customer: {
            email: data.customer?.email,
            id: data.customer?.customer_code,
          },
          rawData: data,
        },
      };
    } catch (error) {
      console.error('Failed to verify with Paystack:', error);
      return null;
    }
  }

  /**
   * Map Paystack event to normalized event type
   */
  private mapEventType(event: string): NormalizedEventType {
    const eventMap: Record<string, NormalizedEventType> = {
      'charge.success': NormalizedEventType.PAYMENT_SUCCESSFUL,
      'charge.failed': NormalizedEventType.PAYMENT_FAILED,
      'transfer.success': NormalizedEventType.PAYMENT_SUCCESSFUL,
      'transfer.failed': NormalizedEventType.PAYMENT_FAILED,
      'transfer.reversed': NormalizedEventType.PAYMENT_FAILED,
      'invoice.payment_failed': NormalizedEventType.PAYMENT_FAILED,
      'paymentrequest.pending': NormalizedEventType.PAYMENT_ABANDONED, // Pending state
      'paymentrequest.success': NormalizedEventType.PAYMENT_SUCCESSFUL,
      'refund.pending': NormalizedEventType.REFUND_PENDING,
      'refund.processing': NormalizedEventType.REFUND_PENDING,
      'refund.processed': NormalizedEventType.REFUND_SUCCESSFUL,
      'refund.failed': NormalizedEventType.REFUND_FAILED,
      'dispute.create': NormalizedEventType.CHARGE_DISPUTED,
      'dispute.remind': NormalizedEventType.CHARGE_DISPUTED,
      'dispute.resolve': NormalizedEventType.DISPUTE_RESOLVED,
      'subscription.create': NormalizedEventType.PAYMENT_SUCCESSFUL,
      'subscription.disable': NormalizedEventType.PAYMENT_ABANDONED,
      'subscription.not_renew': NormalizedEventType.PAYMENT_ABANDONED,
      'subscription.expiring_cards': NormalizedEventType.PAYMENT_FAILED,
      'invoice.update': NormalizedEventType.PAYMENT_FAILED,
    };

    return eventMap[event] || NormalizedEventType.PAYMENT_FAILED;
  }

  /**
   * Map Paystack API status to provider status
   */
  private mapApiStatus(
    status: string,
  ): 'success' | 'failed' | 'pending' | 'abandoned' {
    // Paystack statuses: success, failed, abandoned, pending
    const statusMap: Record<
      string,
      'success' | 'failed' | 'pending' | 'abandoned'
    > = {
      success: 'success',
      successful: 'success',
      failed: 'failed',
      abandoned: 'abandoned',
      pending: 'pending',
    };

    return statusMap[status.toLowerCase()] || 'failed';
  }

  /**
   * Extract customer information from Paystack data
   */
  private extractCustomer(data: any): any {
    if (data.customer) {
      return {
        id: data.customer.id || data.customer.customer_code,
        email: data.customer.email,
        name:
          data.customer.first_name && data.customer.last_name
            ? `${data.customer.first_name} ${data.customer.last_name}`
            : undefined,
        phone: data.customer.phone,
      };
    }

    if (data.email) {
      return { email: data.email };
    }

    return undefined;
  }

  /**
   * Extract metadata from Paystack data
   */
  private extractMetadata(data: any): Record<string, any> {
    return {
      ...data.metadata,
      gateway_response: data.gateway_response,
      channel: data.channel,
      ip_address: data.ip_address,
      fees: data.fees,
      authorization: data.authorization
        ? {
            auth_code: data.authorization.authorization_code,
            card_type: data.authorization.card_type,
            last4: data.authorization.last4,
            exp_month: data.authorization.exp_month,
            exp_year: data.authorization.exp_year,
            bank: data.authorization.bank,
          }
        : undefined,
    };
  }

  /**
   * Timing-safe string comparison
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);

    return crypto.timingSafeEqual(bufferA, bufferB);
  }

  /**
   * Validate provider-specific configuration
   */
  validateConfig(config: Record<string, any>): boolean {
    // Check for required keys
    if (!config.keys) {
      return false;
    }

    // Must have either secretKey or webhookSecret
    if (!config.keys.secretKey && !config.keys.webhookSecret) {
      return false;
    }

    // If API base URL is provided, it should be a valid URL
    if (config.options?.apiBaseUrl) {
      try {
        new URL(config.options.apiBaseUrl);
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Transform provider error to standardized format
   */
  transformError(error: any): ProviderError {
    if (error.response) {
      // HTTP error from API
      return new ProviderError(
        error.response.data?.message || error.message,
        `PAYSTACK_${error.response.status}`,
        this.providerName,
        {
          status: error.response.status,
          data: error.response.data,
        },
      );
    }

    if (error.code) {
      // Network or other error with code
      return new ProviderError(
        error.message,
        `PAYSTACK_${error.code}`,
        this.providerName,
        { originalError: error },
      );
    }

    // Generic error
    return new ProviderError(
      error.message || 'Unknown error',
      'PAYSTACK_UNKNOWN',
      this.providerName,
      { originalError: error },
    );
  }

  /**
   * Get provider-specific headers for API calls
   */
  getApiHeaders(secrets: string[]): Record<string, string> {
    const secretKey = secrets[0] || this.secretKey;

    if (!secretKey) {
      throw new Error('No secret key available for API authentication');
    }

    return {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Check if provider is in test mode
   */
  isTestMode(rawPayload?: Record<string, any>): boolean {
    // Check config first
    if (this.config.testMode !== undefined) {
      return this.config.testMode;
    }

    // Check if using test keys
    if (this.secretKey && this.isTestKey(this.secretKey)) {
      return true;
    }

    // Check payload for test mode indicator
    if (rawPayload?.data?.livemode !== undefined) {
      return !rawPayload.data.livemode;
    }

    return false;
  }

  /**
   * Get webhook URL path for this provider
   */
  getWebhookPath(): string {
    return this.config.webhookPath || '/webhooks/paystack';
  }
}
