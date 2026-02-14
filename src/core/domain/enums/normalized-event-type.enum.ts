/**
 * Normalized event types - provider agnostic
 * All provider-specific events map to these standard types
 */
export enum NormalizedEventType {
  /**
   * Payment completed and funds captured
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
   * Refund completed (full or partial)
   */
  REFUND_SUCCESSFUL = 'refund.successful',

  /**
   * Refund attempt failed
   */
  REFUND_FAILED = 'refund.failed',

  /**
   * Refund initiated but not yet completed
   */
  REFUND_PENDING = 'refund.pending',

  /**
   * Chargeback or dispute opened
   */
  CHARGE_DISPUTED = 'charge.disputed',

  /**
   * Dispute resolved (won or lost)
   */
  DISPUTE_RESOLVED = 'dispute.resolved',
}