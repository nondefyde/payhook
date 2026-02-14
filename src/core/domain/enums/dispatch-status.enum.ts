/**
 * Event dispatch outcomes
 * Tracks handler execution results
 */
export enum DispatchStatus {
  /**
   * Handler executed successfully
   */
  SUCCESS = 'success',

  /**
   * Handler execution failed
   */
  FAILED = 'failed',

  /**
   * Handler execution was skipped (e.g., conditional logic)
   */
  SKIPPED = 'skipped',
}

/**
 * Outbox event status
 * For optional guaranteed delivery pattern
 */
export enum OutboxStatus {
  /**
   * Event awaiting processing
   */
  PENDING = 'pending',

  /**
   * Event successfully processed
   */
  PROCESSED = 'processed',

  /**
   * Event processing failed
   */
  FAILED = 'failed',
}