import { MockProviderAdapter } from '../../adapters/providers/mock';

/**
 * Factory for generating mock webhook payloads
 * Used for testing webhook processing without real providers
 */
export class MockWebhookFactory {
  private static mockProvider = new MockProviderAdapter();

  /**
   * Generate a payment successful webhook
   */
  static paymentSuccessful(options: WebhookOptions = {}): WebhookPayload {
    const provider = options.provider || this.mockProvider;
    const secret = options.secret || 'test_secret';

    const data = {
      reference: options.reference || this.generateRef('pay'),
      amount: options.amount || 50000,
      currency: options.currency || 'USD',
      status: 'success',
      customer: {
        email: options.customerEmail || 'customer@example.com',
      },
      metadata: {
        applicationRef: options.applicationRef || this.generateRef('app'),
        ...options.metadata,
      },
    };

    const { body, headers } = provider.generateSignedWebhook(
      'payment.success',
      data,
      secret,
    );

    return {
      body,
      headers,
      event: 'payment.success',
      data,
    };
  }

  /**
   * Generate a payment failed webhook
   */
  static paymentFailed(options: WebhookOptions = {}): WebhookPayload {
    const provider = options.provider || this.mockProvider;
    const secret = options.secret || 'test_secret';

    const data = {
      reference: options.reference || this.generateRef('pay'),
      amount: options.amount || 50000,
      currency: options.currency || 'USD',
      status: 'failed',
      failureReason: options.failureReason || 'Insufficient funds',
      customer: {
        email: options.customerEmail || 'customer@example.com',
      },
      metadata: {
        applicationRef: options.applicationRef || this.generateRef('app'),
        ...options.metadata,
      },
    };

    const { body, headers } = provider.generateSignedWebhook(
      'payment.failed',
      data,
      secret,
    );

    return {
      body,
      headers,
      event: 'payment.failed',
      data,
    };
  }

  /**
   * Generate a refund successful webhook
   */
  static refundSuccessful(options: WebhookOptions = {}): WebhookPayload {
    const provider = options.provider || this.mockProvider;
    const secret = options.secret || 'test_secret';

    const data = {
      reference: options.reference || this.generateRef('pay'),
      refundReference: options.refundReference || this.generateRef('refund'),
      amount: options.amount || 50000,
      refundAmount: options.refundAmount || options.amount || 50000,
      currency: options.currency || 'USD',
      status: 'refunded',
      refundType: options.partial ? 'partial' : 'full',
      metadata: {
        applicationRef: options.applicationRef || this.generateRef('app'),
        ...options.metadata,
      },
    };

    const event = options.partial ? 'refund.partial' : 'refund.success';
    const { body, headers } = provider.generateSignedWebhook(
      event,
      data,
      secret,
    );

    return {
      body,
      headers,
      event,
      data,
    };
  }

  /**
   * Generate a dispute created webhook
   */
  static disputeCreated(options: WebhookOptions = {}): WebhookPayload {
    const provider = options.provider || this.mockProvider;
    const secret = options.secret || 'test_secret';

    const data = {
      reference: options.reference || this.generateRef('pay'),
      disputeReference: options.disputeReference || this.generateRef('dispute'),
      amount: options.amount || 50000,
      currency: options.currency || 'USD',
      status: 'disputed',
      reason: options.disputeReason || 'Fraudulent',
      metadata: {
        applicationRef: options.applicationRef || this.generateRef('app'),
        ...options.metadata,
      },
    };

    const { body, headers } = provider.generateSignedWebhook(
      'dispute.created',
      data,
      secret,
    );

    return {
      body,
      headers,
      event: 'dispute.created',
      data,
    };
  }

  /**
   * Generate a dispute resolved webhook
   */
  static disputeResolved(options: WebhookOptions = {}): WebhookPayload {
    const provider = options.provider || this.mockProvider;
    const secret = options.secret || 'test_secret';

    const data = {
      reference: options.reference || this.generateRef('pay'),
      disputeReference: options.disputeReference || this.generateRef('dispute'),
      amount: options.amount || 50000,
      currency: options.currency || 'USD',
      status: options.wonByMerchant ? 'resolved_won' : 'resolved_lost',
      resolution: options.wonByMerchant ? 'won' : 'lost',
      metadata: {
        applicationRef: options.applicationRef || this.generateRef('app'),
        ...options.metadata,
      },
    };

    const { body, headers } = provider.generateSignedWebhook(
      'dispute.resolved',
      data,
      secret,
    );

    return {
      body,
      headers,
      event: 'dispute.resolved',
      data,
    };
  }

  /**
   * Generate a webhook with invalid signature
   */
  static invalidSignature(options: WebhookOptions = {}): WebhookPayload {
    const webhook = this.paymentSuccessful(options);

    // Corrupt the signature
    webhook.headers['x-mock-signature'] = 'invalid_signature_12345';

    return webhook;
  }

