import { TransactionStatus, TriggerType } from '../domain/enums';
import { StateTransition } from './types';
import { TRANSITION_RULES, getTerminalStates } from './transition-rules';

/**
 * State machine validator - ensures transition rules are consistent and valid
 */
export class StateMachineValidator {
  private readonly transitions: StateTransition[];
  private readonly errors: string[] = [];
  private readonly warnings: string[] = [];

  constructor(transitions: StateTransition[] = TRANSITION_RULES) {
    this.transitions = transitions;
  }

  /**
   * Validate the entire state machine configuration
   */
  validate(): ValidationResult {
    this.errors.length = 0;
    this.warnings.length = 0;

    this.validateStatesExist();
    this.validateTriggersExist();
    this.validateNoOrphanedStates();
    this.validateTerminalStates();
    this.validateNoDuplicateTransitions();
    this.validateTransitionConsistency();
    this.validateTriggerConsistency();

    return {
      valid: this.errors.length === 0,
      errors: [...this.errors],
      warnings: [...this.warnings],
    };
  }

  /**
   * Ensure all states in transitions are valid TransactionStatus values
   */
  private validateStatesExist(): void {
    const validStates = Object.values(TransactionStatus);

    for (const transition of this.transitions) {
      if (!validStates.includes(transition.from)) {
        this.errors.push(`Invalid 'from' state: ${transition.from}`);
      }
      if (!validStates.includes(transition.to)) {
        this.errors.push(`Invalid 'to' state: ${transition.to}`);
      }
    }
  }

  /**
   * Ensure all triggers are valid TriggerType values
   */
  private validateTriggersExist(): void {
    const validTriggers = Object.values(TriggerType);

    for (const transition of this.transitions) {
      for (const trigger of transition.triggers) {
        if (!validTriggers.includes(trigger)) {
          this.errors.push(
            `Invalid trigger '${trigger}' in transition ${transition.from} -> ${transition.to}`,
          );
        }
      }
    }
  }

  /**
   * Check for orphaned states (states with no way in or out)
   */
  private validateNoOrphanedStates(): void {
    const allStates = Object.values(TransactionStatus);
    const statesWithIncoming = new Set<TransactionStatus>();
    const statesWithOutgoing = new Set<TransactionStatus>();

    for (const transition of this.transitions) {
      statesWithOutgoing.add(transition.from);
      statesWithIncoming.add(transition.to);
    }

    // Pending should not have incoming (it's the initial state)
    if (statesWithIncoming.has(TransactionStatus.PENDING)) {
      this.warnings.push('Initial state (PENDING) has incoming transitions');
    }

    // Check for states with no outgoing (should be terminal)
    const terminalStates = getTerminalStates();
    for (const state of allStates) {
      if (!statesWithOutgoing.has(state) && !terminalStates.includes(state)) {
        this.warnings.push(
          `State '${state}' has no outgoing transitions but is not marked as terminal`,
        );
      }
    }

    // Check for states with no incoming (except initial)
    for (const state of allStates) {
      if (
        !statesWithIncoming.has(state) &&
        state !== TransactionStatus.PENDING
      ) {
        this.errors.push(
          `State '${state}' has no incoming transitions and is not the initial state`,
        );
      }
    }
  }

  /**
   * Validate terminal states have no outgoing transitions
   */
  private validateTerminalStates(): void {
    const terminalStates = getTerminalStates();

    for (const transition of this.transitions) {
      if (terminalStates.includes(transition.from)) {
        this.errors.push(
          `Terminal state '${transition.from}' has outgoing transition to '${transition.to}'`,
        );
      }
    }
  }

  /**
   * Check for duplicate transition definitions
   */
  private validateNoDuplicateTransitions(): void {
    const seen = new Set<string>();

    for (const transition of this.transitions) {
      const key = `${transition.from}->${transition.to}`;
      if (seen.has(key)) {
        this.errors.push(`Duplicate transition defined: ${key}`);
      }
      seen.add(key);
    }
  }

