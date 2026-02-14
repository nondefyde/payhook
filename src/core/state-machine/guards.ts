import {
  TransitionGuard,
  TransitionCondition,
  GuardResult,
  TransitionContext,
} from './types';
import { TransactionStatus, TriggerType } from '../domain/enums';

/**
 * Predefined guards for common transition validation scenarios
 */

/**
 * Guard: Ensure provider reference is set when moving to processing
 */
export const RequireProviderRefGuard: TransitionGuard = {
  name: 'RequireProviderRef',
  check: async (context: TransitionContext): Promise<GuardResult> => {
    if (
      context.targetStatus === TransactionStatus.PROCESSING &&
      !context.metadata?.providerRef
    ) {
      return {
        allowed: false,
        reason:
          'Provider reference is required when transitioning to processing',
      };
    }
    return { allowed: true };
  },
};

/**
 * Guard: Prevent manual transitions to certain states
 */
export const PreventManualTransitionGuard: TransitionGuard = {
  name: 'PreventManualTransition',
  check: async (context: TransitionContext): Promise<GuardResult> => {
    const manuallyForbiddenStates = [
      TransactionStatus.SUCCESSFUL,
      TransactionStatus.FAILED,
      TransactionStatus.REFUNDED,
      TransactionStatus.DISPUTED,
    ];

    if (
      context.triggerType === TriggerType.MANUAL &&
      manuallyForbiddenStates.includes(context.targetStatus)
    ) {
      return {
        allowed: false,
        reason: `Manual transition to ${context.targetStatus} is not allowed`,
        metadata: {
          allowedTriggers: [
            TriggerType.WEBHOOK,
            TriggerType.API_VERIFICATION,
            TriggerType.RECONCILIATION,
          ],
        },
      };
    }
    return { allowed: true };
  },
};

/**
 * Guard: Ensure refund amount is valid
 */
export const ValidateRefundAmountGuard: TransitionGuard = {
  name: 'ValidateRefundAmount',
  check: async (context: TransitionContext): Promise<GuardResult> => {
    const refundStates = [
      TransactionStatus.REFUNDED,
      TransactionStatus.PARTIALLY_REFUNDED,
    ];

    if (!refundStates.includes(context.targetStatus)) {
      return { allowed: true };
    }

    const refundAmount = context.metadata?.refundAmount;
    const originalAmount = context.metadata?.originalAmount;

    if (!refundAmount || !originalAmount) {
      return {
        allowed: false,
        reason: 'Refund amount and original amount are required',
      };
    }

    if (refundAmount <= 0) {
      return {
        allowed: false,
        reason: 'Refund amount must be positive',
      };
    }

    if (refundAmount > originalAmount) {
      return {
        allowed: false,
        reason: 'Refund amount cannot exceed original amount',
      };
    }

    // Determine if it should be partial or full refund
    const expectedStatus =
      refundAmount === originalAmount
        ? TransactionStatus.REFUNDED
        : TransactionStatus.PARTIALLY_REFUNDED;

    if (expectedStatus !== context.targetStatus) {
      return {
        allowed: false,
        reason: `Amount indicates ${expectedStatus} but transitioning to ${context.targetStatus}`,
        metadata: {
          expectedStatus,
          refundAmount,
          originalAmount,
        },
      };
    }

    return { allowed: true };
  },
};

/**
 * Guard: Prevent transitions from terminal states
 */
export const PreventTerminalTransitionGuard: TransitionGuard = {
  name: 'PreventTerminalTransition',
  check: async (context: TransitionContext): Promise<GuardResult> => {
    const terminalStates = [
      TransactionStatus.FAILED,
      TransactionStatus.ABANDONED,
      TransactionStatus.REFUNDED,
      TransactionStatus.RESOLVED_WON,
      TransactionStatus.RESOLVED_LOST,
    ];

    if (terminalStates.includes(context.currentStatus)) {
      return {
        allowed: false,
        reason: `Cannot transition from terminal state ${context.currentStatus}`,
        metadata: {
          isTerminal: true,
          currentStatus: context.currentStatus,
        },
      };
    }
    return { allowed: true };
  },
};

/**
 * Guard: Ensure webhook signature was verified for webhook-triggered transitions
 */
export const RequireVerifiedWebhookGuard: TransitionGuard = {
  name: 'RequireVerifiedWebhook',
  check: async (context: TransitionContext): Promise<GuardResult> => {
    if (context.triggerType === TriggerType.WEBHOOK) {
      const signatureVerified = context.metadata?.signatureVerified;
      if (!signatureVerified) {
        return {
          allowed: false,
          reason:
            'Webhook signature must be verified for webhook-triggered transitions',
        };
      }
    }
    return { allowed: true };
  },
};

/**
 * Condition: Check if transition is happening within a time window
 */
