import { OutboxStatus, NormalizedEventType } from '../enums';

/**
 * OutboxEvent domain model - for guaranteed at-least-once delivery pattern
 * Written in same transaction as state change, processed by host infrastructure
 */
export class OutboxEvent {
  constructor(
    public readonly id: string,
    public readonly transactionId: string,
    public readonly eventType: NormalizedEventType,
    public readonly payload: Record<string, any>,
    public status: OutboxStatus = OutboxStatus.PENDING,
    public readonly createdAt: Date = new Date(),
    public processedAt: Date | null = null,
    public attemptCount: number = 0,
    public lastAttemptAt: Date | null = null,
    public errorMessage: string | null = null,
    public metadata: Record<string, any> = {},
  ) {}

  /**
   * Check if event is pending processing
   */
  isPending(): boolean {
    return this.status === OutboxStatus.PENDING;
  }

  /**
   * Check if event was successfully processed
   */
  isProcessed(): boolean {
    return this.status === OutboxStatus.PROCESSED;
  }

  /**
   * Check if event processing failed
   */
  hasFailed(): boolean {
    return this.status === OutboxStatus.FAILED;
  }

  /**
   * Mark as processed
   */
  markAsProcessed(): void {
    this.status = OutboxStatus.PROCESSED;
    this.processedAt = new Date();
    this.errorMessage = null;
  }

  /**
   * Mark as failed with error
   */
  markAsFailed(errorMessage: string): void {
    this.status = OutboxStatus.FAILED;
    this.errorMessage = errorMessage;
    this.attemptCount++;
    this.lastAttemptAt = new Date();
  }

  /**
   * Record processing attempt
   */
  recordAttempt(): void {
    this.attemptCount++;
    this.lastAttemptAt = new Date();
  }

  /**
   * Reset to pending for retry
   */
  resetForRetry(): void {
    this.status = OutboxStatus.PENDING;
    this.errorMessage = null;
  }

  /**
   * Check if should retry based on attempt count and max retries
   */
  shouldRetry(maxRetries: number): boolean {
    return (
      this.status === OutboxStatus.FAILED && this.attemptCount < maxRetries
    );
  }

  /**
   * Get time since creation (for stale detection)
   */
  getAgeInMinutes(): number {
    return Math.floor((Date.now() - this.createdAt.getTime()) / (1000 * 60));
  }

  /**
   * Check if event is stale (unprocessed for too long)
   */
  isStale(thresholdMinutes: number): boolean {
    return this.isPending() && this.getAgeInMinutes() > thresholdMinutes;
  }

  /**
   * Get event for dispatch
   */
  getDispatchableEvent(): Record<string, any> {
    return {
      id: this.id,
      transactionId: this.transactionId,
      eventType: this.eventType,
      payload: this.payload,
      metadata: this.metadata,
      createdAt: this.createdAt,
    };
  }

  /**
   * Create outbox event for a transaction event
   */
  static forTransactionEvent(
    id: string,
    transactionId: string,
    eventType: NormalizedEventType,
    payload: Record<string, any>,
    metadata: Record<string, any> = {},
  ): OutboxEvent {
    return new OutboxEvent(
      id,
      transactionId,
      eventType,
      payload,
      OutboxStatus.PENDING,
      new Date(),
      null,
      0,
      null,
      null,
      metadata,
    );
  }

  /**
   * Convert to plain object for storage/serialization
   */
  toPlainObject(): Record<string, any> {
    return {
      id: this.id,
      transactionId: this.transactionId,
      eventType: this.eventType,
      payload: this.payload,
      status: this.status,
      createdAt: this.createdAt,
      processedAt: this.processedAt,
      attemptCount: this.attemptCount,
      lastAttemptAt: this.lastAttemptAt,
      errorMessage: this.errorMessage,
      metadata: this.metadata,
    };
  }

  /**
   * Create from plain object (for hydration from storage)
   */
  static fromPlainObject(data: Record<string, any>): OutboxEvent {
    return new OutboxEvent(
      data.id,
      data.transactionId,
      data.eventType,
      data.payload,
      data.status,
      new Date(data.createdAt),
      data.processedAt ? new Date(data.processedAt) : null,
      data.attemptCount,
      data.lastAttemptAt ? new Date(data.lastAttemptAt) : null,
      data.errorMessage,
      data.metadata,
    );
  }
}
