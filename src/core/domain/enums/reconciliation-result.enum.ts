/**
 * Reconciliation outcomes
 * Used in audit logs to track reconciliation results
 */
export enum ReconciliationResult {
  /**
   * PayHook state matches provider state
   */
  CONFIRMED = 'confirmed',

  /**
   * Provider state is ahead - transition applied
   */
  ADVANCED = 'advanced',

  /**
   * Provider state differs but no action taken
   * (PayHook never rolls back)
   */
  DIVERGENCE = 'divergence',

  /**
   * Provider was unreachable or returned error
   */
  ERROR = 'error',
}