export const TimeWindowCondition: TransitionCondition = {
  name: 'TimeWindow',
  evaluate: async (context: TransitionContext): Promise<boolean> => {
    const maxAgeMinutes = context.metadata?.maxTransitionAgeMinutes;
    if (!maxAgeMinutes) {
      return true; // No time restriction
    }

    const createdAt = context.metadata?.transactionCreatedAt;
    if (!createdAt) {
      return false; // Cannot verify without creation time
    }

    const ageMinutes =
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60);
    return ageMinutes <= maxAgeMinutes;
  },
  errorMessage: 'Transition is outside the allowed time window',
};

/**
 * Condition: Ensure minimum time has passed before abandonment
 */
export const MinimumAbandonmentTimeCondition: TransitionCondition = {
  name: 'MinimumAbandonmentTime',
  evaluate: async (context: TransitionContext): Promise<boolean> => {
    if (context.targetStatus !== TransactionStatus.ABANDONED) {
      return true;
    }

    const minMinutes = context.metadata?.minimumAbandonmentMinutes || 30;
    const lastUpdatedAt = context.metadata?.lastUpdatedAt;

    if (!lastUpdatedAt) {
      return false;
    }

    const minutesSinceUpdate =
      (Date.now() - new Date(lastUpdatedAt).getTime()) / (1000 * 60);
    return minutesSinceUpdate >= minMinutes;
  },
  errorMessage: 'Minimum time has not elapsed for abandonment',
};

/**
 * Condition: Validate dispute resolution outcome
 */
export const ValidateDisputeResolutionCondition: TransitionCondition = {
  name: 'ValidateDisputeResolution',
  evaluate: async (context: TransitionContext): Promise<boolean> => {
    const resolutionStates = [
      TransactionStatus.RESOLVED_WON,
      TransactionStatus.RESOLVED_LOST,
    ];

    if (!resolutionStates.includes(context.targetStatus)) {
      return true;
    }

    // Must be coming from disputed state
    if (context.currentStatus !== TransactionStatus.DISPUTED) {
      return false;
    }

    // Must have resolution details
    const resolutionReason = context.metadata?.resolutionReason;
    const resolutionDate = context.metadata?.resolutionDate;

    return Boolean(resolutionReason && resolutionDate);
  },
  errorMessage: 'Invalid dispute resolution - missing required details',
};

/**
 * Collection of default guards to apply to the state machine
 */
export const DEFAULT_GUARDS: TransitionGuard[] = [
  RequireProviderRefGuard,
  PreventManualTransitionGuard,
  ValidateRefundAmountGuard,
  PreventTerminalTransitionGuard,
  RequireVerifiedWebhookGuard,
];

/**
 * Collection of default conditions to apply to the state machine
 */
export const DEFAULT_CONDITIONS: TransitionCondition[] = [
  TimeWindowCondition,
  MinimumAbandonmentTimeCondition,
  ValidateDisputeResolutionCondition,
];

/**
 * Apply guards to specific transitions
 */
export interface TransitionGuardMapping {
  from: TransactionStatus;
  to: TransactionStatus;
  guards: TransitionGuard[];
}

/**
 * Default guard mappings for transitions
 */
export const DEFAULT_GUARD_MAPPINGS: TransitionGuardMapping[] = [
  {
    from: TransactionStatus.PENDING,
    to: TransactionStatus.PROCESSING,
    guards: [RequireProviderRefGuard],
  },
  {
    from: TransactionStatus.PROCESSING,
    to: TransactionStatus.SUCCESSFUL,
    guards: [RequireVerifiedWebhookGuard],
  },
  {
    from: TransactionStatus.PROCESSING,
    to: TransactionStatus.FAILED,
    guards: [RequireVerifiedWebhookGuard],
  },
  {
    from: TransactionStatus.SUCCESSFUL,
    to: TransactionStatus.REFUNDED,
    guards: [ValidateRefundAmountGuard, RequireVerifiedWebhookGuard],
  },
  {
    from: TransactionStatus.SUCCESSFUL,
    to: TransactionStatus.PARTIALLY_REFUNDED,
    guards: [ValidateRefundAmountGuard, RequireVerifiedWebhookGuard],
  },
  {
    from: TransactionStatus.PROCESSING,
    to: TransactionStatus.ABANDONED,
    guards: [MinimumAbandonmentTimeCondition as unknown as TransitionGuard],
  },
];

/**
 * Factory function to create a custom guard
 */
export function createGuard(
  name: string,
  checkFn: (context: TransitionContext) => Promise<GuardResult> | GuardResult,
): TransitionGuard {
  return {
    name,
    check: checkFn,
  };
}

/**
 * Factory function to create a custom condition
 */
export function createCondition(
  name: string,
  evaluateFn: (context: TransitionContext) => Promise<boolean> | boolean,
  errorMessage?: string,
): TransitionCondition {
  return {
    name,
    evaluate: evaluateFn,
    errorMessage,
  };
}
