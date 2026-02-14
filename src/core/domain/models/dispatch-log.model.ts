import { DispatchStatus, NormalizedEventType } from '../enums';

/**
 * DispatchLog domain model - records event handler execution results
 * Enables replay and debugging of handler failures
 */
export class DispatchLog {
  constructor(
    public readonly id: string,
    public readonly transactionId: string,
    public readonly eventType: NormalizedEventType,
    public readonly handlerName: string,
    public status: DispatchStatus,
    public readonly isReplay: boolean = false,
    public readonly dispatchedAt: Date = new Date(),
    public errorMessage: string | null = null,
    public executionDurationMs: number | null = null,
    public payload: Record<string, any> = {},
    public retryCount: number = 0,
    public metadata: Record<string, any> = {},
  ) {}

  /**
   * Check if dispatch was successful
   */
  wasSuccessful(): boolean {
    return this.status === DispatchStatus.SUCCESS;
  }

  /**
   * Check if dispatch failed
   */
  failed(): boolean {
    return this.status === DispatchStatus.FAILED;
  }

  /**
   * Check if dispatch was skipped
   */
  wasSkipped(): boolean {
    return this.status === DispatchStatus.SKIPPED;
  }

  /**
   * Mark as successful
   */
  markAsSuccess(executionDurationMs: number): void {
    this.status = DispatchStatus.SUCCESS;
    this.executionDurationMs = executionDurationMs;
    this.errorMessage = null;
  }

  /**
   * Mark as failed with error
   */
  markAsFailed(errorMessage: string, executionDurationMs: number): void {
    this.status = DispatchStatus.FAILED;
    this.errorMessage = errorMessage;
    this.executionDurationMs = executionDurationMs;
  }

  /**
   * Mark as skipped with reason
   */
  markAsSkipped(reason: string): void {
    this.status = DispatchStatus.SKIPPED;
    this.errorMessage = reason;
  }

  /**
   * Increment retry count
   */
  incrementRetryCount(): void {
    this.retryCount++;
  }

  /**
   * Check if should retry based on count and status
   */
  shouldRetry(maxRetries: number): boolean {
    return (
      this.status === DispatchStatus.FAILED && this.retryCount < maxRetries
    );
  }

  /**
   * Create a replay entry from this dispatch
   */
  createReplayEntry(id: string): DispatchLog {
    return new DispatchLog(
      id,
      this.transactionId,
      this.eventType,
      this.handlerName,
      DispatchStatus.SUCCESS, // Will be updated based on execution
      true, // isReplay
      new Date(),
      null,
      null,
      this.payload,
      0,
      { originalDispatchId: this.id, ...this.metadata },
    );
  }

  /**
   * Get handler execution context
   */
  getExecutionContext(): Record<string, any> {
    return {
      transactionId: this.transactionId,
      eventType: this.eventType,
      handlerName: this.handlerName,
      isReplay: this.isReplay,
      retryCount: this.retryCount,
      payload: this.payload,
    };
  }

  /**
   * Convert to plain object for storage/serialization
   */
  toPlainObject(): Record<string, any> {
    return {
      id: this.id,
      transactionId: this.transactionId,
      eventType: this.eventType,
      handlerName: this.handlerName,
      status: this.status,
      isReplay: this.isReplay,
      errorMessage: this.errorMessage,
      executionDurationMs: this.executionDurationMs,
      payload: this.payload,
      retryCount: this.retryCount,
      metadata: this.metadata,
      dispatchedAt: this.dispatchedAt,
    };
  }

  /**
   * Create from plain object (for hydration from storage)
   */
  static fromPlainObject(data: Record<string, any>): DispatchLog {
    return new DispatchLog(
      data.id,
      data.transactionId,
      data.eventType,
      data.handlerName,
      data.status,
      data.isReplay,
      new Date(data.dispatchedAt),
      data.errorMessage,
      data.executionDurationMs,
      data.payload,
      data.retryCount,
      data.metadata,
    );
  }
}
