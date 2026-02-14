import {
  Transaction,
  WebhookLog,
  AuditLog,
  DispatchLog,
  OutboxEvent,
} from '../domain/models';
import { TransactionStatus } from '../domain/enums';
import {
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
  WebhookQuery,
  OutboxQuery,
} from './common.types';

/**
 * Storage adapter interface - abstracts all database operations
 * Implementations must ensure ACID properties where specified
 */
export interface StorageAdapter {
  // ==================== Transaction Operations ====================

  /**
   * Create a new transaction in pending state
   */
  createTransaction(dto: CreateTransactionDto): Promise<Transaction>;

  /**
   * Atomically update transaction status and create audit entry
   * MUST be atomic - both succeed or both fail
   */
  updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    auditEntry: CreateAuditLogDto,
  ): Promise<Transaction>;

  /**
   * Atomically mark transaction as processing and link provider reference
   * Sets provider_ref and transitions to processing in one operation
   */
  markAsProcessing(
    id: string,
    dto: MarkAsProcessingDto,
    auditEntry: CreateAuditLogDto,
  ): Promise<Transaction>;

  /**
   * Find a single transaction by various identifiers
   */
  findTransaction(query: TransactionQuery): Promise<Transaction | null>;

  /**
   * Find multiple transactions by query
   */
  findTransactions(
    query: TransactionQuery,
    pagination?: Pagination,
  ): Promise<Transaction[]>;

  /**
   * Count transactions matching query
   */
  countTransactions(query: TransactionQuery): Promise<number>;

  /**
   * Update transaction metadata
   */
  updateTransaction(
    id: string,
    updates: Partial<Transaction>,
  ): Promise<Transaction>;

  /**
   * List transactions with filtering and pagination
   */
  listTransactions(
    filter: TransactionFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<Transaction>>;

  /**
   * Get transactions stuck in processing state
   */
  findStaleTransactions(
    olderThanMinutes: number,
    limit?: number,
  ): Promise<Transaction[]>;

  /**
   * Lock a transaction for update (row-level locking)
   * Used to prevent concurrent modifications
   */
  lockTransactionForUpdate(id: string): Promise<Transaction | null>;

  /**
   * Link provider reference to transaction
   */
  linkProviderRef(transactionId: string, providerRef: string): Promise<void>;

  // ==================== Webhook Log Operations ====================

  /**
   * Create a webhook log entry
   * Should enforce unique constraint on (provider, provider_event_id)
   */
  createWebhookLog(dto: CreateWebhookLogDto): Promise<WebhookLog>;

  /**
   * Find webhook log by ID
   */
  findWebhookLog(id: string): Promise<WebhookLog | null>;

  /**
   * Find webhook log by provider and event ID (for duplicate detection)
   */
  findWebhookLogByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookLog | null>;

  /**
   * Find webhook logs matching criteria
   */
  findWebhookLogs(
    criteria: Partial<WebhookLog>,
    pagination?: Pagination,
  ): Promise<WebhookLog[]>;

  /**
   * Update webhook log (for late matching)
   */
  updateWebhookLog(
    id: string,
    updates: Partial<WebhookLog>,
  ): Promise<WebhookLog>;

  /**
   * Update webhook log status
   */
  updateWebhookLogStatus(
    id: string,
    status: any,
    errorMessage?: string,
  ): Promise<WebhookLog>;

  /**
   * Link webhook to transaction
   */
  linkWebhookToTransaction(
    webhookId: string,
    transactionId: string,
  ): Promise<void>;

  /**
   * List unmatched webhooks for review/matching
   */
  listUnmatchedWebhooks(
    filter: UnmatchedFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<WebhookLog>>;

  /**
   * List webhook logs with filtering
   */
  listWebhookLogs(
    filter: WebhookFilter,
    pagination: Pagination,
  ): Promise<PaginatedResult<WebhookLog>>;

  /**
   * Count webhook logs matching criteria
   */
  countWebhookLogs(query: WebhookQuery): Promise<number>;

  // ==================== Audit Log Operations ====================

  /**
   * Create an audit log entry
   * Usually created atomically with transaction updates
   */
  createAuditLog(dto: CreateAuditLogDto): Promise<AuditLog>;

  /**
   * Get complete audit trail for a transaction
   */
  getAuditTrail(transactionId: string): Promise<AuditLog[]>;

  /**
   * Get audit logs for a transaction (alternative name)
   */
  getAuditLogs(transactionId: string): Promise<AuditLog[]>;

  /**
   * Get audit logs within date range
   */
  listAuditLogs(
    fromDate: Date,
    toDate: Date,
    pagination: Pagination,
  ): Promise<PaginatedResult<AuditLog>>;

  // ==================== Dispatch Log Operations ====================

  /**
   * Create a dispatch log entry
   */
  createDispatchLog(dto: CreateDispatchLogDto): Promise<DispatchLog>;

  /**
   * Get dispatch logs for a transaction
   */
  getDispatchLogs(transactionId: string): Promise<DispatchLog[]>;

  /**
   * Get failed dispatches for retry
   */
  findFailedDispatches(
    limit?: number,
    maxRetries?: number,
  ): Promise<DispatchLog[]>;

  // ==================== Outbox Operations (Optional Feature) ====================

  /**
   * Create an outbox event (atomically with transaction update)
   */
  createOutboxEvent(dto: CreateOutboxEventDto): Promise<OutboxEvent>;

  /**
   * Get pending outbox events for processing
   */
  listPendingOutboxEvents(limit?: number): Promise<OutboxEvent[]>;

  /**
   * Mark outbox event as processed
   */
  markOutboxEventProcessed(id: string): Promise<OutboxEvent>;

  /**
   * Mark outbox event as failed
   */
  markOutboxEventFailed(id: string, errorMessage: string): Promise<OutboxEvent>;

  /**
   * Get stale outbox events (unprocessed for too long)
   */
  findStaleOutboxEvents(
    olderThanMinutes: number,
    limit?: number,
  ): Promise<OutboxEvent[]>;

  /**
   * Get outbox events by query
   */
  getOutboxEvents(query: OutboxQuery): Promise<OutboxEvent[]>;

  // ==================== Retention & Cleanup ====================

  /**
   * Delete webhook logs older than retention period
   */
  purgeExpiredWebhookLogs(olderThan: Date): Promise<number>;

  /**
   * Delete dispatch logs older than retention period
   */
  purgeExpiredDispatchLogs(olderThan: Date): Promise<number>;

  /**
   * Delete processed outbox events older than retention period
   */
  purgeProcessedOutboxEvents(olderThan: Date): Promise<number>;

  // ==================== Transaction Support ====================

  /**
   * Begin a database transaction
   * Returns a transaction context that can be passed to other methods
   */
  beginTransaction(): Promise<any>;

  /**
   * Commit a database transaction
   */
  commitTransaction(txn: any): Promise<void>;

  /**
   * Rollback a database transaction
   */
  rollbackTransaction(txn: any): Promise<void>;

  /**
   * Execute operations within a transaction
   * Automatically handles commit/rollback
   */
  withTransaction<T>(callback: (txn: any) => Promise<T>): Promise<T>;

  // ==================== Health & Monitoring ====================

  /**
   * Check if storage is healthy and accessible
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get storage statistics
   */
  getStatistics(): Promise<{
    transactionCount: number;
    webhookLogCount: number;
    auditLogCount: number;
    dispatchLogCount: number;
    outboxEventCount: number;
  }>;
}
