import {
  TransactionService,
  MockStorageAdapter,
  MockProviderAdapter,
  TransactionStateMachine,
  TransactionStatus,
  VerificationMethod,
  Money,
} from '../../src';

describe('TransactionService Integration Tests', () => {
  let service: TransactionService;
  let storageAdapter: MockStorageAdapter;
  let stateMachine: TransactionStateMachine;
  let providerAdapters: Map<string, MockProviderAdapter>;

  beforeEach(() => {
    storageAdapter = new MockStorageAdapter();
    stateMachine = new TransactionStateMachine();
    providerAdapters = new Map([
      ['mock', new MockProviderAdapter()],
      ['paystack', new MockProviderAdapter()], // Simulating multiple providers
    ]);

    service = new TransactionService(storageAdapter, providerAdapters, stateMachine);
  });

  afterEach(() => {
    storageAdapter.clear();
  });

  describe('Transaction Creation', () => {
    it('should create a new transaction', async () => {
      const transaction = await service.createTransaction({
        applicationRef: 'app_001',
        provider: 'mock',
        amount: 10000,
        currency: 'NGN',
        metadata: {
          orderId: 'order_123',
          customerId: 'cust_456',
        },
      });

      expect(transaction).toBeDefined();
      expect(transaction.applicationRef).toBe('app_001');
      expect(transaction.provider).toBe('mock');
      expect(transaction.status).toBe(TransactionStatus.PENDING);
      expect(transaction.money.amount).toBe(10000);
      expect(transaction.money.currency).toBe('NGN');

      // Verify audit log was created
      const auditLogs = await service.getAuditTrail(transaction.id);
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('TRANSACTION_CREATED');
    });

    it('should validate money amounts', async () => {
      await expect(
        service.createTransaction({
          applicationRef: 'app_invalid',
          provider: 'mock',
          amount: 100.50, // Non-integer amount
          currency: 'USD',
        })
      ).rejects.toThrow('Amount must be an integer');
    });
  });

  describe('Mark as Processing', () => {
    it('should transition transaction to processing state', async () => {
      const transaction = await service.createTransaction({
        applicationRef: 'app_002',
        provider: 'mock',
        amount: 5000,
        currency: 'USD',
      });

      const updated = await service.markAsProcessing(transaction.id, {
        providerRef: 'prov_002',
        verificationMethod: VerificationMethod.WEBHOOK_ONLY,
      });

      expect(updated.status).toBe(TransactionStatus.PROCESSING);
      expect(updated.providerRef).toBe('prov_002');
      expect(updated.verificationMethod).toBe(VerificationMethod.WEBHOOK_ONLY);

      // Verify audit trail
      const auditLogs = await service.getAuditTrail(transaction.id);
      expect(auditLogs).toHaveLength(2);
      const transition = auditLogs.find(log => log.action === 'MANUAL_TRANSITION');
      expect(transition?.stateBefore).toBe(TransactionStatus.PENDING);
      expect(transition?.stateAfter).toBe(TransactionStatus.PROCESSING);
    });

    it('should reject invalid state transitions', async () => {
      const transaction = await service.createTransaction({
        applicationRef: 'app_003',
        provider: 'mock',
        amount: 3000,
        currency: 'EUR',
      });

      // Set to FAILED state
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

      // Try to mark as processing (should fail)
      await expect(
        service.markAsProcessing(transaction.id, {
          providerRef: 'prov_003',
        })
      ).rejects.toThrow('Cannot transition from failed to processing');
    });
  });

  describe('Query Operations', () => {
    it('should get transaction by ID with optional data', async () => {
      const created = await service.createTransaction({
        applicationRef: 'app_query',
        provider: 'mock',
        amount: 7500,
        currency: 'GBP',
      });

      // Create some webhook logs
      await storageAdapter.createWebhookLog({
        provider: 'mock',
        eventType: 'payment.success',
        providerEventId: 'evt_001',
        transactionId: created.id,
        signatureValid: true,
        processingStatus: 'processed',
        processingDurationMs: 100,
        receivedAt: new Date(),
      });

      // Get with webhooks
      const withWebhooks = await service.getTransaction(created.id, {
        includeWebhooks: true,
      });

      expect(withWebhooks?.metadata?.webhooks).toBeDefined();
      expect(withWebhooks?.metadata?.webhooks).toHaveLength(1);

      // Get with audit trail
      const withAudit = await service.getTransaction(created.id, {
        includeAuditTrail: true,
      });

      expect(withAudit?.metadata?.auditTrail).toBeDefined();
      expect(withAudit?.metadata?.auditTrail).toHaveLength(1);
    });

    it('should get transaction by application reference', async () => {
      const created = await service.createTransaction({
        applicationRef: 'unique_app_ref_123',
        provider: 'paystack',
        amount: 12000,
        currency: 'NGN',
      });

      const found = await service.getTransactionByApplicationRef('unique_app_ref_123');

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.applicationRef).toBe('unique_app_ref_123');
    });

    it('should get transaction by provider reference', async () => {
      const created = await service.createTransaction({
        applicationRef: 'app_prov',
        provider: 'mock',
        amount: 8000,
        currency: 'USD',
      });

      await service.markAsProcessing(created.id, {
        providerRef: 'unique_prov_ref_456',
      });

      const found = await service.getTransactionByProviderRef('mock', 'unique_prov_ref_456');

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.providerRef).toBe('unique_prov_ref_456');
    });

    it('should list transactions by status', async () => {
      // Create multiple transactions
      await Promise.all([
        service.createTransaction({
          applicationRef: 'app_list_1',
          provider: 'mock',
          amount: 1000,
          currency: 'USD',
        }),
        service.createTransaction({
          applicationRef: 'app_list_2',
          provider: 'mock',
          amount: 2000,
          currency: 'USD',
        }),
        service.createTransaction({
          applicationRef: 'app_list_3',
          provider: 'paystack',
          amount: 3000,
          currency: 'NGN',
        }),
      ]);

      // List all pending transactions
      const pending = await service.listTransactionsByStatus(TransactionStatus.PENDING);

      expect(pending.transactions).toHaveLength(3);
      expect(pending.total).toBe(3);
      expect(pending.hasMore).toBe(false);

      // List with provider filter
      const mockOnly = await service.listTransactionsByStatus(TransactionStatus.PENDING, {
        provider: 'mock',
      });

      expect(mockOnly.transactions).toHaveLength(2);
      expect(mockOnly.total).toBe(2);

      // List with pagination
      const paginated = await service.listTransactionsByStatus(TransactionStatus.PENDING, {
        limit: 2,
        offset: 0,
      });

      expect(paginated.transactions).toHaveLength(2);
      expect(paginated.total).toBe(3);
      expect(paginated.hasMore).toBe(true);
    });
  });

  describe('Reconciliation', () => {
    it('should reconcile transaction with provider', async () => {
      const transaction = await service.createTransaction({
        applicationRef: 'app_reconcile',
        provider: 'mock',
        amount: 5000,
        currency: 'USD',
      });

      await service.markAsProcessing(transaction.id, {
        providerRef: 'prov_reconcile',
      });

      // Mock provider verification result
      const mockProvider = providerAdapters.get('mock')!;
      mockProvider.addMockTransaction('prov_reconcile', {
        status: 'successful',
        amount: 5000,
        currency: 'USD',
        reference: 'prov_reconcile',
        timestamp: new Date(),
      });

      // Reconcile
      const result = await service.reconcile(transaction.id, {
        updateStatus: true,
      });

      expect(result.success).toBe(true);
      expect(result.diverged).toBe(true); // Status was PROCESSING, provider says SUCCESSFUL
      expect(result.localStatus).toBe(TransactionStatus.PROCESSING);
      expect(result.providerStatus).toBe('successful');
      expect(result.corrected).toBe(true);
      expect(result.newStatus).toBe(TransactionStatus.SUCCESSFUL);

      // Verify status was updated
      const updated = await service.getTransaction(transaction.id);
      expect(updated?.status).toBe(TransactionStatus.SUCCESSFUL);

      // Verify audit log
      const auditLogs = await service.getAuditTrail(transaction.id);
      const reconciliation = auditLogs.find(log => log.action === 'RECONCILIATION');
      expect(reconciliation).toBeDefined();
      expect(reconciliation?.metadata?.diverged).toBe(true);
    });

    it('should detect stale transactions', async () => {
      // Create old transaction
      const oldTransaction = await service.createTransaction({
        applicationRef: 'app_stale',
        provider: 'mock',
        amount: 1000,
        currency: 'EUR',
      });

      await service.markAsProcessing(oldTransaction.id, {
        providerRef: 'prov_stale',
      });

      // Manually set created date to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await storageAdapter.updateTransaction(oldTransaction.id, {
        metadata: {
          createdAt: twoHoursAgo,
        },
      });

      // Scan for stale transactions
      const staleTransactions = await service.scanStaleTransactions({
        staleAfterMinutes: 60, // Stale after 1 hour
      });

      expect(staleTransactions).toHaveLength(1);
      expect(staleTransactions[0].id).toBe(oldTransaction.id);
    });
  });

  describe('Statistics', () => {
    it('should calculate transaction statistics', async () => {
      // Create various transactions
      const transactions = await Promise.all([
        service.createTransaction({
          applicationRef: 'stats_1',
          provider: 'mock',
          amount: 10000,
          currency: 'NGN',
        }),
        service.createTransaction({
          applicationRef: 'stats_2',
          provider: 'mock',
          amount: 5000,
          currency: 'NGN',
        }),
        service.createTransaction({
          applicationRef: 'stats_3',
          provider: 'paystack',
          amount: 20000,
          currency: 'NGN',
        }),
      ]);

      // Update some to successful
      await storageAdapter.updateTransactionStatus(
        transactions[0].id,
        TransactionStatus.SUCCESSFUL,
        {
          transactionId: transactions[0].id,
          action: 'WEBHOOK_STATE_TRANSITION',
          performedBy: 'system',
          performedAt: new Date(),
          stateBefore: TransactionStatus.PENDING,
          stateAfter: TransactionStatus.SUCCESSFUL,
        },
      );

      await storageAdapter.updateTransactionStatus(
        transactions[1].id,
        TransactionStatus.SUCCESSFUL,
        {
          transactionId: transactions[1].id,
          action: 'WEBHOOK_STATE_TRANSITION',
          performedBy: 'system',
          performedAt: new Date(),
          stateBefore: TransactionStatus.PENDING,
          stateAfter: TransactionStatus.SUCCESSFUL,
        },
      );

      // Get statistics
      const stats = await service.getStatistics();

      expect(stats.total).toBe(3);
      expect(stats.byStatus[TransactionStatus.PENDING]).toBe(1);
      expect(stats.byStatus[TransactionStatus.SUCCESSFUL]).toBe(2);
      expect(stats.byProvider['mock']).toBe(2);
      expect(stats.byProvider['paystack']).toBe(1);
      expect(stats.totalAmount['NGN']).toBe(15000); // Only successful transactions
    });
  });

  describe('Metadata Updates', () => {
    it('should update transaction metadata', async () => {
      const transaction = await service.createTransaction({
        applicationRef: 'app_metadata',
        provider: 'mock',
        amount: 3000,
        currency: 'USD',
        metadata: {
          original: 'value',
        },
      });

      const updated = await service.updateTransactionMetadata(transaction.id, {
        additional: 'data',
        timestamp: new Date(),
      });

      expect(updated.metadata.original).toBe('value');
      expect(updated.metadata.additional).toBe('data');
      expect(updated.metadata.timestamp).toBeDefined();
      expect(updated.metadata.lastUpdated).toBeDefined();

      // Verify audit log
      const auditLogs = await service.getAuditTrail(transaction.id);
      const metadataUpdate = auditLogs.find(log => log.action === 'METADATA_UPDATED');
      expect(metadataUpdate).toBeDefined();
      expect(metadataUpdate?.metadata?.updatedFields).toContain('additional');
      expect(metadataUpdate?.metadata?.updatedFields).toContain('timestamp');
    });
  });
});