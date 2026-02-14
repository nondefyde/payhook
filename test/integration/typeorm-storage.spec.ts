import { DataSource } from 'typeorm';
import {
  TypeORMStorageAdapter,
  createDataSource,
  TransactionStatus,
  ProcessingStatus,
  AuditAction,
  DispatchStatus,
} from '../../src';

describe('TypeORM Storage Adapter Integration Tests', () => {
  let dataSource: DataSource;
  let adapter: TypeORMStorageAdapter;

  beforeAll(async () => {
    // Create test database connection
    dataSource = createDataSource({
      database: 'payhook_test',
      synchronize: true, // Auto-create tables for testing
      logging: false,
    });

    await dataSource.initialize();
    adapter = new TypeORMStorageAdapter(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // Clear all tables before each test
    await dataSource.query('TRUNCATE TABLE audit_logs CASCADE');
    await dataSource.query('TRUNCATE TABLE webhook_logs CASCADE');
    await dataSource.query('TRUNCATE TABLE dispatch_logs CASCADE');
    await dataSource.query('TRUNCATE TABLE outbox_events CASCADE');
    await dataSource.query('TRUNCATE TABLE transactions CASCADE');
  });

  describe('Transaction Operations', () => {
    it('should create a transaction', async () => {
      const transaction = await adapter.createTransaction({
        applicationRef: 'app_test_001',
        provider: 'paystack',
        amount: 10000,
        currency: 'NGN',
        metadata: {
          orderId: 'order_123',
        },
      });

      expect(transaction).toBeDefined();
      expect(transaction.id).toBeDefined();
      expect(transaction.applicationRef).toBe('app_test_001');
      expect(transaction.status).toBe(TransactionStatus.PENDING);
      expect(transaction.money.amount).toBe(10000);
      expect(transaction.money.currency).toBe('NGN');
    });

    it('should enforce unique application reference', async () => {
      await adapter.createTransaction({
        applicationRef: 'unique_ref',
        provider: 'mock',
        amount: 5000,
        currency: 'USD',
      });

      await expect(
        adapter.createTransaction({
          applicationRef: 'unique_ref',
          provider: 'mock',
          amount: 3000,
          currency: 'USD',
        })
      ).rejects.toThrow();
    });

    it('should update transaction status atomically with audit log', async () => {
      const transaction = await adapter.createTransaction({
        applicationRef: 'app_atomic',
        provider: 'mock',
        amount: 7500,
        currency: 'EUR',
      });

      const updated = await adapter.updateTransactionStatus(
        transaction.id,
        TransactionStatus.PROCESSING,
        {
          transactionId: transaction.id,
          action: AuditAction.WEBHOOK_STATE_TRANSITION,
          performedBy: 'system',
          performedAt: new Date(),
          stateBefore: TransactionStatus.PENDING,
          stateAfter: TransactionStatus.PROCESSING,
          metadata: { reason: 'Payment initiated' },
        },
      );

      expect(updated.status).toBe(TransactionStatus.PROCESSING);

      // Verify audit log was created
      const auditLogs = await adapter.getAuditLogs({
        transactionId: transaction.id,
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe(AuditAction.WEBHOOK_STATE_TRANSITION);
      expect(auditLogs[0].stateBefore).toBe(TransactionStatus.PENDING);
      expect(auditLogs[0].stateAfter).toBe(TransactionStatus.PROCESSING);
    });

    it('should handle concurrent updates with pessimistic locking', async () => {
      const transaction = await adapter.createTransaction({
        applicationRef: 'app_concurrent',
        provider: 'mock',
        amount: 1000,
        currency: 'USD',
      });

      // Simulate concurrent updates
      const promises = [
        adapter.updateTransactionStatus(
          transaction.id,
          TransactionStatus.SUCCESSFUL,
          {
            transactionId: transaction.id,
            action: AuditAction.WEBHOOK_STATE_TRANSITION,
            performedBy: 'system',
            performedAt: new Date(),
            stateBefore: TransactionStatus.PENDING,
            stateAfter: TransactionStatus.SUCCESSFUL,
          },
        ),
        adapter.updateTransactionStatus(
          transaction.id,
          TransactionStatus.FAILED,
          {
            transactionId: transaction.id,
            action: AuditAction.WEBHOOK_STATE_TRANSITION,
            performedBy: 'system',
            performedAt: new Date(),
            stateBefore: TransactionStatus.PENDING,
            stateAfter: TransactionStatus.FAILED,
          },
        ),
      ];

      const results = await Promise.allSettled(promises);

      // One should succeed, one should fail or have different result
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Check final state - should be one of the two
      const final = await adapter.findTransaction({ id: transaction.id });
      expect([TransactionStatus.SUCCESSFUL, TransactionStatus.FAILED]).toContain(final?.status);
    });

    it('should find transactions by various queries', async () => {
      // Create test transactions
      const txn1 = await adapter.createTransaction({
        applicationRef: 'find_001',
        provider: 'paystack',
        amount: 1000,
        currency: 'NGN',
      });

      const txn2 = await adapter.createTransaction({
        applicationRef: 'find_002',
        provider: 'stripe',
        amount: 2000,
        currency: 'USD',
      });

      await adapter.markAsProcessing(
        txn2.id,
        { providerRef: 'stripe_ref_123' },
        {
          transactionId: txn2.id,
          action: AuditAction.MANUAL_TRANSITION,
          performedBy: 'test',
          performedAt: new Date(),
          stateBefore: TransactionStatus.PENDING,
          stateAfter: TransactionStatus.PROCESSING,
        },
      );

      // Find by application ref
      const byAppRef = await adapter.findTransaction({
        applicationRef: 'find_001',
      });
      expect(byAppRef?.id).toBe(txn1.id);

      // Find by provider
      const byProvider = await adapter.findTransactions({ provider: 'stripe' });
      expect(byProvider).toHaveLength(1);
      expect(byProvider[0].id).toBe(txn2.id);

      // Find by provider ref
      const byProviderRef = await adapter.findTransaction({
        provider: 'stripe',
        providerRef: 'stripe_ref_123',
      });
      expect(byProviderRef?.id).toBe(txn2.id);

      // Count transactions
      const count = await adapter.countTransactions({ status: TransactionStatus.PENDING });
      expect(count).toBe(1); // Only txn1 is still pending
    });
  });

  describe('Webhook Log Operations', () => {
    it('should create and query webhook logs', async () => {
      const transaction = await adapter.createTransaction({
        applicationRef: 'webhook_test',
        provider: 'mock',
        amount: 5000,
        currency: 'USD',
      });

      const webhookLog = await adapter.createWebhookLog({
        provider: 'mock',
        eventType: 'payment.success',
        providerEventId: 'evt_123',
        rawPayload: Buffer.from(JSON.stringify({ test: true })),
        headers: { 'x-signature': 'test-sig' },
        signatureValid: true,
        processingStatus: ProcessingStatus.PROCESSED,
        processingDurationMs: 150,
        receivedAt: new Date(),
        transactionId: transaction.id,
        metadata: { processed: true },
      });

      expect(webhookLog).toBeDefined();
      expect(webhookLog.transactionId).toBe(transaction.id);

      // Find by transaction
      const logs = await adapter.findWebhookLogs({
        transactionId: transaction.id,
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].providerEventId).toBe('evt_123');

      // Update status
      await adapter.updateWebhookLogStatus(
        webhookLog.id,
        ProcessingStatus.DUPLICATE,
        { duplicateOf: 'evt_000' },
      );

      const updated = await adapter.findWebhookLogs({ id: webhookLog.id });
      expect(updated[0].processingStatus).toBe(ProcessingStatus.DUPLICATE);
    });

    it('should enforce unique provider event IDs', async () => {
      await adapter.createWebhookLog({
        provider: 'paystack',
        eventType: 'charge.success',
        providerEventId: 'unique_evt_001',
        signatureValid: true,
        processingStatus: ProcessingStatus.PROCESSED,
        receivedAt: new Date(),
      });

      await expect(
        adapter.createWebhookLog({
          provider: 'paystack',
          eventType: 'charge.success',
          providerEventId: 'unique_evt_001',
          signatureValid: true,
          processingStatus: ProcessingStatus.PROCESSED,
          receivedAt: new Date(),
        })
      ).rejects.toThrow();
    });
  });

  describe('Outbox Event Operations', () => {
    it('should create and process outbox events', async () => {
      const outboxEvent = await adapter.createOutboxEvent({
        eventType: 'payment.succeeded',
        aggregateId: 'txn_123',
        aggregateType: 'transaction',
        payload: { amount: 1000, currency: 'USD' },
        metadata: { source: 'webhook' },
      });

      expect(outboxEvent).toBeDefined();
      expect(outboxEvent.status).toBe('pending');

      // Get pending events
      const pending = await adapter.getOutboxEvents({
        status: 'pending',
        scheduledBefore: new Date(Date.now() + 60000),
      });
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(outboxEvent.id);

      // Mark as processed
      await adapter.markOutboxEventProcessed(outboxEvent.id);

      const processed = await adapter.getOutboxEvents({
        status: 'delivered',
      });
      expect(processed).toHaveLength(1);
    });

    it('should handle outbox event failures with retry', async () => {
      const outboxEvent = await adapter.createOutboxEvent({
        eventType: 'payment.failed',
        aggregateId: 'txn_fail',
        aggregateType: 'transaction',
        payload: { error: 'Insufficient funds' },
      });

      // Simulate first failure
      await adapter.markOutboxEventFailed(outboxEvent.id, 'Handler error');

      const failed = await adapter.getOutboxEvents({
        status: 'failed',
      });
      expect(failed).toHaveLength(1);
      expect(failed[0].retryCount).toBe(1);

      // Simulate max retries exceeded
      await adapter.markOutboxEventFailed(outboxEvent.id, 'Handler error');
      await adapter.markOutboxEventFailed(outboxEvent.id, 'Handler error');

      const deadLetter = await adapter.getOutboxEvents({
        status: 'dead_letter',
      });
      expect(deadLetter).toHaveLength(1);
    });
  });

  describe('Transaction Support', () => {
    it('should rollback on error within transaction', async () => {
      const transaction = await adapter.createTransaction({
        applicationRef: 'rollback_test',
        provider: 'mock',
        amount: 3000,
        currency: 'EUR',
      });

      try {
        await adapter.withTransaction(async (manager) => {
          // This should work
          await manager.save('AuditLogEntity', {
            transactionId: transaction.id,
            action: AuditAction.MANUAL_TRANSITION,
            performedBy: 'test',
            performedAt: new Date(),
            stateBefore: TransactionStatus.PENDING,
            stateAfter: TransactionStatus.PROCESSING,
          });

          // This should cause an error
          throw new Error('Simulated error');
        });
      } catch (error) {
        // Expected
      }

      // Verify audit log was not saved (rolled back)
      const auditLogs = await adapter.getAuditLogs({
        transactionId: transaction.id,
      });
      expect(auditLogs).toHaveLength(0);
    });
  });

  describe('Health Check', () => {
    it('should report healthy when database is accessible', async () => {
      const isHealthy = await adapter.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it('should get statistics', async () => {
      // Create some test data
      await adapter.createTransaction({
        applicationRef: 'stats_001',
        provider: 'mock',
        amount: 1000,
        currency: 'USD',
      });

      await adapter.createWebhookLog({
        provider: 'mock',
        eventType: 'test',
        providerEventId: 'evt_stats',
        signatureValid: true,
        processingStatus: ProcessingStatus.PROCESSED,
        receivedAt: new Date(),
      });

      const stats = await adapter.getStatistics();
      expect(stats.totalTransactions).toBe(1);
      expect(stats.totalWebhooks).toBe(1);
      expect(stats.totalAuditLogs).toBe(0);
    });
  });
});