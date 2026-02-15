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
  AuditAction,
  TriggerType,
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
      secrets: new Map([['mock', ['test_secret']]]), // Add secrets for mock provider
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

      // Move transaction to PROCESSING state (as would happen when payment is initiated)
      await storageAdapter.updateTransactionStatus(
        transaction.id,
        TransactionStatus.PROCESSING,
        {
          transactionId: transaction.id,
          fromStatus: TransactionStatus.PENDING,
          toStatus: TransactionStatus.PROCESSING,
          triggerType: TriggerType.MANUAL,
          actor: 'test',
        },
      );

      // Generate webhook for successful payment
      const webhook = providerAdapter.generateSignedWebhook(
        'payment.success',
        {
          reference: 'prov_123',
          provider_ref: 'prov_123',
          amount: 10000,
          currency: 'NGN',
          metadata: {
            applicationRef: transaction.applicationRef,
          },
        },
        'test_secret',
      );

      // Track dispatched events
      const dispatchedEvents: any[] = [];
      eventDispatcher.on(
        NormalizedEventType.PAYMENT_SUCCESSFUL, // Changed from PAYMENT_SUCCEEDED
        async (type, payload) => {
          dispatchedEvents.push(payload);
        },
      );

      // Process webhook
      const result = await processor.processWebhook(
        'mock',
        webhook.body,
        webhook.headers,
      );

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
      const updatedTransaction = await storageAdapter.findTransaction({
        id: transaction.id,
      });
      expect(updatedTransaction?.status).toBe(TransactionStatus.SUCCESSFUL);
      expect(updatedTransaction?.providerRef).toBe('prov_123');

      // Verify event was dispatched
      expect(dispatchedEvents).toHaveLength(1);
      expect(dispatchedEvents[0].transaction.id).toBe(transaction.id);

      // Verify audit trail
      const auditLogs = await storageAdapter.getAuditLogs(transaction.id);
      expect(auditLogs.length).toBeGreaterThan(0);
      const stateTransition = auditLogs.find(
        (log) => log.toStatus === TransactionStatus.SUCCESSFUL,
      );
      expect(stateTransition?.fromStatus).toBe(TransactionStatus.PROCESSING);
      expect(stateTransition?.toStatus).toBe(TransactionStatus.SUCCESSFUL);
    });

    it('should handle duplicate webhooks correctly', async () => {
      // Create a transaction
      const transaction = await storageAdapter.createTransaction({
        applicationRef: 'app_456',
        provider: 'mock',
        amount: 5000,
        currency: 'USD',
      });

      // Move to PROCESSING state
      await storageAdapter.updateTransactionStatus(
        transaction.id,
        TransactionStatus.PROCESSING,
        {
          transactionId: transaction.id,
          fromStatus: TransactionStatus.PENDING,
          toStatus: TransactionStatus.PROCESSING,
          triggerType: TriggerType.MANUAL,
          actor: 'test',
        },
      );

      // Generate webhook payload with fixed event ID for duplication testing
      const webhookData = {
        id: 'evt_duplicate_test_123', // Fixed event ID for both webhooks
        event: 'payment.success',
        created_at: new Date().toISOString(),
        data: {
          reference: 'prov_456',
          provider_ref: 'prov_456',
          amount: 5000,
          currency: 'USD',
          status: 'success',
          metadata: {
            applicationRef: transaction.applicationRef,
          },
        },
      };

      // Create signed webhook bodies
      const body1 = Buffer.from(JSON.stringify(webhookData));
      const signature1 = require('crypto')
        .createHmac('sha256', 'test_secret')
        .update(body1)
        .digest('hex');

      const webhook1 = {
        body: body1,
        headers: {
          'content-type': 'application/json',
          'x-mock-signature': signature1,
          'x-mock-event': 'payment.success',
          'x-mock-timestamp': new Date().toISOString(),
        },
      };

      // Create duplicate with same event ID but different timestamp
      const webhookData2 = { ...webhookData, created_at: new Date(Date.now() + 1000).toISOString() };
      const body2 = Buffer.from(JSON.stringify(webhookData2));
      const signature2 = require('crypto')
        .createHmac('sha256', 'test_secret')
        .update(body2)
        .digest('hex');

      const webhook2 = {
        body: body2,
        headers: {
          'content-type': 'application/json',
          'x-mock-signature': signature2,
          'x-mock-event': 'payment.success',
          'x-mock-timestamp': new Date().toISOString(),
        },
      };

      // Process original webhook
      const result1 = await processor.processWebhook(
        'mock',
        webhook1.body,
        webhook1.headers,
      );
      expect(result1.success).toBe(true);
      expect(result1.processingStatus).toBe(ProcessingStatus.PROCESSED);

      // Process duplicate webhook
      const result2 = await processor.processWebhook(
        'mock',
        webhook2.body,
        webhook2.headers,
      );
      expect(result2.success).toBe(true);
      expect(result2.processingStatus).toBe(ProcessingStatus.DUPLICATE);

      // Verify only one state transition occurred
      const updatedTransaction = await storageAdapter.findTransaction({
        id: transaction.id,
      });
      expect(updatedTransaction?.status).toBe(TransactionStatus.SUCCESSFUL);

      // Verify both webhooks were logged
      const webhookLogs = await storageAdapter.findWebhookLogs({
        transactionId: transaction.id,
      });
      expect(webhookLogs).toHaveLength(2);

      const processed = webhookLogs.find(
        (w) => w.processingStatus === ProcessingStatus.PROCESSED,
      );
      const duplicate = webhookLogs.find(
        (w) => w.processingStatus === ProcessingStatus.DUPLICATE,
      );
      expect(processed).toBeDefined();
      expect(duplicate).toBeDefined();
    });

    it('should reject webhooks with invalid signatures', async () => {
      // Generate webhook with valid payload but wrong signature
      const webhookPayload = {
        id: 'evt_invalid_sig',
        event: 'payment.success',
        created_at: new Date().toISOString(),
        data: {
          reference: 'prov_invalid',
          amount: 10000,
          currency: 'USD',
          status: 'success',
        },
      };

      const body = Buffer.from(JSON.stringify(webhookPayload));
      // Create signature with WRONG secret to ensure it fails
      const wrongSignature = require('crypto')
        .createHmac('sha256', 'wrong_secret_key')
        .update(body)
        .digest('hex');

      const webhook = {
        body,
        headers: {
          'content-type': 'application/json',
          'x-mock-signature': wrongSignature, // Signature made with wrong secret
          'x-mock-event': 'payment.success',
          'x-mock-timestamp': new Date().toISOString(),
        },
      };

      // Process webhook with invalid signature
      const result = await processor.processWebhook(
        'mock',
        webhook.body,
        webhook.headers,
      );

      // Per PRD: "Every claim has a fate" - signature failures are logged, not dropped
      expect(result.success).toBe(true); // Processing succeeded in classifying the webhook
      // Note: Signature fails, pipeline continues, but state-engine can't find transaction → UNMATCHED
      expect(result.processingStatus).toBe(ProcessingStatus.UNMATCHED);
      expect(result.webhookLogId).toBeDefined(); // Webhook must be logged

      // Verify webhook was logged
      const webhookLogs = await storageAdapter.findWebhookLogs({
        id: result.webhookLogId,
      });
      expect(webhookLogs).toHaveLength(1);
      expect(webhookLogs[0].signatureValid).toBe(false);
      expect(webhookLogs[0].processingStatus).toBe(ProcessingStatus.UNMATCHED);
    });

    it('should handle unmatched webhooks', async () => {
      // Generate webhook for non-existent transaction
      const webhook = providerAdapter.generateSignedWebhook('payment.success', {
        reference: 'non_existent_ref',
        provider_ref: 'prov_789',
        amount: 20000,
        currency: 'EUR',
      });

      // Process webhook
      const result = await processor.processWebhook(
        'mock',
        webhook.body,
        webhook.headers,
      );

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
          fromStatus: TransactionStatus.PENDING,
          toStatus: TransactionStatus.FAILED,
          triggerType: TriggerType.MANUAL,
          actor: 'test',
        },
      );

      // Try to process a success webhook (should be rejected)
      const webhook = providerAdapter.generateSignedWebhook('payment.success', {
        reference: 'prov_fail',
        provider_ref: 'prov_fail',
        amount: 1000,
        currency: 'GBP',
        metadata: {
          applicationRef: transaction.applicationRef,
        },
      });

      const result = await processor.processWebhook(
        'mock',
        webhook.body,
        webhook.headers,
      );

      expect(result.success).toBe(true); // Processing succeeded
      expect(result.processingStatus).toBe(
        ProcessingStatus.TRANSITION_REJECTED,
      );

      // Verify transaction status didn't change
      const unchangedTransaction = await storageAdapter.findTransaction({
        id: transaction.id,
      });
      expect(unchangedTransaction?.status).toBe(TransactionStatus.FAILED);

      // Verify audit log shows rejection
      const auditLogs = await storageAdapter.getAuditLogs(transaction.id);
      const rejection = auditLogs.find(
        (log) =>
          log.metadata?.attemptedTransition ===
          `${TransactionStatus.FAILED} -> ${TransactionStatus.SUCCESSFUL}`,
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

      // Move to PROCESSING state
      await storageAdapter.updateTransactionStatus(
        transaction.id,
        TransactionStatus.PROCESSING,
        {
          transactionId: transaction.id,
          fromStatus: TransactionStatus.PENDING,
          toStatus: TransactionStatus.PROCESSING,
          triggerType: TriggerType.MANUAL,
          actor: 'test',
        },
      );

      const webhook = providerAdapter.generateSignedWebhook('payment.success', {
        reference: 'prov_pipeline',
        provider_ref: 'prov_pipeline',
        amount: 15000,
        currency: 'NGN',
        metadata: {
          applicationRef: transaction.applicationRef,
        },
      });

      const result = await processor.processWebhook(
        'mock',
        webhook.body,
        webhook.headers,
      );

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
      // Generate webhook with unknown event type that will fail normalization
      const webhookPayload = {
        id: 'evt_unknown',
        event: 'unknown.event.type', // This will fail normalization
        created_at: new Date().toISOString(),
        data: {
          malformed: true,
          // Missing required fields
        },
      };

      const body = Buffer.from(JSON.stringify(webhookPayload));
      const signature = require('crypto')
        .createHmac('sha256', 'test_secret')
        .update(body)
        .digest('hex');

      const webhook = {
        body,
        headers: {
          'content-type': 'application/json',
          'x-mock-signature': signature, // Valid signature but unknown event
          'x-mock-event': 'unknown.event.type',
          'x-mock-timestamp': new Date().toISOString(),
        },
      };

      const result = await processor.processWebhook(
        'mock',
        webhook.body,
        webhook.headers,
      );

      // Per PRD: "Every claim has a fate" - normalization failures are logged
      expect(result.success).toBe(true); // Processing succeeded in classifying the webhook
      expect(result.processingStatus).toBe(
        ProcessingStatus.NORMALIZATION_FAILED,
      );
      expect(result.webhookLogId).toBeDefined(); // Webhook must be logged
    });

    it('should handle lifecycle hooks', async () => {
      let webhookFateCalled = false;
      let errorCalled = false;

      // Create processor with hooks
      const hookedConfig: PipelineConfig = {
        ...config,
        hooks: {
          onWebhookFate: async (result) => {
            webhookFateCalled = true;
            expect(result.provider).toBe('mock');
          },
          onError: async (error, context) => {
            errorCalled = true;
          },
        },
      };

      const hookedProcessor = new WebhookProcessor(hookedConfig);

      const webhook = MockWebhookFactory.paymentSuccessful();
      await hookedProcessor.processWebhook(
        'mock',
        webhook.body,
        webhook.headers,
      );

      expect(webhookFateCalled).toBe(true);
      expect(errorCalled).toBe(false); // No error occurred
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
          }),
        ),
      );

      // Move all transactions to PROCESSING state
      await Promise.all(
        transactions.map((txn) =>
          storageAdapter.updateTransactionStatus(
            txn.id,
            TransactionStatus.PROCESSING,
            {
              transactionId: txn.id,
              fromStatus: TransactionStatus.PENDING,
              toStatus: TransactionStatus.PROCESSING,
              triggerType: TriggerType.MANUAL,
              actor: 'test',
            },
          ),
        ),
      );

      // Generate webhooks for all transactions
      const webhooks = transactions.map((txn) =>
        providerAdapter.generateSignedWebhook('payment.success', {
          reference: `prov_batch_${txn.id}`,
          provider_ref: `prov_batch_${txn.id}`,
          amount: txn.money.amount,
          currency: txn.money.currency,
          metadata: {
            applicationRef: txn.applicationRef,
          },
        }),
      );

      // Process all webhooks concurrently
      const results = await Promise.all(
        webhooks.map((webhook) =>
          processor.processWebhook('mock', webhook.body, webhook.headers),
        ),
      );

      // Verify all succeeded
      expect(results.every((r) => r.success)).toBe(true);
      expect(
        results.every((r) => r.processingStatus === ProcessingStatus.PROCESSED),
      ).toBe(true);

      // Verify all transactions were updated
      const updatedTransactions = await Promise.all(
        transactions.map((txn) =>
          storageAdapter.findTransaction({ id: txn.id }),
        ),
      );

      expect(
        updatedTransactions.every(
          (t) => t?.status === TransactionStatus.SUCCESSFUL,
        ),
      ).toBe(true);
    });
  });
});
