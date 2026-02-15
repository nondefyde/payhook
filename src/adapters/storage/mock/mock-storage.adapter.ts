import {
  StorageAdapter,
  Transaction,
  WebhookLog,
  AuditLog,
  DispatchLog,
  OutboxEvent,
  TransactionStatus,
  Pagination,
  PaginatedResult,
  TransactionQuery,
  TransactionFilter,
  WebhookFilter,
  UnmatchedFilter,
  OutboxFilter,
  CreateTransactionDto,
  CreateWebhookLogDto,
  CreateAuditLogDto,
  CreateDispatchLogDto,
  CreateOutboxEventDto,
  MarkAsProcessingDto,
  Money,
  ProcessingStatus,
  OutboxStatus,
  WebhookQuery,
  OutboxQuery,
} from '../../../core';

/**
 * Mock storage adapter for testing
 * Provides in-memory storage with deterministic behavior
 */
export class MockStorageAdapter implements StorageAdapter {
  private transactions: Map<string, Transaction> = new Map();
  private webhookLogs: Map<string, WebhookLog> = new Map();
  private auditLogs: Map<string, AuditLog> = new Map();
  private dispatchLogs: Map<string, DispatchLog> = new Map();
  private outboxEvents: Map<string, OutboxEvent> = new Map();

  // Indexes for efficient lookups
  private transactionsByAppRef: Map<string, string> = new Map();
  private transactionsByProviderRef: Map<string, string> = new Map();
  private webhooksByProviderEventId: Map<string, string> = new Map();

  // Transaction support
  private currentTransaction: any = null;
  private transactionRollbackData: any = null;

  // ID generation
  private idCounter = 0;

  constructor(private readonly options: MockStorageOptions = {}) {
    this.options = {
      simulateLatency: false,
      latencyMs: 10,
      throwOnError: false,
      ...options,
    };
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `mock-${++this.idCounter}-${Date.now()}`;
  }

