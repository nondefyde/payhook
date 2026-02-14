/**
 * Verification confidence levels for transaction state
 * Enables AI agents to make risk-weighted decisions
 */
export enum VerificationMethod {
  /**
   * State derived from verified webhook alone
   * Standard confidence
   */
  WEBHOOK_ONLY = 'webhook_only',

  /**
   * State confirmed by calling provider's verification API
   * High confidence
   */
  API_VERIFIED = 'api_verified',

  /**
   * State verified by both webhook and API
   * Highest confidence
   */
  WEBHOOK_AND_API = 'webhook_and_api',

  /**
   * State confirmed or advanced via reconciliation flow
   * High confidence
   */
  RECONCILED = 'reconciled',
}
