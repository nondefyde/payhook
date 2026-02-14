import {
  Transaction,
  WebhookLog,
  AuditLog,
  DispatchLog,
  OutboxEvent,
} from '../domain/models';
import {
  TransactionStatus,
  ProcessingStatus,
  NormalizedEventType,
  TriggerType,
  ReconciliationResult,
  VerificationMethod,
  AuditAction,
} from '../domain/enums';

/**
 * Common types used across adapters
 */

/**
 * Pagination parameters
 */
export interface Pagination {
  page: number;
  limit: number;
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Transaction query options
 */
export interface TransactionQuery {
  id?: string;
  applicationRef?: string;
  providerRef?: string;
  provider?: string;
  status?: TransactionStatus;
  createdAfter?: Date;
  createdBefore?: Date;
}

/**
 * Transaction filter options
 */
export interface TransactionFilter {
  status?: TransactionStatus;
  provider?: string;
  fromDate?: Date;
  toDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
}

/**
 * Webhook filter options
 */
export interface WebhookFilter {
  provider?: string;
  processingStatus?: ProcessingStatus;
  fromDate?: Date;
  toDate?: Date;
  transactionId?: string;
}

/**
 * Unmatched webhook filter
 */
export interface UnmatchedFilter {
  provider?: string;
  eventType?: string;
  fromDate?: Date;
  toDate?: Date;
}

/**
 * Outbox filter options
 */
export interface OutboxFilter {
  status?: string;
  eventType?: NormalizedEventType;
  fromDate?: Date;
  toDate?: Date;
  transactionId?: string;
}

/**
 * Create transaction DTO
 */
export interface CreateTransactionDto {
  applicationRef: string;
  provider: string;
  amount: number;
  currency: string;
  metadata?: Record<string, any>;
  createdBy?: string;
}

/**
 * Update transaction DTO
 */
export interface UpdateTransactionDto {
  status?: TransactionStatus;
  providerRef?: string;
  providerCreatedAt?: Date;
  settledAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Mark as processing DTO
 */
export interface MarkAsProcessingDto {
  providerRef: string;
  providerCreatedAt?: Date;
  verificationMethod?: VerificationMethod;
  performedBy?: string;
}

/**
 * Create webhook log DTO
 */
export interface CreateWebhookLogDto {
  provider: string;
  providerEventId: string;
  eventType: string;
  rawPayload: Record<string, any>;
  signatureValid: boolean;
  processingStatus: ProcessingStatus;
  headers: Record<string, string>;
  transactionId?: string;
  normalizedEvent?: string;
  errorMessage?: string;
  processingDurationMs?: number;
  receivedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Create audit log DTO
 */
export interface CreateAuditLogDto {
  transactionId: string;
  fromStatus?: TransactionStatus | null;
  toStatus?: TransactionStatus;
  triggerType?: TriggerType;
  webhookLogId?: string;
  reconciliationResult?: ReconciliationResult | null;
  verificationMethod?: VerificationMethod;
  metadata?: Record<string, any>;
  actor?: string;
  reason?: string;
  action?: AuditAction;
  performedBy?: string;
  performedAt?: Date;
  stateBefore?: TransactionStatus | null;
  stateAfter?: TransactionStatus;
}

/**
 * Create dispatch log DTO
 */
export interface CreateDispatchLogDto {
  transactionId: string;
  webhookLogId?: string;
  eventType: NormalizedEventType;
  handlerName: string;
  status: string;
  isReplay?: boolean;
  errorMessage?: string;
  error?: string;
  executionDurationMs?: number;
  durationMs?: number;
  attemptedAt?: Date;
  completedAt?: Date;
  retryCount?: number;
  nextRetryAt?: Date;
  payload?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * Create outbox event DTO
 */
export interface CreateOutboxEventDto {
  transactionId?: string;
  aggregateId?: string;
  aggregateType?: string;
  eventType: NormalizedEventType;
  payload: Record<string, any>;
  scheduledFor?: Date;
  metadata?: Record<string, any>;
}

/**
 * Normalized webhook event (provider agnostic)
 */
export interface NormalizedWebhookEvent {
  // Required fields (guaranteed present)
  eventType: NormalizedEventType;
  providerRef: string;
  amount: number;
  currency: string;
  providerEventId: string;

  // Optional fields (present when provider supplies them)
  applicationRef?: string;
  providerTimestamp?: string;
  customerEmail?: string;
  providerMetadata?: Record<string, any>;
}

/**
 * Provider verification result
 */
export interface ProviderVerificationResult {
  status: 'success' | 'failed' | 'pending' | 'abandoned';
  providerRef: string;
  amount: number;
  currency: string;
  providerTimestamp?: string;
  metadata?: Record<string, any>;
}

/**
 * Webhook query options
 */
export interface WebhookQuery {
  id?: string;
  provider?: string;
  providerEventId?: string;
  transactionId?: string;
  processingStatus?: ProcessingStatus;
  receivedAfter?: Date;
  receivedBefore?: Date;
}

/**
 * Audit log query options
 */
export interface AuditLogQuery {
  id?: string;
  transactionId?: string;
  webhookLogId?: string;
  fromStatus?: TransactionStatus;
  toStatus?: TransactionStatus;
  action?: AuditAction;
  performedBy?: string;
  performedAfter?: Date;
  performedBefore?: Date;
}

/**
 * Dispatch log query options
 */
export interface DispatchLogQuery {
  id?: string;
  transactionId?: string;
  webhookLogId?: string;
  eventType?: NormalizedEventType;
  handlerName?: string;
  status?: string;
}

/**
 * Outbox query options
 */
export interface OutboxQuery {
  id?: string;
  transactionId?: string;
  aggregateId?: string;
  eventType?: NormalizedEventType;
  status?: string;
  scheduledBefore?: Date;
  limit?: number;
}

/**
 * Reconciliation result data
 */
export interface ReconciliationResultData {
  success: boolean;
  diverged: boolean;
  localStatus?: TransactionStatus;
  providerStatus?: 'success' | 'failed' | 'pending' | 'abandoned';
  corrected?: boolean;
  newStatus?: TransactionStatus;
  reason?: string;
}
