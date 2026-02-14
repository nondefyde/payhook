import { Transaction, WebhookLog, AuditLog, DispatchLog, OutboxEvent } from '../domain/models';
import { TransactionStatus, ProcessingStatus, NormalizedEventType } from '../domain/enums';

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
}

/**
 * Mark as processing DTO
 */
export interface MarkAsProcessingDto {
  providerRef: string;
  providerCreatedAt?: Date;
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
}

/**
 * Create audit log DTO
 */
export interface CreateAuditLogDto {
  transactionId: string;
  fromStatus: TransactionStatus | null;
  toStatus: TransactionStatus;
  triggerType: string;
  webhookLogId?: string;
  reconciliationResult?: string;
  verificationMethod?: string;
  metadata?: Record<string, any>;
  actor?: string;
  reason?: string;
}

/**
 * Create dispatch log DTO
 */
export interface CreateDispatchLogDto {
  transactionId: string;
  eventType: NormalizedEventType;
  handlerName: string;
  status: string;
  isReplay: boolean;
  errorMessage?: string;
  executionDurationMs?: number;
  payload?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * Create outbox event DTO
 */
export interface CreateOutboxEventDto {
  transactionId: string;
  eventType: NormalizedEventType;
  payload: Record<string, any>;
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