import {
  WebhookProcessor,
  PipelineConfig,
  MockStorageAdapter,
  PaystackProviderAdapter,
  PaystackWebhookFactory,
  TransactionStateMachine,
  EventDispatcherImpl,
  TransactionStatus,
  ProcessingStatus,
  NormalizedEventType,
  TransactionService,
  TriggerType,
} from '../../src';

describe('Paystack Integration Tests', () => {
  let processor: WebhookProcessor;
  let service: TransactionService;
  let storageAdapter: MockStorageAdapter;
  let paystackAdapter: PaystackProviderAdapter;
  let stateMachine: TransactionStateMachine;
  let eventDispatcher: EventDispatcherImpl;
  let config: PipelineConfig;

  const TEST_SECRET = 'sk_test_xxxxxxxxxxxxx';

  beforeEach(() => {
    // Initialize components
    storageAdapter = new MockStorageAdapter();
    paystackAdapter = new PaystackProviderAdapter();
    stateMachine = new TransactionStateMachine();
    eventDispatcher = new EventDispatcherImpl();

    // Create pipeline config with Paystack
    config = {
      storageAdapter,
      providerAdapters: new Map([['paystack', paystackAdapter]]),
      stateMachine,
      eventDispatcher,
      skipSignatureVerification: false,
      storeRawPayload: true,
    };

    // Create processor and service
    processor = new WebhookProcessor(config);
    service = new TransactionService(
      storageAdapter,
      new Map([['paystack', paystackAdapter]]),
      stateMachine,
    );
  });

  afterEach(() => {
    storageAdapter.clear();
  });

  describe('Paystack Webhook Processing', () => {
    it('should process Paystack charge.success webhook', async () => {
      // Create transaction first
      const transaction = await service.createTransaction({
        applicationRef: 'order_123',
        provider: 'paystack',
        amount: 10000, // 100 NGN
        currency: 'NGN',
      });

      // Generate Paystack webhook
      const webhook = PaystackWebhookFactory.generateSignedWebhook(
        'charge.success',
        {
          reference: 'ps_ref_123',
          amount: 10000,
          currency: 'NGN',
          orderId: 'order_123',
          email: 'customer@example.com',
        },
        TEST_SECRET,
      );

      // Track events
      const dispatchedEvents: any[] = [];
      eventDispatcher.on(
        NormalizedEventType.PAYMENT_SUCCEEDED,
        async (type, payload) => {
          dispatchedEvents.push(payload);
        },
      );

      // Process webhook with correct secret
      const result = await processor.processWebhook(
        'paystack',
        webhook.body,
        webhook.headers,
      );

      // Verify processing succeeded
      expect(result.success).toBe(true);
      expect(result.processingStatus).toBe(ProcessingStatus.PROCESSED);

      // Verify transaction was updated
      const updated = await service.getTransaction(transaction.id);
      expect(updated?.status).toBe(TransactionStatus.SUCCESSFUL);
      expect(updated?.providerRef).toBe('ps_ref_123');

      // Verify event was dispatched
      expect(dispatchedEvents).toHaveLength(1);
      expect(dispatchedEvents[0].normalized.eventType).toBe(
        NormalizedEventType.PAYMENT_SUCCEEDED,
      );
      expect(dispatchedEvents[0].normalized.amount).toBe(10000);
      expect(dispatchedEvents[0].normalized.customer?.email).toBe(
        'customer@example.com',
      );
    });

    it('should reject Paystack webhook with invalid signature', async () => {
      const webhook = PaystackWebhookFactory.generateSignedWebhook(
        'charge.success',
        { reference: 'ps_ref_456', amount: 5000 },
        'wrong_secret', // Wrong secret used for signing
      );

      // Process with correct secret (will fail signature check)
      const result = await processor.processWebhook(
        'paystack',
        webhook.body,
        webhook.headers,
      );

      expect(result.success).toBe(false);
      expect(result.processingStatus).toBe(ProcessingStatus.SIGNATURE_FAILED);

      // Webhook should still be logged
      const webhooks = await storageAdapter.findWebhookLogs({
        processingStatus: ProcessingStatus.SIGNATURE_FAILED,
      });
      expect(webhooks).toHaveLength(1);
    });

    it('should handle Paystack refund.processed webhook', async () => {
      // Create and complete a transaction
      const transaction = await service.createTransaction({
        applicationRef: 'order_refund',
        provider: 'paystack',
        amount: 20000,
        currency: 'NGN',
      });

      await service.markAsProcessing(transaction.id, {
        providerRef: 'ps_txn_original',
      });

      await storageAdapter.updateTransactionStatus(
        transaction.id,
        TransactionStatus.SUCCESSFUL,
        {
          transactionId: transaction.id,
          fromStatus: TransactionStatus.PROCESSING,
          toStatus: TransactionStatus.SUCCESSFUL,
          triggerType: TriggerType.WEBHOOK,
          actor: 'system',
        },
      );

      // Generate refund webhook
      const webhook = PaystackWebhookFactory.generateSignedWebhook(
        'refund.processed',
        {
          reference: 'ps_refund_123',
          transactionReference: 'ps_txn_original',
          amount: 20000,
        },
        TEST_SECRET,
      );

      // Track refund events
      const refundEvents: any[] = [];
      eventDispatcher.on(
        NormalizedEventType.REFUND_COMPLETED,
        async (type, payload) => {
          refundEvents.push(payload);
        },
      );

      // Process refund webhook
      const result = await processor.processWebhook(
        'paystack',
        webhook.body,
        webhook.headers,
      );

      expect(result.success).toBe(true);

      // Transaction should now be refunded
      const refunded = await service.getTransaction(transaction.id);
      expect(refunded?.status).toBe(TransactionStatus.REFUNDED);

      // Verify refund event was dispatched
      expect(refundEvents).toHaveLength(1);
      expect(refundEvents[0].normalized.eventType).toBe(
        NormalizedEventType.REFUND_COMPLETED,
      );
    });

    it('should handle Paystack subscription.create webhook', async () => {
      const webhook = PaystackWebhookFactory.generateSignedWebhook(
        'subscription.create',
        {
          subscriptionCode: 'SUB_test_123',
          amount: 10000,
          interval: 'monthly',
        },
        TEST_SECRET,
      );

      const result = await processor.processWebhook(
        'paystack',
        webhook.body,
        webhook.headers,
      );

      expect(result.success).toBe(true);

      // Should be logged as unmatched (no existing transaction)
      expect(result.processingStatus).toBe(ProcessingStatus.UNMATCHED);

      const webhooks = await storageAdapter.findWebhookLogs({
        processingStatus: ProcessingStatus.UNMATCHED,
      });
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].eventType).toBe('subscription.create');
    });

    it('should process batch of Paystack webhooks', async () => {
      // Create transactions for batch
      const transactions = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          service.createTransaction({
            applicationRef: `batch_order_${i}`,
            provider: 'paystack',
            amount: (i + 1) * 1000,
            currency: 'NGN',
          }),
        ),
      );

      // Generate batch of webhooks
      const webhooks = transactions.map((txn, i) =>
        PaystackWebhookFactory.generateSignedWebhook(
          i % 2 === 0 ? 'charge.success' : 'charge.failed',
          {
            reference: `ps_batch_${i}`,
            amount: txn.money.amount,
            orderId: txn.applicationRef,
          },
          TEST_SECRET,
        ),
      );

      // Process all webhooks
      const results = await Promise.all(
        webhooks.map((webhook) =>
          processor.processWebhook('paystack', webhook.body, webhook.headers),
        ),
      );

      // Verify all processed
      expect(results.every((r) => r.success)).toBe(true);

      // Check transaction statuses
      const updated = await Promise.all(
        transactions.map((t) => service.getTransaction(t.id)),
      );

      expect(updated[0]?.status).toBe(TransactionStatus.SUCCESSFUL); // charge.success
      expect(updated[1]?.status).toBe(TransactionStatus.FAILED); // charge.failed
      expect(updated[2]?.status).toBe(TransactionStatus.SUCCESSFUL); // charge.success
    });
  });

  describe('Paystack-specific Features', () => {
    it('should extract Paystack metadata correctly', async () => {
      const webhook = PaystackWebhookFactory.chargeSuccess({
        reference: 'ps_meta_test',
        amount: 15000,
        orderId: 'order_meta',
      });

      // Add signature
      const signature = PaystackWebhookFactory.sign(webhook.body, TEST_SECRET);
      webhook.headers['x-paystack-signature'] = signature;

      // Create matching transaction
      await service.createTransaction({
        applicationRef: 'order_meta',
        provider: 'paystack',
        amount: 15000,
        currency: 'NGN',
      });

      const result = await processor.processWebhook(
        'paystack',
        webhook.body,
        webhook.headers,
      );

      expect(result.success).toBe(true);

      // Get webhook log to check metadata
      const webhookLogs = await storageAdapter.findWebhookLogs({
        id: result.webhookLogId,
      });

      const metadata = webhookLogs[0].metadata;
      expect(metadata.normalizedEvent.metadata.gateway_response).toBe(
        'Successful',
      );
      expect(metadata.normalizedEvent.metadata.channel).toBe('card');
      expect(metadata.normalizedEvent.metadata.authorization).toBeDefined();
      expect(metadata.normalizedEvent.metadata.authorization.card_type).toBe(
        'visa',
      );
      expect(metadata.normalizedEvent.metadata.authorization.last4).toBe(
        '4081',
      );
    });

    it('should handle Paystack transfer webhooks', async () => {
      const webhook = PaystackWebhookFactory.generateSignedWebhook(
        'transfer.success',
        {
          reference: 'ps_transfer_001',
          amount: 50000,
          recipient: 'John Doe',
        },
        TEST_SECRET,
      );

      const result = await processor.processWebhook(
        'paystack',
        webhook.body,
        webhook.headers,
      );

      expect(result.success).toBe(true);
      expect(result.processingStatus).toBe(ProcessingStatus.UNMATCHED); // No matching transaction

      const webhookLogs = await storageAdapter.findWebhookLogs({
        eventType: 'transfer.success',
      });
      expect(webhookLogs).toHaveLength(1);
      expect(webhookLogs[0].signatureValid).toBe(true);
    });

    it('should generate unique idempotency keys for Paystack events', async () => {
      // Send same webhook twice
      const webhook = PaystackWebhookFactory.generateSignedWebhook(
        'charge.success',
        {
          reference: 'ps_idem_test',
          amount: 7500,
        },
        TEST_SECRET,
      );

      // Ensure the webhook has a consistent ID
      const parsedPayload = JSON.parse(webhook.body.toString());
      parsedPayload.data.id = 999999; // Fixed ID for testing
      webhook.body = Buffer.from(JSON.stringify(parsedPayload));

      // Re-sign with fixed payload
      const signature = PaystackWebhookFactory.sign(webhook.body, TEST_SECRET);
      webhook.headers['x-paystack-signature'] = signature;

      // Process twice
      const result1 = await processor.processWebhook(
        'paystack',
        webhook.body,
        webhook.headers,
      );
      const result2 = await processor.processWebhook(
        'paystack',
        webhook.body,
        webhook.headers,
      );

      expect(result1.success).toBe(true);
      expect(result1.processingStatus).toBe(ProcessingStatus.UNMATCHED); // No transaction

      expect(result2.success).toBe(true);
      expect(result2.processingStatus).toBe(ProcessingStatus.DUPLICATE); // Duplicate

      // Should have 2 webhook logs, one marked as duplicate
      const webhookLogs = await storageAdapter.findWebhookLogs({
        provider: 'paystack',
      });
      expect(webhookLogs).toHaveLength(2);

      const duplicate = webhookLogs.find(
        (w) => w.processingStatus === ProcessingStatus.DUPLICATE,
      );
      expect(duplicate).toBeDefined();
    });
  });
});
