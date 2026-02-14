/**
 * How a state transition was triggered
 * Used in audit logs to track transition source
 */
export enum TriggerType {
  /**
   * Transition triggered by incoming webhook
   */
  WEBHOOK = 'webhook',

  /**
   * Transition triggered by API verification call
   */
  API_VERIFICATION = 'api_verification',

  /**
   * Transition triggered by reconciliation process
   */
  RECONCILIATION = 'reconciliation',

  /**
   * Transition triggered by late-matched webhook
   */
  LATE_MATCH = 'late_match',

  /**
   * Transition triggered manually (e.g., admin action)
   */
  MANUAL = 'manual',
}