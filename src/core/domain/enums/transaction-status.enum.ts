/**
 * Transaction lifecycle states
 * State machine enforced - transitions validated by state engine
 */
export enum TransactionStatus {
  /**
   * Initial state - transaction created but not yet sent to provider
   */
  PENDING = 'pending',

  /**
   * Transaction sent to provider and awaiting result
   */
  PROCESSING = 'processing',

  /**
   * Payment completed successfully
   */
  SUCCESSFUL = 'successful',

  /**
   * Payment failed (terminal state)
   */
  FAILED = 'failed',

  /**
   * Transaction abandoned due to timeout (terminal state)
   */
  ABANDONED = 'abandoned',

  /**
   * Full refund processed
   */
  REFUNDED = 'refunded',

  /**
   * Partial refund processed
   */
  PARTIALLY_REFUNDED = 'partially_refunded',

  /**
   * Payment disputed by customer
   */
  DISPUTED = 'disputed',

  /**
   * Dispute resolved in merchant's favor
   */
  RESOLVED_WON = 'resolved_won',

  /**
   * Dispute resolved in customer's favor
   */
  RESOLVED_LOST = 'resolved_lost',
}

/**
 * Helper to determine if a status is terminal (no further transitions possible)
 */
export function isTerminalStatus(status: TransactionStatus): boolean {
  return [
    TransactionStatus.FAILED,
    TransactionStatus.ABANDONED,
    TransactionStatus.REFUNDED,
    TransactionStatus.RESOLVED_WON,
    TransactionStatus.RESOLVED_LOST,
  ].includes(status);
}

/**
 * Helper to determine if a transaction is settled (successful or terminal)
 */
export function isSettledStatus(status: TransactionStatus): boolean {
  return (
    status === TransactionStatus.SUCCESSFUL ||
    status === TransactionStatus.PARTIALLY_REFUNDED ||
    isTerminalStatus(status)
  );
}