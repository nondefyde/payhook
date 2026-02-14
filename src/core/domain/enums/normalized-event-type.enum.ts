/**
 * Normalized event types - provider agnostic
 * All provider-specific events map to these standard types
 */
export enum NormalizedEventType {
  /**
   * Payment authorized but not yet captured
   */
  PAYMENT_AUTHORIZED = 'payment.authorized',

  /**
   * Payment captured and processing
   */
  PAYMENT_CAPTURED = 'payment.captured',

  /**
   * Payment completed successfully
   */
  PAYMENT_SUCCEEDED = 'payment.succeeded',

  /**
   * Payment completed and funds captured (alias)
   */
  PAYMENT_SUCCESSFUL = 'payment.successful',

  /**
   * Payment attempt failed
   */
  PAYMENT_FAILED = 'payment.failed',

  /**
   * Payment timed out or was abandoned
   */
  PAYMENT_ABANDONED = 'payment.abandoned',

  /**
   * Payment was cancelled
   */
  PAYMENT_CANCELLED = 'payment.cancelled',

  /**
   * Payment expired
   */
  PAYMENT_EXPIRED = 'payment.expired',

  /**
   * Refund completed (full or partial)
   */
  REFUND_SUCCESSFUL = 'refund.successful',

  /**
   * Refund completed (alternative name)
   */
  REFUND_COMPLETED = 'refund.completed',

  /**
   * Refund attempt failed
   */
  REFUND_FAILED = 'refund.failed',

  /**
   * Refund initiated but not yet completed
   */
  REFUND_PENDING = 'refund.pending',

  /**
   * Refund initiated
   */
  REFUND_INITIATED = 'refund.initiated',

  /**
   * Partial refund completed
   */
  REFUND_PARTIAL = 'refund.partial',

  /**
   * Chargeback or dispute opened
   */
  CHARGE_DISPUTED = 'charge.disputed',

  /**
   * Dispute created (alternative name)
   */
  DISPUTE_CREATED = 'dispute.created',

  /**
   * Dispute resolved (won or lost)
   */
  DISPUTE_RESOLVED = 'dispute.resolved',

  /**
   * Dispute won
   */
  DISPUTE_WON = 'dispute.won',

  /**
   * Dispute lost
   */
  DISPUTE_LOST = 'dispute.lost',

  /**
   * Dispute cancelled
   */
  DISPUTE_CANCELLED = 'dispute.cancelled',

  /**
   * Unknown event type
   */
  UNKNOWN = 'unknown',
}
