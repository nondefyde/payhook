import * as crypto from 'crypto';
import {
  PaymentProviderAdapter,
  ProviderConfig,
  NormalizedWebhookEvent,
  ProviderVerificationResult,
  VerifyOptions,
  FetchOptions,
  RefundOptions,
  ProviderTransaction,
  ProviderRefundResult,
  ProviderError,
  NormalizationError,
  NormalizedEventType,
  TransactionStatus,
} from '../../../core';

/**
 * Mock payment provider adapter for testing
 * Provides deterministic webhook generation and verification
 */
export class MockProviderAdapter implements PaymentProviderAdapter {
  readonly providerName = 'mock';
  readonly supportedEvents = [
    'payment.success',
    'payment.failed',
    'payment.processing',
    'refund.success',
    'refund.failed',
    'refund.partial',
    'dispute.created',
    'dispute.resolved',
  ];

  readonly config: ProviderConfig;

  // Mock data storage for verification
  private mockTransactions: Map<string, MockTransaction> = new Map();
  private eventCounter = 0;

  constructor(config: Partial<ProviderConfig> = {}) {
    this.config = {
      apiBaseUrl: 'https://api.mock.payhook',
      webhookPath: '/webhooks/mock',
      timeout: 5000,
      testMode: true,
      ...config,
    };
  }

