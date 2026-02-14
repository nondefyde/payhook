import {
  Transaction,
  WebhookLog,
  ProcessingStatus,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
  StorageAdapter,
  EventDispatcher,
  TransactionStateMachine,
  LifecycleHooks,
} from '../../core';

/**
 * Webhook processing context passed through the pipeline
 */
export interface WebhookContext {
  // Raw input
  provider: string;
  rawBody: Buffer;
  headers: Record<string, string>;
  receivedAt: Date;

  // Processing metadata
  processingId: string;
  startTime: Date;

  // Verification results
  signatureValid?: boolean;
  signatureError?: string;

  // Normalized data
  normalizedEvent?: NormalizedWebhookEvent;
  normalizationError?: string;

  // Persistence
  webhookLog?: WebhookLog;
  transaction?: Transaction;

  // Processing outcome
  processingStatus?: ProcessingStatus;
  error?: Error;

  // Metrics
  processingDurationMs?: number;

  // Additional metadata
  metadata?: Record<string, any>;
}

/**
 * Pipeline stage result
 */
export interface StageResult {
  success: boolean;
  context: WebhookContext;
  error?: Error;
  shouldContinue: boolean;
  metadata?: Record<string, any>;
}

/**
 * Pipeline stage interface
 */
export interface PipelineStage {
  name: string;
  execute(context: WebhookContext): Promise<StageResult>;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  // Adapters
  storageAdapter: StorageAdapter;
  providerAdapters: Map<string, PaymentProviderAdapter>;
  eventDispatcher?: EventDispatcher;
  stateMachine?: TransactionStateMachine;

  // Configuration
  skipSignatureVerification?: boolean; // DANGEROUS: only for testing
  storeRawPayload?: boolean;
  redactKeys?: string[];

  // Lifecycle hooks
  hooks?: LifecycleHooks;

  // Error handling
  throwOnError?: boolean;
  logErrors?: boolean;

  // Performance
  timeoutMs?: number;
}

/**
 * Processing result returned by the pipeline
 */
export interface ProcessingResult {
  success: boolean;
  webhookLogId?: string;
  transactionId?: string;
  processingStatus: ProcessingStatus;
  error?: Error;
  context: WebhookContext;
  metrics: ProcessingMetrics;
}

/**
 * Processing metrics
 */
export interface ProcessingMetrics {
  totalDurationMs: number;
  stageDurations: Map<string, number>;
  signatureVerified: boolean;
  normalized: boolean;
  persisted: boolean;
  dispatched: boolean;
  transitionApplied: boolean;
}

/**
 * Pipeline error with context
 */
export class PipelineError extends Error {
  constructor(
    message: string,
    public stage: string,
    public context: WebhookContext,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

/**
 * Signature verification error
 */
export class SignatureVerificationError extends Error {
  constructor(
    message: string,
    public provider: string,
    public headers: Record<string, string>,
  ) {
    super(message);
    this.name = 'SignatureVerificationError';
  }
}

/**
 * Duplicate webhook error
 */
export class DuplicateWebhookError extends Error {
  constructor(
    message: string,
    public provider: string,
    public providerEventId: string,
    public existingWebhookLogId: string,
  ) {
    super(message);
    this.name = 'DuplicateWebhookError';
  }
}

/**
 * Transaction not found error
 */
export class TransactionNotFoundError extends Error {
  constructor(
    message: string,
    public providerRef?: string,
    public applicationRef?: string,
  ) {
    super(message);
    this.name = 'TransactionNotFoundError';
  }
}