  /**
   * Validate transition consistency (business logic rules)
   */
  private validateTransitionConsistency(): void {
    // Failed state should be reachable only from Processing
    const toFailed = this.transitions.filter(
      (t) => t.to === TransactionStatus.FAILED,
    );
    for (const transition of toFailed) {
      if (transition.from !== TransactionStatus.PROCESSING) {
        this.warnings.push(
          `FAILED state can be reached from ${transition.from} - should only be from PROCESSING`,
        );
      }
    }

    // Successful should only be reachable from Processing
    const toSuccessful = this.transitions.filter(
      (t) => t.to === TransactionStatus.SUCCESSFUL,
    );
    for (const transition of toSuccessful) {
      if (transition.from !== TransactionStatus.PROCESSING) {
        this.warnings.push(
          `SUCCESSFUL state can be reached from ${transition.from} - should only be from PROCESSING`,
        );
      }
    }

    // Refund states should only be reachable from Successful or PartiallyRefunded
    const toRefunded = this.transitions.filter(
      (t) =>
        t.to === TransactionStatus.REFUNDED ||
        t.to === TransactionStatus.PARTIALLY_REFUNDED,
    );
    for (const transition of toRefunded) {
      const validRefundSources = [
        TransactionStatus.SUCCESSFUL,
        TransactionStatus.PARTIALLY_REFUNDED,
      ];
      if (!validRefundSources.includes(transition.from)) {
        this.errors.push(
          `Refund state ${transition.to} can be reached from ${transition.from} - should only be from SUCCESSFUL or PARTIALLY_REFUNDED`,
        );
      }
    }

    // Dispute resolution should only come from Disputed
    const resolutionStates = [
      TransactionStatus.RESOLVED_WON,
      TransactionStatus.RESOLVED_LOST,
    ];
    const toResolution = this.transitions.filter((t) =>
      resolutionStates.includes(t.to),
    );
    for (const transition of toResolution) {
      if (transition.from !== TransactionStatus.DISPUTED) {
        this.errors.push(
          `Resolution state ${transition.to} can be reached from ${transition.from} - should only be from DISPUTED`,
        );
      }
    }
  }

  /**
   * Validate trigger consistency
   */
  private validateTriggerConsistency(): void {
    // Manual trigger should not lead to payment outcomes directly
    const manualForbiddenTargets = [
      TransactionStatus.SUCCESSFUL,
      TransactionStatus.FAILED,
      TransactionStatus.REFUNDED,
      TransactionStatus.DISPUTED,
    ];

    for (const transition of this.transitions) {
      if (
        transition.triggers.includes(TriggerType.MANUAL) &&
        manualForbiddenTargets.includes(transition.to)
      ) {
        this.warnings.push(
          `Transition to ${transition.to} includes MANUAL trigger - consider removing for safety`,
        );
      }
    }

    // Webhook triggers should be present for payment state changes
    const webhookExpectedTargets = [
      TransactionStatus.SUCCESSFUL,
      TransactionStatus.FAILED,
      TransactionStatus.REFUNDED,
      TransactionStatus.PARTIALLY_REFUNDED,
      TransactionStatus.DISPUTED,
    ];

    for (const transition of this.transitions) {
      if (
        webhookExpectedTargets.includes(transition.to) &&
        !transition.triggers.includes(TriggerType.WEBHOOK)
      ) {
        this.warnings.push(
          `Transition to ${transition.to} does not include WEBHOOK trigger - webhooks are typically the primary source`,
        );
      }
    }
  }

  /**
   * Generate a report of the state machine structure
   */
  generateReport(): StateMachineReport {
    const states = Object.values(TransactionStatus);
    const stateInfo: Map<TransactionStatus, StateInfo> = new Map();

    // Initialize state info
    for (const state of states) {
      stateInfo.set(state, {
        state,
        incomingCount: 0,
        outgoingCount: 0,
        incomingTransitions: [],
        outgoingTransitions: [],
        isTerminal: getTerminalStates().includes(state),
        isInitial: state === TransactionStatus.PENDING,
      });
    }

    // Populate transition information
    for (const transition of this.transitions) {
      const fromInfo = stateInfo.get(transition.from)!;
      const toInfo = stateInfo.get(transition.to)!;

      fromInfo.outgoingCount++;
      fromInfo.outgoingTransitions.push(transition);

      toInfo.incomingCount++;
      toInfo.incomingTransitions.push(transition);
    }

    return {
      totalStates: states.length,
      totalTransitions: this.transitions.length,
      terminalStates: getTerminalStates(),
      stateInfo: Array.from(stateInfo.values()),
      validation: this.validate(),
    };
  }
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * State information for reporting
 */
export interface StateInfo {
  state: TransactionStatus;
  incomingCount: number;
  outgoingCount: number;
  incomingTransitions: StateTransition[];
  outgoingTransitions: StateTransition[];
  isTerminal: boolean;
  isInitial: boolean;
}

/**
 * State machine report
 */
export interface StateMachineReport {
  totalStates: number;
  totalTransitions: number;
  terminalStates: TransactionStatus[];
  stateInfo: StateInfo[];
  validation: ValidationResult;
}

/**
 * Default validator instance
 */
export const defaultValidator = new StateMachineValidator();