  /**
   * Verify webhook signature using HMAC-SHA256
   */
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secrets: string[],
  ): boolean {
    const signature = headers['x-mock-signature'];
    if (!signature) {
      return false;
    }

    // Try each secret
    for (const secret of secrets) {
      const expectedSignature = this.generateSignature(rawBody, secret);
      if (this.timingSafeEqual(signature, expectedSignature)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse webhook payload
   */
  parsePayload(rawBody: Buffer): Record<string, any> {
    try {
      return JSON.parse(rawBody.toString());
    } catch (error) {
      throw new Error('Invalid JSON payload');
    }
  }

  /**
   * Normalize mock webhook to PayHook schema
   */
  normalize(rawPayload: Record<string, any>): NormalizedWebhookEvent {
    const event = rawPayload.event;
    if (!event) {
      throw new NormalizationError(
        'Missing event field',
        this.providerName,
        'unknown',
      );
    }

    const eventType = this.mapEventType(event);
    if (!eventType) {
      throw new NormalizationError(
        `Unknown event type: ${event}`,
        this.providerName,
        event,
      );
    }

    const data = rawPayload.data || {};

    return {
      eventType,
      providerRef: data.reference || data.id,
      amount: data.amount || 0,
      currency: data.currency || 'USD',
      providerEventId: rawPayload.id || this.generateEventId(),
      applicationRef: data.metadata?.applicationRef,
      providerTimestamp: rawPayload.created_at || new Date().toISOString(),
      customerEmail: data.customer?.email,
      providerMetadata: {
        raw: rawPayload,
        mockData: true,
      },
    };
  }

  /**
   * Extract idempotency key
   */
  extractIdempotencyKey(rawPayload: Record<string, any>): string {
    return rawPayload.id || rawPayload.data?.id || this.generateEventId();
  }

  /**
   * Extract references
   */
  extractReferences(rawPayload: Record<string, any>): {
    providerRef: string;
    applicationRef?: string;
  } {
    const data = rawPayload.data || {};
    return {
      providerRef: data.reference || data.id || this.generateReference(),
      applicationRef: data.metadata?.applicationRef,
    };
  }

  /**
   * Extract event type
   */
  extractEventType(rawPayload: Record<string, any>): string {
    return rawPayload.event || 'unknown';
  }

  /**
   * Check event type classifications
   */
  isSuccessEvent(eventType: string): boolean {
    return eventType === 'payment.success';
  }

  isFailureEvent(eventType: string): boolean {
    return eventType === 'payment.failed';
  }

  isRefundEvent(eventType: string): boolean {
    return ['refund.success', 'refund.failed', 'refund.partial'].includes(
      eventType,
    );
  }

  isDisputeEvent(eventType: string): boolean {
    return ['dispute.created', 'dispute.resolved'].includes(eventType);
  }

  /**
   * Verify transaction with mock API
   */
  async verifyWithProvider(
    providerRef: string,
    options?: VerifyOptions,
  ): Promise<ProviderVerificationResult | null> {
    // Simulate network delay
    await this.simulateDelay();

    const transaction = this.mockTransactions.get(providerRef);
    if (!transaction) {
      return null;
    }

    return {
      status: this.mapStatusToVerification(transaction.status),
      providerRef: transaction.reference,
      amount: transaction.amount,
      currency: transaction.currency,
      providerTimestamp: transaction.createdAt,
      metadata: transaction.metadata,
    };
  }

  /**
   * Fetch transaction details
   */
  async fetchTransaction(
    providerRef: string,
    options?: FetchOptions,
  ): Promise<ProviderTransaction | null> {
    await this.simulateDelay();

    const transaction = this.mockTransactions.get(providerRef);
    if (!transaction) {
      return null;
    }

    return {
      reference: transaction.reference,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      createdAt: new Date(transaction.createdAt),
      paidAt: transaction.paidAt ? new Date(transaction.paidAt) : undefined,
      customer: options?.includeCustomer ? transaction.customer : undefined,
      metadata: transaction.metadata,
      timeline: options?.includeTimeline ? transaction.timeline : undefined,
    };
  }

  /**
   * Initiate refund
   */
  async initiateRefund(
    providerRef: string,
    amount: number,
    reason?: string,
    options?: RefundOptions,
  ): Promise<ProviderRefundResult | null> {
    await this.simulateDelay();

    const transaction = this.mockTransactions.get(providerRef);
    if (!transaction || transaction.status !== 'success') {
      return null;
    }

    const refundRef = `refund_${this.generateReference()}`;

    return {
      reference: refundRef,
      amount,
      currency: transaction.currency,
      status: 'success',
      reason,
      createdAt: new Date(),
    };
  }

  /**
   * Validate configuration
   */
  validateConfig(config: Record<string, any>): boolean {
    return true; // Mock always validates
  }

  /**
   * Transform error to standardized format
   */
  transformError(error: any): ProviderError {
    return new ProviderError(
      error.message || 'Mock provider error',
      'MOCK_ERROR',
      this.providerName,
      { originalError: error },
    );
  }

  /**
   * Get API headers
   */
  getApiHeaders(secrets: string[]): Record<string, string> {
    return {
      Authorization: `Bearer ${secrets[0]}`,
      'Content-Type': 'application/json',
      'X-Mock-Provider': 'true',
    };
  }

  /**
   * Check if in test mode
   */
  isTestMode(rawPayload?: Record<string, any>): boolean {
    return this.config.testMode || rawPayload?.test_mode === true;
  }

  /**
   * Get webhook path
   */
  getWebhookPath(): string {
    return this.config.webhookPath || '/webhooks/mock';
  }

  // ==================== Mock-Specific Methods ====================

  /**
   * Create a mock transaction (for testing)
   */
  createMockTransaction(data: Partial<MockTransaction>): MockTransaction {
    const transaction: MockTransaction = {
      reference: data.reference || this.generateReference(),
      amount: data.amount || 10000,
      currency: data.currency || 'USD',
      status: data.status || 'success',
      createdAt: data.createdAt || new Date().toISOString(),
      paidAt: data.paidAt,
      customer: data.customer || {
        email: 'test@example.com',
        id: 'cust_123',
      },
      metadata: data.metadata || {},
      timeline: data.timeline || [
        {
          event: 'created',
          timestamp: new Date(),
        },
      ],
    };

    this.mockTransactions.set(transaction.reference, transaction);
    return transaction;
  }

  /**
   * Generate a mock webhook payload
   */
  generateWebhookPayload(
    event: string,
    data: Record<string, any> = {},
  ): Record<string, any> {
    return {
      id: this.generateEventId(),
      event,
      created_at: new Date().toISOString(),
      data: {
        reference: data.reference || this.generateReference(),
        amount: data.amount || 10000,
        currency: data.currency || 'USD',
        status: data.status || 'success',
        customer: data.customer || {
          email: 'test@example.com',
        },
        metadata: data.metadata || {},
        ...data,
      },
    };
  }

  /**
   * Generate webhook with signature
   */
  generateSignedWebhook(
    event: string,
    data: Record<string, any> = {},
    secret: string = 'test_secret',
  ): { body: Buffer; headers: Record<string, string> } {
    const payload = this.generateWebhookPayload(event, data);
    const body = Buffer.from(JSON.stringify(payload));
    const signature = this.generateSignature(body, secret);

    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': signature,
        'x-mock-event': event,
        'x-mock-timestamp': new Date().toISOString(),
      },
    };
  }

  /**
   * Clear mock data
   */
  clearMockData(): void {
    this.mockTransactions.clear();
    this.eventCounter = 0;
  }

  // ==================== Private Helpers ====================

  /**
   * Generate HMAC signature
   */
  private generateSignature(payload: Buffer, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Timing-safe string comparison
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * Map mock event to normalized event type
   */
  private mapEventType(event: string): NormalizedEventType | null {
    const mapping: Record<string, NormalizedEventType> = {
      'payment.success': NormalizedEventType.PAYMENT_SUCCESSFUL,
      'payment.failed': NormalizedEventType.PAYMENT_FAILED,
      'payment.abandoned': NormalizedEventType.PAYMENT_ABANDONED,
      'refund.success': NormalizedEventType.REFUND_SUCCESSFUL,
      'refund.failed': NormalizedEventType.REFUND_FAILED,
      'refund.partial': NormalizedEventType.REFUND_SUCCESSFUL,
      'refund.pending': NormalizedEventType.REFUND_PENDING,
      'dispute.created': NormalizedEventType.CHARGE_DISPUTED,
      'dispute.resolved': NormalizedEventType.DISPUTE_RESOLVED,
    };

    return mapping[event] || null;
  }

  /**
   * Map status to verification result
   */
  private mapStatusToVerification(
    status: string,
  ): 'success' | 'failed' | 'pending' | 'abandoned' {
    switch (status) {
      case 'success':
      case 'successful':
        return 'success';
      case 'failed':
      case 'failure':
        return 'failed';
      case 'processing':
      case 'pending':
        return 'pending';
      case 'abandoned':
      case 'timeout':
        return 'abandoned';
      default:
        return 'pending';
    }
  }

  /**
   * Generate unique reference
   */
  private generateReference(): string {
    return `mock_ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `mock_evt_${++this.eventCounter}_${Date.now()}`;
  }

  /**
   * Simulate network delay
   */
  private async simulateDelay(): Promise<void> {
    if (this.config.testMode) {
      return; // No delay in test mode
    }
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
  }
}

/**
 * Mock transaction structure
 */
interface MockTransaction {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt?: string;
  customer?: {
    email: string;
    id: string;
    metadata?: Record<string, any>;
  };
  metadata?: Record<string, any>;
  timeline?: Array<{
    event: string;
    timestamp: Date;
    details?: Record<string, any>;
  }>;
}
