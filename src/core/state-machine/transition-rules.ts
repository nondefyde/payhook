import { TransactionStatus, TriggerType } from '../domain/enums';
import { StateTransition } from './types';

/**
 * PayHook transaction state machine transition rules
 * Based on PRD Section 5.2 - Transaction State Machine
 *
 * Key principles:
 * - Failed is terminal (no retry path)
 * - Pending → Processing is atomic
 * - Abandoned is host-triggered
 * - States only move forward (no rollback)
 */
export const TRANSITION_RULES: StateTransition[] = [
  // ============ Initial Transitions ============

  /**
   * Pending → Processing
   * Triggered by markAsProcessing() when provider reference is linked
   */
  {
    from: TransactionStatus.PENDING,
    to: TransactionStatus.PROCESSING,
    triggers: [TriggerType.MANUAL, TriggerType.API_VERIFICATION],
    metadata: {
      description: 'Transaction sent to provider',
      requiresProviderRef: true,
    },
  },

  // ============ Processing Outcomes ============

  /**
   * Processing → Successful
   * Payment completed successfully
   */
  {
    from: TransactionStatus.PROCESSING,
    to: TransactionStatus.SUCCESSFUL,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
      TriggerType.LATE_MATCH,
    ],
    metadata: {
      description: 'Payment completed successfully',
      terminal: false,
    },
  },

  /**
   * Processing → Failed
   * Payment attempt failed (terminal state)
   */
  {
    from: TransactionStatus.PROCESSING,
    to: TransactionStatus.FAILED,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
      TriggerType.LATE_MATCH,
    ],
    metadata: {
      description: 'Payment attempt failed',
      terminal: true,
      note: 'No retry path - new transaction must be created for retry',
    },
  },

  /**
   * Processing → Abandoned
   * Transaction timed out (host-triggered after verification)
   */
  {
    from: TransactionStatus.PROCESSING,
    to: TransactionStatus.ABANDONED,
    triggers: [TriggerType.MANUAL, TriggerType.RECONCILIATION],
    metadata: {
      description: 'Transaction abandoned due to timeout',
      terminal: true,
      hostTriggered: true,
    },
  },

  // ============ Refund Transitions ============

  /**
   * Successful → Refunded
   * Full refund processed
   */
  {
    from: TransactionStatus.SUCCESSFUL,
    to: TransactionStatus.REFUNDED,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
    ],
    metadata: {
      description: 'Full refund processed',
      terminal: true,
      refundType: 'full',
    },
  },

  /**
   * Successful → Partially Refunded
   * Partial refund processed
   */
  {
    from: TransactionStatus.SUCCESSFUL,
    to: TransactionStatus.PARTIALLY_REFUNDED,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
    ],
    metadata: {
      description: 'Partial refund processed',
      terminal: false,
      refundType: 'partial',
    },
  },

  /**
   * Partially Refunded → Refunded
   * Remaining amount refunded
   */
  {
    from: TransactionStatus.PARTIALLY_REFUNDED,
    to: TransactionStatus.REFUNDED,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
    ],
    metadata: {
      description: 'Remaining amount refunded',
      terminal: true,
      refundType: 'full',
    },
  },

  // ============ Dispute Transitions ============

  /**
   * Successful → Disputed
   * Payment disputed by customer
   */
  {
    from: TransactionStatus.SUCCESSFUL,
    to: TransactionStatus.DISPUTED,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
    ],
    metadata: {
      description: 'Payment disputed by customer',
      terminal: false,
      requiresResolution: true,
    },
  },

  /**
   * Partially Refunded → Disputed
   * Partially refunded payment disputed
   */
  {
    from: TransactionStatus.PARTIALLY_REFUNDED,
    to: TransactionStatus.DISPUTED,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
    ],
    metadata: {
      description: 'Partially refunded payment disputed',
      terminal: false,
      requiresResolution: true,
    },
  },

  /**
   * Disputed → Resolved Won
   * Dispute resolved in merchant's favor
   */
  {
    from: TransactionStatus.DISPUTED,
    to: TransactionStatus.RESOLVED_WON,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
    ],
    metadata: {
      description: 'Dispute resolved in merchant favor',
      terminal: true,
      disputeOutcome: 'won',
    },
  },

  /**
   * Disputed → Resolved Lost
   * Dispute resolved in customer's favor
   */
  {
    from: TransactionStatus.DISPUTED,
    to: TransactionStatus.RESOLVED_LOST,
    triggers: [
      TriggerType.WEBHOOK,
      TriggerType.API_VERIFICATION,
      TriggerType.RECONCILIATION,
    ],
    metadata: {
      description: 'Dispute resolved in customer favor',
      terminal: true,
      disputeOutcome: 'lost',
    },
  },
];

/**
 * Get all valid transitions from a given status
 */
export function getValidTransitionsFrom(
  status: TransactionStatus,
): StateTransition[] {
  return TRANSITION_RULES.filter((rule) => rule.from === status);
}

/**
 * Get all valid target states from a given status
 */
export function getValidTargetStates(
  status: TransactionStatus,
): TransactionStatus[] {
  return getValidTransitionsFrom(status).map((rule) => rule.to);
}

/**
 * Find a specific transition rule
 */
export function findTransitionRule(
  from: TransactionStatus,
  to: TransactionStatus,
): StateTransition | undefined {
  return TRANSITION_RULES.find((rule) => rule.from === from && rule.to === to);
}

/**
 * Check if a transition is defined
 */
export function isTransitionDefined(
  from: TransactionStatus,
  to: TransactionStatus,
): boolean {
  return findTransitionRule(from, to) !== undefined;
}

/**
 * Check if a trigger type is valid for a transition
 */
export function isTriggerValidForTransition(
  from: TransactionStatus,
  to: TransactionStatus,
  trigger: TriggerType,
): boolean {
  const rule = findTransitionRule(from, to);
  return rule ? rule.triggers.includes(trigger) : false;
}

/**
 * Get terminal states (no further transitions possible)
 */
export function getTerminalStates(): TransactionStatus[] {
  return [
    TransactionStatus.FAILED,
    TransactionStatus.ABANDONED,
    TransactionStatus.REFUNDED,
    TransactionStatus.RESOLVED_WON,
    TransactionStatus.RESOLVED_LOST,
  ];
}

/**
 * Check if a status is terminal
 */
export function isTerminalState(status: TransactionStatus): boolean {
  return getTerminalStates().includes(status);
}

/**
 * Get the initial state
 */
export function getInitialState(): TransactionStatus {
  return TransactionStatus.PENDING;
}