  /**
   * Generate a webhook with malformed JSON
   */
  static malformedPayload(): WebhookPayload {
    return {
      body: Buffer.from('{ invalid json }'),
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': 'doesnt_matter',
      },
      event: 'malformed',
      data: null,
    };
  }

  /**
   * Generate a webhook for an unknown event type
   */
  static unknownEvent(options: WebhookOptions = {}): WebhookPayload {
    const provider = options.provider || this.mockProvider;
    const secret = options.secret || 'test_secret';

    const data = {
      reference: options.reference || this.generateRef('unknown'),
      someField: 'unknown_data',
    };

    const { body, headers } = provider.generateSignedWebhook(
      'unknown.event',
      data,
      secret,
    );

    return {
      body,
      headers,
      event: 'unknown.event',
      data,
    };
  }

  /**
   * Generate a duplicate webhook (same event ID)
   */
  static duplicate(
    original: WebhookPayload,
    options: { delayMs?: number } = {},
  ): WebhookPayload {
    const duplicate = { ...original };

    if (options.delayMs) {
      // Simulate delayed duplicate with different timestamp
      const payload = JSON.parse(original.body.toString());
      payload.created_at = new Date(
        new Date(payload.created_at).getTime() + options.delayMs,
      ).toISOString();
      duplicate.body = Buffer.from(JSON.stringify(payload));
    }

    return duplicate;
  }

  /**
   * Generate a batch of webhooks for testing concurrent processing
   */
  static batch(count: number, options: WebhookOptions = {}): WebhookPayload[] {
    const webhooks: WebhookPayload[] = [];

    for (let i = 0; i < count; i++) {
      const webhook =
        i % 2 === 0
          ? this.paymentSuccessful({
              ...options,
              reference: `${options.reference || 'batch'}_${i}`,
              applicationRef: `${options.applicationRef || 'app'}_${i}`,
            })
          : this.paymentFailed({
              ...options,
              reference: `${options.reference || 'batch'}_${i}`,
              applicationRef: `${options.applicationRef || 'app'}_${i}`,
            });

      webhooks.push(webhook);
    }

    return webhooks;
  }

  /**
   * Generate webhooks for a complete payment lifecycle
   */
  static paymentLifecycle(options: WebhookOptions = {}): {
    successful: WebhookPayload;
    refunded: WebhookPayload;
    disputed?: WebhookPayload;
    resolved?: WebhookPayload;
  } {
    const reference = options.reference || this.generateRef('lifecycle');
    const applicationRef = options.applicationRef || this.generateRef('app');

    const successful = this.paymentSuccessful({
      ...options,
      reference,
      applicationRef,
    });

    const refunded = this.refundSuccessful({
      ...options,
      reference,
      applicationRef,
      partial: options.partial,
    });

    const result: any = {
      successful,
      refunded,
    };

    if (options.includeDispute) {
      result.disputed = this.disputeCreated({
        ...options,
        reference,
        applicationRef,
      });

      result.resolved = this.disputeResolved({
        ...options,
        reference,
        applicationRef,
        wonByMerchant: options.wonByMerchant,
      });
    }

    return result;
  }

  /**
   * Generate a reference ID
   */
  private static generateRef(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

/**
 * Options for webhook generation
 */
export interface WebhookOptions {
  provider?: MockProviderAdapter;
  secret?: string;
  reference?: string;
  applicationRef?: string;
  amount?: number;
  currency?: string;
  customerEmail?: string;
  metadata?: Record<string, any>;

  // Refund options
  refundReference?: string;
  refundAmount?: number;
  partial?: boolean;

  // Dispute options
  disputeReference?: string;
  disputeReason?: string;
  wonByMerchant?: boolean;

  // Failure options
  failureReason?: string;

  // Lifecycle options
  includeDispute?: boolean;
}

/**
 * Generated webhook payload
 */
export interface WebhookPayload {
  body: Buffer;
  headers: Record<string, string>;
  event: string;
  data: any;
}

/**
 * Test helper for webhook scenarios
 */
export class WebhookScenarios {
  /**
   * Generate webhooks for testing idempotency
   */
  static idempotency(): {
    original: WebhookPayload;
    duplicate: WebhookPayload;
    delayedDuplicate: WebhookPayload;
  } {
    const original = MockWebhookFactory.paymentSuccessful();
    const duplicate = MockWebhookFactory.duplicate(original);
    const delayedDuplicate = MockWebhookFactory.duplicate(original, {
      delayMs: 5000,
    });

    return { original, duplicate, delayedDuplicate };
  }

  /**
   * Generate webhooks for testing signature verification
   */
  static signatureVerification(): {
    valid: WebhookPayload;
    invalid: WebhookPayload;
    malformed: WebhookPayload;
  } {
    const valid = MockWebhookFactory.paymentSuccessful();
    const invalid = MockWebhookFactory.invalidSignature();
    const malformed = MockWebhookFactory.malformedPayload();

    return { valid, invalid, malformed };
  }

  /**
   * Generate webhooks for testing state transitions
   */
  static stateTransitions(): {
    processing: WebhookPayload;
    successful: WebhookPayload;
    failed: WebhookPayload;
    refunded: WebhookPayload;
  } {
    const reference = `transition_${Date.now()}`;

    return {
      processing: MockWebhookFactory.paymentSuccessful({
        reference,
        metadata: { status: 'processing' },
      }),
      successful: MockWebhookFactory.paymentSuccessful({ reference }),
      failed: MockWebhookFactory.paymentFailed({ reference }),
      refunded: MockWebhookFactory.refundSuccessful({ reference }),
    };
  }

  /**
   * Generate webhooks for testing race conditions
   */
  static racingWebhooks(reference: string): WebhookPayload[] {
    return [
      MockWebhookFactory.paymentSuccessful({ reference }),
      MockWebhookFactory.paymentFailed({ reference }),
      MockWebhookFactory.paymentSuccessful({ reference }),
    ];
  }
}