/**
 * Webhook processing outcomes - every webhook gets classified
 * No webhook is silently dropped
 */
export enum ProcessingStatus {
  /**
   * Full pipeline completed; state transition applied
   */
  PROCESSED = 'processed',

  /**
   * Valid claim but idempotency key already seen
   */
  DUPLICATE = 'duplicate',

  /**
   * Signature verification failed
   */
  SIGNATURE_FAILED = 'signature_failed',

  /**
   * Signature valid but payload could not be mapped to schema
   */
  NORMALIZATION_FAILED = 'normalization_failed',

  /**
   * Valid and normalized but no matching transaction found
   */
  UNMATCHED = 'unmatched',

  /**
   * Valid claim but state machine rejected the transition
   */
  TRANSITION_REJECTED = 'transition_rejected',

  /**
   * Raw body could not be parsed at all
   */
  PARSE_ERROR = 'parse_error',
}
