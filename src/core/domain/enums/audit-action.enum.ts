/**
 * Audit action types
 * Describes what action caused an audit log entry
 */
export enum AuditAction {
  /**
   * Transaction was created
   */
  TRANSACTION_CREATED = 'transaction_created',

  /**
   * Webhook was received
   */
  WEBHOOK_RECEIVED = 'webhook_received',

  /**
   * Webhook caused state transition
   */
  WEBHOOK_STATE_TRANSITION = 'webhook_state_transition',

  /**
   * Manual state transition
   */
  MANUAL_TRANSITION = 'manual_transition',

  /**
   * Reconciliation performed
   */
  RECONCILIATION = 'reconciliation',

  /**
   * Late match applied
   */
  LATE_MATCH = 'late_match',

  /**
   * Metadata updated
   */
  METADATA_UPDATED = 'metadata_updated',

  /**
   * Provider reference linked
   */
  PROVIDER_REF_LINKED = 'provider_ref_linked',
}
