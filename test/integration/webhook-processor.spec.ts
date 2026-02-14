import {
  WebhookProcessor,
  PipelineConfig,
  MockStorageAdapter,
  MockProviderAdapter,
  MockWebhookFactory,
  WebhookScenarios,
  TransactionStateMachine,
  EventDispatcherImpl,
  TransactionStatus,
  ProcessingStatus,
  NormalizedEventType,
} from '../../src';

describe('WebhookProcessor Integration Tests', () => {
  let processor: WebhookProcessor;
  let storageAdapter: MockStorageAdapter;
  let providerAdapter: MockProviderAdapter;
  let stateMachine: TransactionStateMachine;
  let eventDispatcher: EventDispatcherImpl;
  let config: PipelineConfig;

  beforeEach(() => {
    // Initialize adapters
    storageAdapter = new MockStorageAdapter();
    providerAdapter = new MockProviderAdapter();
    stateMachine = new TransactionStateMachine();
    eventDispatcher = new EventDispatcherImpl();

    // Create pipeline config
    config = {
      storageAdapter,
      providerAdapters: new Map([['mock', providerAdapter]]),
      stateMachine,
      eventDispatcher,
      skipSignatureVerification: false,
      storeRawPayload: true,
      redactKeys: ['card_number', 'cvv'],
    };

    // Create processor
    processor = new WebhookProcessor(config);
  });

  afterEach(() => {
    storageAdapter.clear();
  });

  describe('End-to-End Processing', () => {
    it('should process a successful payment webhook', async () => {
      // Create a transaction first
      const transaction = await storageAdapter.createTransaction({
        applicationRef: 'app_123',
        provider: 'mock',
        amount: 10000,
        currency: 'NGN',
      });

      // Generate webhook for successful payment
      const webhook = providerAdapter.generateSignedWebhook(
        'payment.success',
        {
          reference: transaction.applicationRef,
          provider_ref: 'prov_123',
          amount: 10000,
          currency: 'NGN',
        },
        'test_secret',
      );

      // Track dispatched events
      const dispatchedEvents: any[] = [];
      eventDispatcher.on(NormalizedEventType.PAYMENT_SUCCEEDED, async (type, payload) => {
        dispatchedEvents.push(payload);
      });

      // Process webhook
      const result = await processor.processWebhook('mock', webhook.body, webhook.headers);

      // Verify processing result
      expect(result.success).toBe(true);
      expect(result.processingStatus).toBe(ProcessingStatus.PROCESSED);
      expect(result.webhookLogId).toBeDefined();
      expect(result.transactionId).toBe(transaction.id);

      // Verify webhook was logged
      const webhookLogs = await storageAdapter.findWebhookLogs({
        id: result.webhookLogId,
      });
      expect(webhookLogs).toHaveLength(1);
      expect(webhookLogs[0].signatureValid).toBe(true);
      expect(webhookLogs[0].processingStatus).toBe(ProcessingStatus.PROCESSED);

      // Verify transaction status was updated
      const updatedTransaction = await storageAdapter.findTransaction({ id: transaction.id });
      expect(updatedTransaction?.status).toBe(TransactionStatus.SUCCESSFUL);
      expect(updatedTransaction?.providerRef).toBe('prov_123');

      // Verify event was dispatched
      expect(dispatchedEvents).toHaveLength(1);
      expect(dispatchedEvents[0].transaction.id).toBe(transaction.id);

      // Verify audit trail
      const auditLogs = await storageAdapter.getAuditLogs({ transactionId: transaction.id });
      expect(auditLogs.length).toBeGreaterThan(0);
      const stateTransition = auditLogs.find(log => log.action === 'WEBHOOK_STATE_TRANSITION');
      expect(stateTransition?.stateBefore).toBe(TransactionStatus.PENDING);
      expect(stateTransition?.stateAfter).toBe(TransactionStatus.SUCCESSFUL);
    });

    it('should handle duplicate webhooks correctly', async () => {
      // Create a transaction
      const transaction = await storageAdapter.createTransaction({
        applicationRef: 'app_456',
        provider: 'mock',
        amount: 5000,
        currency: 'USD',
      });

      // Generate idempotency scenario
      const scenarios = WebhookScenarios.idempotency({
        applicationRef: transaction.applicationRef,
        providerRef: 'prov_456',
      });

      // Process original webhook
      const result1 = await processor.processWebhook(
        'mock',
        scenarios.original.body,
        scenarios.original.headers,
      );
      expect(result1.success).toBe(true);
      expect(result1.processingStatus).toBe(ProcessingStatus.PROCESSED);

      // Process duplicate webhook
      const result2 = await processor.processWebhook(
        'mock',
        scenarios.duplicate.body,
        scenarios.duplicate.headers,
      );
      expect(result2.success).toBe(true);
      expect(result2.processingStatus).toBe(ProcessingStatus.DUPLICATE);

      // Verify only one state transition occurred
      const updatedTransaction = await storageAdapter.findTransaction({ id: transaction.id });
      expect(updatedTransaction?.status).toBe(TransactionStatus.SUCCESSFUL);

      // Verify both webhooks were logged
      const webhookLogs = await storageAdapter.findWebhookLogs({
        transactionId: transaction.id,
      });
      expect(webhookLogs).toHaveLength(2);

      const processed = webhookLogs.find(w => w.processingStatus === ProcessingStatus.PROCESSED);
      const duplicate = webhookLogs.find(w => w.processingStatus === ProcessingStatus.DUPLICATE);
      expect(processed).toBeDefined();
      expect(duplicate).toBeDefined();
    });

    it('should reject webhooks with invalid signatures', async () => {
      const scenarios = WebhookScenarios.signatureVerification();

      // Process webhook with invalid signature
      const result = await processor.processWebhook(
        'mock',
        scenarios.invalid.body,
        scenarios.invalid.headers,
      );

      expect(result.success).toBe(false);
      expect(result.processingStatus).toBe(ProcessingStatus.SIGNATURE_FAILED);

      // Verify webhook was still logged
      const webhookLogs = await storageAdapter.findWebhookLogs({
        processingStatus: ProcessingStatus.SIGNATURE_FAILED,
      });
      expect(webhookLogs).toHaveLength(1);
      expect(webhookLogs[0].signatureValid).toBe(false);
    });

    it('should handle unmatched webhooks', async () => {
      // Generate webhook for non-existent transaction
      const webhook = providerAdapter.generateSignedWebhook(
        'payment.success',
        {
          reference: 'non_existent_ref',
          provider_ref: 'prov_789',
          amount: 20000,
          currency: 'EUR',
        },
      );

      // Process webhook
      const result = await processor.processWebhook('mock', webhook.body, webhook.headers);

      expect(result.success).toBe(true); // Processing succeeded, but webhook was unmatched
      expect(result.processingStatus).toBe(ProcessingStatus.UNMATCHED);
      expect(result.transactionId).toBeUndefined();

      // Verify webhook was logged as unmatched
      const webhookLogs = await storageAdapter.findWebhookLogs({
        processingStatus: ProcessingStatus.UNMATCHED,
      });
      expect(webhookLogs).toHaveLength(1);
    });

    it('should handle state transition rejections', async () => {
      // Create a transaction in FAILED state
      const transaction = await storageAdapter.createTransaction({
        applicationRef: 'app_fail',
        provider: 'mock',
        amount: 1000,
        currency: 'GBP',
      });

      // Manually set to FAILED state
      await storageAdapter.updateTransactionStatus(
        transaction.id,
        TransactionStatus.FAILED,
        {
          transactionId: transaction.id,
          action: 'MANUAL_TRANSITION',
          performedBy: 'test',
          performedAt: new Date(),
          stateBefore: TransactionStatus.PENDING,
          stateAfter: TransactionStatus.FAILED,
        },
      );

      // Try to process a success webhook (should be rejected)
      const webhook = providerAdapter.generateSignedWebhook(
        'payment.success',
        {
          reference: transaction.applicationRef,
          provider_ref: 'prov_fail',
          amount: 1000,
          currency: 'GBP',
        },
      );

      const result = await processor.processWebhook('mock', webhook.body, webhook.headers);

      expect(result.success).toBe(true); // Processing succeeded
      expect(result.processingStatus).toBe(ProcessingStatus.TRANSITION_REJECTED);

      // Verify transaction status didn't change
      const unchangedTransaction = await storageAdapter.findTransaction({ id: transaction.id });
      expect(unchangedTransaction?.status).toBe(TransactionStatus.FAILED);

      // Verify audit log shows rejection
      const auditLogs = await storageAdapter.getAuditLogs({ transactionId: transaction.id });
      const rejection = auditLogs.find(log =>
        log.metadata?.attemptedTransition === `${TransactionStatus.FAILED} -> ${TransactionStatus.SUCCESSFUL}`
      );
      expect(rejection).toBeDefined();
    });
  });

  describe('Pipeline Stages', () => {
    it('should execute all pipeline stages in order', async () => {
      const transaction = await storageAdapter.createTransaction({
        applicationRef: 'app_pipeline',
        provider: 'mock',
        amount: 15000,
        currency: 'NGN',
      });

      const webhook = providerAdapter.generateSignedWebhook(
        'payment.success',
        {
          reference: transaction.applicationRef,
          provider_ref: 'prov_pipeline',
          amount: 15000,
          currency: 'NGN',
        },
      );

      const result = await processor.processWebhook('mock', webhook.body, webhook.headers);

      // Verify all stages were executed
      expect(result.metrics.signatureVerified).toBe(true);
      expect(result.metrics.normalized).toBe(true);
      expect(result.metrics.persisted).toBe(true);
      expect(result.metrics.transitionApplied).toBe(true);
      expect(result.metrics.dispatched).toBe(true);

      // Verify stage durations were tracked
      expect(result.metrics.stageDurations.size).toBeGreaterThan(0);
      expect(result.metrics.stageDurations.has('verification')).toBe(true);
      expect(result.metrics.stageDurations.has('normalization')).toBe(true);
      expect(result.metrics.stageDurations.has('persist-claim')).toBe(true);
      expect(result.metrics.stageDurations.has('deduplication')).toBe(true);
      expect(result.metrics.stageDurations.has('state-engine')).toBe(true);
      expect(result.metrics.stageDurations.has('dispatch')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle normalization errors gracefully', async () => {
      // Generate webhook with malformed data
      const webhook = providerAdapter.generateSignedWebhook(
        'unknown.event',
        {
          malformed: true,
          // Missing required fields
        },
      );

      const result = await processor.processWebhook('mock', webhook.body, webhook.headers);

      // Should still log the webhook but with error status
      expect(result.success).toBe(false);
      expect(result.processingStatus).toBe(ProcessingStatus.NORMALIZATION_FAILED);
    });

    it('should handle lifecycle hooks', async () => {
      let beforeCalled = false;
      let afterCalled = false;
      let successCalled = false;

      // Create processor with hooks
      const hookedConfig: PipelineConfig = {
        ...config,
        hooks: {
          beforeProcessing: async (context) => {
            beforeCalled = true;
            expect(context.provider).toBe('mock');
          },
          afterProcessing: async (context) => {
            afterCalled = true;
            expect(context.webhookLog).toBeDefined();
          },
          onSuccess: async (result) => {
            successCalled = true;
            expect(result.success).toBe(true);
          },
        },
      };

      const hookedProcessor = new WebhookProcessor(hookedConfig);

      const webhook = MockWebhookFactory.paymentSuccessful();
      await hookedProcessor.processWebhook('mock', webhook.body, webhook.headers);

      expect(beforeCalled).toBe(true);
      expect(afterCalled).toBe(true);
      expect(successCalled).toBe(true);
    });
  });

  describe('Batch Processing', () => {
    it('should handle concurrent webhook processing', async () => {
      // Create multiple transactions
      const transactions = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          storageAdapter.createTransaction({
            applicationRef: `app_batch_${i}`,
            provider: 'mock',
            amount: 1000 * (i + 1),
            currency: 'NGN',
          })
        )
      );

      // Generate webhooks for all transactions
      const webhooks = transactions.map(txn =>
        providerAdapter.generateSignedWebhook('payment.success', {
          reference: txn.applicationRef,
          provider_ref: `prov_batch_${txn.id}`,
          amount: txn.money.amount,
          currency: txn.money.currency,
        })
      );

      // Process all webhooks concurrently
      const results = await Promise.all(
        webhooks.map(webhook =>
          processor.processWebhook('mock', webhook.body, webhook.headers)
        )
      );

      // Verify all succeeded
      expect(results.every(r => r.success)).toBe(true);
      expect(results.every(r => r.processingStatus === ProcessingStatus.PROCESSED)).toBe(true);

      // Verify all transactions were updated
      const updatedTransactions = await Promise.all(
        transactions.map(txn =>
          storageAdapter.findTransaction({ id: txn.id })
        )
      );

      expect(updatedTransactions.every(t => t?.status === TransactionStatus.SUCCESSFUL)).toBe(true);
    });
  });
});