  /**
   * Simulate network latency if configured
   */
  private async simulateLatency(): Promise<void> {
    if (this.options.simulateLatency && this.options.latencyMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.latencyMs),
      );
    }
  }

  // ==================== Transaction Operations ====================

  async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
    await this.simulateLatency();

    const id = this.generateId();
    const money = new Money(dto.amount, dto.currency);

    const transaction = new Transaction(
      id,
      dto.applicationRef,
      dto.provider,
      TransactionStatus.PENDING,
      money,
      null,
      undefined,
      dto.metadata,
    );

    this.transactions.set(id, transaction);
    this.transactionsByAppRef.set(dto.applicationRef, id);

    return transaction;
  }

  async updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    auditEntry: CreateAuditLogDto,
  ): Promise<Transaction> {
    await this.simulateLatency();

    const transaction = this.transactions.get(id);
    if (!transaction) {
      throw new Error(`Transaction not found: ${id}`);
    }

    // Update transaction status
    transaction.updateStatus(status);
    this.transactions.set(id, transaction);

    // Create audit log
    await this.createAuditLog({
      ...auditEntry,
      transactionId: id,
    });

    return transaction;
  }

  async markAsProcessing(
    id: string,
    dto: MarkAsProcessingDto,
    auditEntry: CreateAuditLogDto,
  ): Promise<Transaction> {
    await this.simulateLatency();

    const transaction = this.transactions.get(id);
    if (!transaction) {
      throw new Error(`Transaction not found: ${id}`);
    }

    // Link provider reference
    transaction.linkProviderRef(dto.providerRef);
    if (dto.providerCreatedAt) {
      transaction.providerCreatedAt = dto.providerCreatedAt;
    }

    // Update status
    transaction.updateStatus(TransactionStatus.PROCESSING);

    this.transactions.set(id, transaction);
    this.transactionsByProviderRef.set(dto.providerRef, id);

    // Create audit log
    await this.createAuditLog({
      ...auditEntry,
      transactionId: id,
    });

    return transaction;
  }

  async findTransaction(query: TransactionQuery): Promise<Transaction | null> {
    await this.simulateLatency();

    let transactionId: string | undefined;

    if (query.id) {
      transactionId = query.id;
    } else if (query.applicationRef) {
      transactionId = this.transactionsByAppRef.get(query.applicationRef);
    } else if (query.providerRef) {
      transactionId = this.transactionsByProviderRef.get(query.providerRef);
    }

    return transactionId ? this.transactions.get(transactionId) || null : null;
  }

  async findTransactions(
    query: TransactionQuery,
    pagination?: Pagination,
  ): Promise<Transaction[]> {
    await this.simulateLatency();

    let filtered = Array.from(this.transactions.values());

    // Apply query filters
    if (query.id) {
      filtered = filtered.filter((t) => t.id === query.id);
    }
    if (query.applicationRef) {
      filtered = filtered.filter(
        (t) => t.applicationRef === query.applicationRef,
      );
    }
    if (query.providerRef) {
      filtered = filtered.filter((t) => t.providerRef === query.providerRef);
    }
    if (query.provider) {
      filtered = filtered.filter((t) => t.provider === query.provider);
    }
    if (query.status) {
      filtered = filtered.filter((t) => t.status === query.status);
    }
    if (query.createdAfter) {
      filtered = filtered.filter((t) => t.createdAt >= query.createdAfter!);
    }
    if (query.createdBefore) {
      filtered = filtered.filter((t) => t.createdAt <= query.createdBefore!);
    }

    // Apply pagination if provided
    if (pagination) {
      const start = (pagination.page - 1) * pagination.limit;
      filtered = filtered.slice(start, start + pagination.limit);
    }

    return filtered;
  }

  async countTransactions(query: TransactionQuery): Promise<number> {
    await this.simulateLatency();

    let filtered = Array.from(this.transactions.values());

    // Apply query filters
    if (query.id) {
      filtered = filtered.filter((t) => t.id === query.id);
    }
    if (query.applicationRef) {
      filtered = filtered.filter(
        (t) => t.applicationRef === query.applicationRef,
      );
    }
    if (query.providerRef) {
      filtered = filtered.filter((t) => t.providerRef === query.providerRef);
    }
    if (query.provider) {
      filtered = filtered.filter((t) => t.provider === query.provider);
    }
    if (query.status) {
      filtered = filtered.filter((t) => t.status === query.status);
    }
    if (query.createdAfter) {
      filtered = filtered.filter((t) => t.createdAt >= query.createdAfter!);
    }
    if (query.createdBefore) {
      filtered = filtered.filter((t) => t.createdAt <= query.createdBefore!);
    }

    return filtered.length;
  }

  async updateTransaction(
    id: string,
    updates: Partial<Transaction>,
  ): Promise<Transaction> {
    await this.simulateLatency();

    const transaction = this.transactions.get(id);
    if (!transaction) {
      throw new Error(`Transaction not found: ${id}`);
    }

    // Apply updates
    Object.assign(transaction, updates);
    this.transactions.set(id, transaction);

    return transaction;
  }

  async linkProviderRef(
    transactionId: string,
    providerRef: string,
  ): Promise<void> {
    await this.simulateLatency();

    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    transaction.linkProviderRef(providerRef);
    this.transactions.set(transactionId, transaction);
    this.transactionsByProviderRef.set(providerRef, transactionId);
  }

  async listTransactions(
    filter: TransactionFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<Transaction>> {
    await this.simulateLatency();

    let filtered = Array.from(this.transactions.values());

    // Apply filters
    if (filter.status) {
      filtered = filtered.filter((t) => t.status === filter.status);
    }
    if (filter.provider) {
      filtered = filtered.filter((t) => t.provider === filter.provider);
    }
    if (filter.currency) {
      filtered = filtered.filter((t) => t.currency === filter.currency);
    }
    if (filter.minAmount !== undefined) {
      filtered = filtered.filter((t) => t.amount >= filter.minAmount!);
    }
    if (filter.maxAmount !== undefined) {
      filtered = filtered.filter((t) => t.amount <= filter.maxAmount!);
    }
    if (filter.fromDate) {
      filtered = filtered.filter((t) => t.createdAt >= filter.fromDate!);
    }
    if (filter.toDate) {
      filtered = filtered.filter((t) => t.createdAt <= filter.toDate!);
    }

    // Apply pagination
    const total = filtered.length;
    const start = (pagination.page - 1) * pagination.limit;
    const items = filtered.slice(start, start + pagination.limit);

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  async findStaleTransactions(
    olderThanMinutes: number,
    limit?: number,
  ): Promise<Transaction[]> {
    await this.simulateLatency();

    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const stale = Array.from(this.transactions.values())
      .filter(
        (t) =>
          t.status === TransactionStatus.PROCESSING && t.updatedAt < cutoff,
      )
      .slice(0, limit);

    return stale;
  }

  async lockTransactionForUpdate(id: string): Promise<Transaction | null> {
    await this.simulateLatency();

    // In mock, we just return the transaction
    // Real implementation would use row-level locking
    return this.transactions.get(id) || null;
  }

  // ==================== Webhook Log Operations ====================

  async createWebhookLog(dto: CreateWebhookLogDto): Promise<WebhookLog> {
    await this.simulateLatency();

    const id = this.generateId();

    const webhookLog = new WebhookLog(
      id,
      dto.provider,
      dto.providerEventId,
      dto.eventType,
      dto.rawPayload,
      dto.signatureValid,
      dto.processingStatus,
      new Date(),
      dto.transactionId,
      dto.normalizedEvent,
      dto.errorMessage,
      dto.headers,
      dto.processingDurationMs,
    );

    this.webhookLogs.set(id, webhookLog);

    // Index by provider event ID for duplicate detection
    const key = `${dto.provider}:${dto.providerEventId}`;
    this.webhooksByProviderEventId.set(key, id);

    return webhookLog;
  }

  async findWebhookLog(id: string): Promise<WebhookLog | null> {
    await this.simulateLatency();
    return this.webhookLogs.get(id) || null;
  }

  async findWebhookLogByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookLog | null> {
    await this.simulateLatency();

    const key = `${provider}:${providerEventId}`;
    const id = this.webhooksByProviderEventId.get(key);

    return id ? this.webhookLogs.get(id) || null : null;
  }

  async updateWebhookLog(
    id: string,
    updates: Partial<WebhookLog>,
  ): Promise<WebhookLog> {
    await this.simulateLatency();

    const webhookLog = this.webhookLogs.get(id);
    if (!webhookLog) {
      throw new Error(`Webhook log not found: ${id}`);
    }

    // Apply updates
    Object.assign(webhookLog, updates);
    this.webhookLogs.set(id, webhookLog);

    return webhookLog;
  }

  async findWebhookLogs(
    criteria: Partial<WebhookLog>,
    pagination?: Pagination,
  ): Promise<WebhookLog[]> {
    await this.simulateLatency();

    let filtered = Array.from(this.webhookLogs.values());

    // Apply criteria filters
    if (criteria.id) {
      filtered = filtered.filter((w) => w.id === criteria.id);
    }
    if (criteria.provider) {
      filtered = filtered.filter((w) => w.provider === criteria.provider);
    }
    if (criteria.providerEventId) {
      filtered = filtered.filter(
        (w) => w.providerEventId === criteria.providerEventId,
      );
    }
    if (criteria.eventType) {
      filtered = filtered.filter((w) => w.eventType === criteria.eventType);
    }
    if (criteria.processingStatus !== undefined) {
      filtered = filtered.filter(
        (w) => w.processingStatus === criteria.processingStatus,
      );
    }
    if (criteria.transactionId) {
      filtered = filtered.filter(
        (w) => w.transactionId === criteria.transactionId,
      );
    }
    if (criteria.signatureValid !== undefined) {
      filtered = filtered.filter(
        (w) => w.signatureValid === criteria.signatureValid,
      );
    }

    // Apply pagination if provided
    if (pagination) {
      const start = (pagination.page - 1) * pagination.limit;
      filtered = filtered.slice(start, start + pagination.limit);
    }

    return filtered;
  }

  async updateWebhookLogStatus(
    id: string,
    status: any,
    errorMessage?: string,
  ): Promise<WebhookLog> {
    await this.simulateLatency();

    const webhookLog = this.webhookLogs.get(id);
    if (!webhookLog) {
      throw new Error(`Webhook log not found: ${id}`);
    }

    webhookLog.processingStatus = status;
    if (errorMessage !== undefined) {
      webhookLog.errorMessage = errorMessage;
    }
    this.webhookLogs.set(id, webhookLog);

    return webhookLog;
  }

  async linkWebhookToTransaction(
    webhookId: string,
    transactionId: string,
  ): Promise<void> {
    await this.simulateLatency();

    const webhookLog = this.webhookLogs.get(webhookId);
    if (!webhookLog) {
      throw new Error(`Webhook log not found: ${webhookId}`);
    }

    webhookLog.transactionId = transactionId;
    this.webhookLogs.set(webhookId, webhookLog);
  }

  async countWebhookLogs(query: WebhookQuery): Promise<number> {
    await this.simulateLatency();

    let filtered = Array.from(this.webhookLogs.values());

    // Apply query filters
    if (query.id) {
      filtered = filtered.filter((w) => w.id === query.id);
    }
    if (query.provider) {
      filtered = filtered.filter((w) => w.provider === query.provider);
    }
    if (query.providerEventId) {
      filtered = filtered.filter(
        (w) => w.providerEventId === query.providerEventId,
      );
    }
    if (query.transactionId) {
      filtered = filtered.filter(
        (w) => w.transactionId === query.transactionId,
      );
    }
    if (query.processingStatus !== undefined) {
      filtered = filtered.filter(
        (w) => w.processingStatus === query.processingStatus,
      );
    }
    if (query.receivedAfter) {
      filtered = filtered.filter((w) => w.receivedAt >= query.receivedAfter!);
    }
    if (query.receivedBefore) {
      filtered = filtered.filter((w) => w.receivedAt <= query.receivedBefore!);
    }

    return filtered.length;
  }

  async listUnmatchedWebhooks(
    filter: UnmatchedFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<WebhookLog>> {
    await this.simulateLatency();

    let filtered = Array.from(this.webhookLogs.values()).filter(
      (w) => w.processingStatus === ProcessingStatus.UNMATCHED,
    );

    // Apply filters
    if (filter.provider) {
      filtered = filtered.filter((w) => w.provider === filter.provider);
    }
    if (filter.eventType) {
      filtered = filtered.filter((w) => w.eventType === filter.eventType);
    }
    if (filter.fromDate) {
      filtered = filtered.filter((w) => w.receivedAt >= filter.fromDate!);
    }
    if (filter.toDate) {
      filtered = filtered.filter((w) => w.receivedAt <= filter.toDate!);
    }

    // Apply pagination
    const total = filtered.length;
    const start = (pagination.page - 1) * pagination.limit;
    const items = filtered.slice(start, start + pagination.limit);

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  async listWebhookLogs(
    filter: WebhookFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<WebhookLog>> {
    await this.simulateLatency();

    let filtered = Array.from(this.webhookLogs.values());

    // Apply filters
    if (filter.provider) {
      filtered = filtered.filter((w) => w.provider === filter.provider);
    }
    if (filter.processingStatus) {
      filtered = filtered.filter(
        (w) => w.processingStatus === filter.processingStatus,
      );
    }
    if (filter.transactionId) {
      filtered = filtered.filter(
        (w) => w.transactionId === filter.transactionId,
      );
    }
    if (filter.fromDate) {
      filtered = filtered.filter((w) => w.receivedAt >= filter.fromDate!);
    }
    if (filter.toDate) {
      filtered = filtered.filter((w) => w.receivedAt <= filter.toDate!);
    }

    // Apply pagination
    const total = filtered.length;
    const start = (pagination.page - 1) * pagination.limit;
    const items = filtered.slice(start, start + pagination.limit);

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  // ==================== Audit Log Operations ====================

  async createAuditLog(dto: CreateAuditLogDto): Promise<AuditLog> {
    await this.simulateLatency();

    const id = this.generateId();

    const auditLog = new AuditLog(
      id,
      dto.transactionId,
      dto.stateBefore ?? dto.fromStatus ?? null, // stateBefore is primary, fromStatus is fallback
      dto.stateAfter ?? dto.toStatus ?? TransactionStatus.PENDING, // stateAfter is primary, toStatus is fallback
      dto.triggerType as any,
      new Date(),
      dto.webhookLogId,
      dto.reconciliationResult !== undefined ? dto.reconciliationResult : null,
      dto.verificationMethod as any,
      dto.action ? { ...dto.metadata, action: dto.action } : dto.metadata, // Include action in metadata
      dto.performedBy ?? dto.actor, // performedBy is primary, actor is fallback
      dto.reason,
    );

    this.auditLogs.set(id, auditLog);

    return auditLog;
  }

  async getAuditTrail(transactionId: string): Promise<AuditLog[]> {
    await this.simulateLatency();

    const trail = Array.from(this.auditLogs.values())
      .filter((a) => a.transactionId === transactionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return trail;
  }

  async getAuditLogs(transactionId: string): Promise<AuditLog[]> {
    // Alias for getAuditTrail
    return this.getAuditTrail(transactionId);
  }

  async listAuditLogs(
    fromDate: Date,
    toDate: Date,
    pagination: Pagination,
  ): Promise<PaginatedResult<AuditLog>> {
    await this.simulateLatency();

    const filtered = Array.from(this.auditLogs.values()).filter(
      (a) => a.createdAt >= fromDate && a.createdAt <= toDate,
    );

    // Apply pagination
    const total = filtered.length;
    const start = (pagination.page - 1) * pagination.limit;
    const items = filtered.slice(start, start + pagination.limit);

    return {
      items,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  // ==================== Dispatch Log Operations ====================

  async createDispatchLog(dto: CreateDispatchLogDto): Promise<DispatchLog> {
    await this.simulateLatency();

    const id = this.generateId();

    const dispatchLog = new DispatchLog(
      id,
      dto.transactionId,
      dto.eventType,
      dto.handlerName,
      dto.status as any,
      dto.isReplay,
      new Date(),
      dto.errorMessage,
      dto.executionDurationMs,
      dto.payload,
      0,
      dto.metadata,
    );

    this.dispatchLogs.set(id, dispatchLog);

    return dispatchLog;
  }

  async getDispatchLogs(transactionId: string): Promise<DispatchLog[]> {
    await this.simulateLatency();

    return Array.from(this.dispatchLogs.values())
      .filter((d) => d.transactionId === transactionId)
      .sort((a, b) => a.dispatchedAt.getTime() - b.dispatchedAt.getTime());
  }

  async findFailedDispatches(
    limit?: number,
    maxRetries?: number,
  ): Promise<DispatchLog[]> {
    await this.simulateLatency();

    return Array.from(this.dispatchLogs.values())
      .filter((d) => d.failed() && (!maxRetries || d.retryCount < maxRetries))
      .slice(0, limit);
  }

  // ==================== Outbox Operations ====================

  async createOutboxEvent(dto: CreateOutboxEventDto): Promise<OutboxEvent> {
    await this.simulateLatency();

    const id = this.generateId();

    const outboxEvent = OutboxEvent.forTransactionEvent(
      id,
      dto.transactionId || dto.aggregateId || '',
      dto.eventType,
      dto.payload,
      dto.metadata,
    );

    this.outboxEvents.set(id, outboxEvent);

    return outboxEvent;
  }

  async listPendingOutboxEvents(limit?: number): Promise<OutboxEvent[]> {
    await this.simulateLatency();

    return Array.from(this.outboxEvents.values())
      .filter((e) => e.status === OutboxStatus.PENDING)
      .slice(0, limit);
  }

  async markOutboxEventProcessed(id: string): Promise<OutboxEvent> {
    await this.simulateLatency();

    const event = this.outboxEvents.get(id);
    if (!event) {
      throw new Error(`Outbox event not found: ${id}`);
    }

    event.markAsProcessed();
    this.outboxEvents.set(id, event);

    return event;
  }

  async markOutboxEventFailed(
    id: string,
    errorMessage: string,
  ): Promise<OutboxEvent> {
    await this.simulateLatency();

    const event = this.outboxEvents.get(id);
    if (!event) {
      throw new Error(`Outbox event not found: ${id}`);
    }

    event.markAsFailed(errorMessage);
    this.outboxEvents.set(id, event);

    return event;
  }

  async findStaleOutboxEvents(
    olderThanMinutes: number,
    limit?: number,
  ): Promise<OutboxEvent[]> {
    await this.simulateLatency();

    return Array.from(this.outboxEvents.values())
      .filter((e) => e.isStale(olderThanMinutes))
      .slice(0, limit);
  }

  async getOutboxEvents(query: OutboxQuery): Promise<OutboxEvent[]> {
    await this.simulateLatency();

    let filtered = Array.from(this.outboxEvents.values());

    // Apply query filters
    if (query.id) {
      filtered = filtered.filter((e) => e.id === query.id);
    }
    if (query.transactionId) {
      filtered = filtered.filter(
        (e) => e.transactionId === query.transactionId,
      );
    }
    if (query.aggregateId) {
      filtered = filtered.filter((e) => e.transactionId === query.aggregateId);
    }
    if (query.eventType) {
      filtered = filtered.filter((e) => e.eventType === query.eventType);
    }
    if (query.status) {
      filtered = filtered.filter((e) => e.status === query.status);
    }
    if (query.scheduledBefore) {
      filtered = filtered.filter((e) => e.createdAt <= query.scheduledBefore!);
    }

    // Apply limit if provided
    if (query.limit) {
      filtered = filtered.slice(0, query.limit);
    }

    return filtered;
  }

  // ==================== Retention & Cleanup ====================

  async purgeExpiredWebhookLogs(olderThan: Date): Promise<number> {
    await this.simulateLatency();

    let count = 0;
    for (const [id, log] of this.webhookLogs.entries()) {
      if (log.receivedAt < olderThan) {
        this.webhookLogs.delete(id);
        count++;
      }
    }

    return count;
  }

  async purgeExpiredDispatchLogs(olderThan: Date): Promise<number> {
    await this.simulateLatency();

    let count = 0;
    for (const [id, log] of this.dispatchLogs.entries()) {
      if (log.dispatchedAt < olderThan) {
        this.dispatchLogs.delete(id);
        count++;
      }
    }

    return count;
  }

  async purgeProcessedOutboxEvents(olderThan: Date): Promise<number> {
    await this.simulateLatency();

    let count = 0;
    for (const [id, event] of this.outboxEvents.entries()) {
      if (
        event.status === OutboxStatus.PROCESSED &&
        event.processedAt &&
        event.processedAt < olderThan
      ) {
        this.outboxEvents.delete(id);
        count++;
      }
    }

    return count;
  }

  // ==================== Transaction Support ====================

  async beginTransaction(): Promise<any> {
    await this.simulateLatency();

    if (this.currentTransaction) {
      throw new Error('Transaction already in progress');
    }

    // Save current state for rollback
    this.transactionRollbackData = {
      transactions: new Map(this.transactions),
      webhookLogs: new Map(this.webhookLogs),
      auditLogs: new Map(this.auditLogs),
      dispatchLogs: new Map(this.dispatchLogs),
      outboxEvents: new Map(this.outboxEvents),
      transactionsByAppRef: new Map(this.transactionsByAppRef),
      transactionsByProviderRef: new Map(this.transactionsByProviderRef),
      webhooksByProviderEventId: new Map(this.webhooksByProviderEventId),
    };

    this.currentTransaction = { id: this.generateId() };
    return this.currentTransaction;
  }

  async commitTransaction(txn: any): Promise<void> {
    await this.simulateLatency();

    if (!this.currentTransaction || this.currentTransaction.id !== txn.id) {
      throw new Error('Invalid transaction');
    }

    // Clear rollback data
    this.transactionRollbackData = null;
    this.currentTransaction = null;
  }

  async rollbackTransaction(txn: any): Promise<void> {
    await this.simulateLatency();

    if (!this.currentTransaction || this.currentTransaction.id !== txn.id) {
      throw new Error('Invalid transaction');
    }

    // Restore previous state
    if (this.transactionRollbackData) {
      this.transactions = this.transactionRollbackData.transactions;
      this.webhookLogs = this.transactionRollbackData.webhookLogs;
      this.auditLogs = this.transactionRollbackData.auditLogs;
      this.dispatchLogs = this.transactionRollbackData.dispatchLogs;
      this.outboxEvents = this.transactionRollbackData.outboxEvents;
      this.transactionsByAppRef =
        this.transactionRollbackData.transactionsByAppRef;
      this.transactionsByProviderRef =
        this.transactionRollbackData.transactionsByProviderRef;
      this.webhooksByProviderEventId =
        this.transactionRollbackData.webhooksByProviderEventId;
    }

    this.transactionRollbackData = null;
    this.currentTransaction = null;
  }

  async withTransaction<T>(callback: (txn: any) => Promise<T>): Promise<T> {
    const txn = await this.beginTransaction();

    try {
      const result = await callback(txn);
      await this.commitTransaction(txn);
      return result;
    } catch (error) {
      await this.rollbackTransaction(txn);
      throw error;
    }
  }

  // ==================== Health & Monitoring ====================

  async isHealthy(): Promise<boolean> {
    await this.simulateLatency();
    return !this.options.throwOnError;
  }

  async getStatistics(): Promise<{
    transactionCount: number;
    webhookLogCount: number;
    auditLogCount: number;
    dispatchLogCount: number;
    outboxEventCount: number;
  }> {
    await this.simulateLatency();

    return {
      transactionCount: this.transactions.size,
      webhookLogCount: this.webhookLogs.size,
      auditLogCount: this.auditLogs.size,
      dispatchLogCount: this.dispatchLogs.size,
      outboxEventCount: this.outboxEvents.size,
    };
  }

  // ==================== Testing Utilities ====================

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.transactions.clear();
    this.webhookLogs.clear();
    this.auditLogs.clear();
    this.dispatchLogs.clear();
    this.outboxEvents.clear();
    this.transactionsByAppRef.clear();
    this.transactionsByProviderRef.clear();
    this.webhooksByProviderEventId.clear();
    this.idCounter = 0;
  }

  /**
   * Get all data (for testing)
   */
  getAllData(): {
    transactions: Transaction[];
    webhookLogs: WebhookLog[];
    auditLogs: AuditLog[];
    dispatchLogs: DispatchLog[];
    outboxEvents: OutboxEvent[];
  } {
    return {
      transactions: Array.from(this.transactions.values()),
      webhookLogs: Array.from(this.webhookLogs.values()),
      auditLogs: Array.from(this.auditLogs.values()),
      dispatchLogs: Array.from(this.dispatchLogs.values()),
      outboxEvents: Array.from(this.outboxEvents.values()),
    };
  }

  /**
   * Inject test data
   */
  injectTestData(data: {
    transactions?: Transaction[];
    webhookLogs?: WebhookLog[];
    auditLogs?: AuditLog[];
    dispatchLogs?: DispatchLog[];
    outboxEvents?: OutboxEvent[];
  }): void {
    if (data.transactions) {
      for (const txn of data.transactions) {
        this.transactions.set(txn.id, txn);
        this.transactionsByAppRef.set(txn.applicationRef, txn.id);
        if (txn.providerRef) {
          this.transactionsByProviderRef.set(txn.providerRef, txn.id);
        }
      }
    }

    if (data.webhookLogs) {
      for (const log of data.webhookLogs) {
        this.webhookLogs.set(log.id, log);
        const key = `${log.provider}:${log.providerEventId}`;
        this.webhooksByProviderEventId.set(key, log.id);
      }
    }

    if (data.auditLogs) {
      for (const log of data.auditLogs) {
        this.auditLogs.set(log.id, log);
      }
    }

    if (data.dispatchLogs) {
      for (const log of data.dispatchLogs) {
        this.dispatchLogs.set(log.id, log);
      }
    }

    if (data.outboxEvents) {
      for (const event of data.outboxEvents) {
        this.outboxEvents.set(event.id, event);
      }
    }
  }
}

/**
 * Mock storage configuration options
 */
export interface MockStorageOptions {
  simulateLatency?: boolean;
  latencyMs?: number;
  throwOnError?: boolean;
}
