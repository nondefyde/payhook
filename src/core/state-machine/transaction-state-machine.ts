import { Transaction } from '../domain/models';
import { TransactionStatus, TriggerType, NormalizedEventType } from '../domain/enums';
import {
  StateTransition,
  TransitionContext,
  TransitionResult,
  TransitionGuard,
  TransitionCondition,
  StateMachineConfig,
  TransitionValidationError,
  InvalidStateError,
} from './types';
import {
  TRANSITION_RULES,
  findTransitionRule,
  isTerminalState,
  isTriggerValidForTransition,
  getInitialState,
} from './transition-rules';

/**
 * Transaction state machine - enforces valid state transitions
 * Pure TypeScript implementation with no external dependencies
 */
export class TransactionStateMachine {
  private readonly config: StateMachineConfig;
  private readonly transitions: Map<string, StateTransition>;
  private readonly guards: Map<string, TransitionGuard[]>;
  private readonly conditions: Map<string, TransitionCondition[]>;

  constructor(config?: Partial<StateMachineConfig>) {
    this.config = {
      initialState: getInitialState(),
      transitions: TRANSITION_RULES,
      strictMode: true,
      enableLogging: false,
      ...config,
    };

    this.transitions = new Map();
    this.guards = new Map();
    this.conditions = new Map();

    this.initializeTransitions();
  }

  /**
   * Initialize transition mappings for efficient lookup
   */
  private initializeTransitions(): void {
    for (const transition of this.config.transitions) {
      const key = this.getTransitionKey(transition.from, transition.to);
      this.transitions.set(key, transition);

      if (transition.guards) {
        this.guards.set(key, transition.guards);
      }

      if (transition.conditions) {
        this.conditions.set(key, transition.conditions);
      }
    }
  }

  /**
   * Validate a state transition
   */
  async validateTransition(
    from: TransactionStatus,
    to: TransactionStatus,
    context: Partial<TransitionContext>,
  ): Promise<TransitionResult> {
    const fullContext: TransitionContext = {
      currentStatus: from,
      targetStatus: to,
      triggerType: context.triggerType || TriggerType.MANUAL,
      ...context,
    };

    // Check if we're trying to transition from a terminal state
    if (isTerminalState(from)) {
      return {
        success: false,
        fromStatus: from,
        toStatus: to,
        reason: `Cannot transition from terminal state: ${from}`,
      };
    }

    // Check if the transition is defined
    const transition = this.findTransition(from, to);
    if (!transition) {
      if (this.config.strictMode) {
        return {
          success: false,
          fromStatus: from,
          toStatus: to,
          reason: `Transition from ${from} to ${to} is not defined`,
        };
      }
    }

    // Check if the trigger type is valid
    if (transition && !transition.triggers.includes(fullContext.triggerType)) {
      return {
        success: false,
        fromStatus: from,
        toStatus: to,
        reason: `Trigger type ${fullContext.triggerType} is not valid for transition from ${from} to ${to}`,
      };
    }

    // Evaluate conditions
    const conditionResults = await this.evaluateConditions(from, to, fullContext);
    if (!conditionResults.success) {
      return conditionResults;
    }

    // Check guards
    const guardResults = await this.checkGuards(from, to, fullContext);
    if (!guardResults.success) {
      return guardResults;
    }

    // Transition is valid
    return {
      success: true,
      fromStatus: from,
      toStatus: to,
      metadata: transition?.metadata,
    };
  }

  /**
   * Apply a state transition to a transaction
   */
  async applyTransition(
    transaction: Transaction,
    targetStatus: TransactionStatus,
    context: Partial<TransitionContext>,
  ): Promise<TransitionResult> {
    const result = await this.validateTransition(
      transaction.status,
      targetStatus,
      context,
    );

    if (!result.success) {
      if (this.config.enableLogging) {
        console.warn(
          `Transition failed for transaction ${transaction.id}: ${result.reason}`,
        );
      }
      return result;
    }

    // Apply the transition (actual persistence is handled by storage adapter)
    transaction.updateStatus(targetStatus);

    if (this.config.enableLogging) {
      console.log(
        `Transaction ${transaction.id} transitioned from ${result.fromStatus} to ${result.toStatus}`,
      );
    }

    return result;
  }

  /**
   * Check if a transition is possible
   */
  canTransition(
    from: TransactionStatus,
    to: TransactionStatus,
    triggerType?: TriggerType,
  ): boolean {
    // Terminal states cannot transition
    if (isTerminalState(from)) {
      return false;
    }

    // Check if transition exists
    const transition = this.findTransition(from, to);
    if (!transition) {
      return false;
    }

    // Check trigger type if provided
    if (triggerType && !transition.triggers.includes(triggerType)) {
      return false;
    }

    return true;
  }

  /**
   * Get all possible next states from current state
   */
  getNextStates(currentStatus: TransactionStatus): TransactionStatus[] {
    if (isTerminalState(currentStatus)) {
      return [];
    }

    const nextStates: TransactionStatus[] = [];
    for (const [key, transition] of this.transitions) {
      if (transition.from === currentStatus) {
        nextStates.push(transition.to);
      }
    }

    return nextStates;
  }

  /**
   * Get valid triggers for a specific transition
   */
  getValidTriggers(
    from: TransactionStatus,
    to: TransactionStatus,
  ): TriggerType[] {
    const transition = this.findTransition(from, to);
    return transition ? transition.triggers : [];
  }

  /**
   * Evaluate conditions for a transition
   */
  private async evaluateConditions(
    from: TransactionStatus,
    to: TransactionStatus,
    context: TransitionContext,
  ): Promise<TransitionResult> {
    const key = this.getTransitionKey(from, to);
    const conditions = this.conditions.get(key);

    if (!conditions || conditions.length === 0) {
      return {
        success: true,
        fromStatus: from,
        toStatus: to,
      };
    }

    const failures: string[] = [];

    for (const condition of conditions) {
      try {
        const result = await condition.evaluate(context);
        if (!result) {
          failures.push(
            condition.errorMessage || `Condition ${condition.name} failed`,
          );
        }
      } catch (error) {
        failures.push(
          `Condition ${condition.name} threw error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (failures.length > 0) {
      return {
        success: false,
        fromStatus: from,
        toStatus: to,
        reason: 'Transition conditions not met',
        conditionFailures: failures,
      };
    }

    return {
      success: true,
      fromStatus: from,
      toStatus: to,
    };
  }

  /**
   * Check guards for a transition
   */
  private async checkGuards(
    from: TransactionStatus,
    to: TransactionStatus,
    context: TransitionContext,
  ): Promise<TransitionResult> {
    const key = this.getTransitionKey(from, to);
    const guards = this.guards.get(key);

    if (!guards || guards.length === 0) {
      return {
        success: true,
        fromStatus: from,
        toStatus: to,
      };
    }

    const failures: string[] = [];

    for (const guard of guards) {
      try {
        const result = await guard.check(context);
        if (!result.allowed) {
          failures.push(result.reason || `Guard ${guard.name} blocked transition`);
        }
      } catch (error) {
        failures.push(
          `Guard ${guard.name} threw error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (failures.length > 0) {
      return {
        success: false,
        fromStatus: from,
        toStatus: to,
        reason: 'Transition blocked by guards',
        guardFailures: failures,
      };
    }

    return {
      success: true,
      fromStatus: from,
      toStatus: to,
    };
  }

  /**
   * Find a transition by from and to states
   */
  private findTransition(
    from: TransactionStatus,
    to: TransactionStatus,
  ): StateTransition | undefined {
    const key = this.getTransitionKey(from, to);
    return this.transitions.get(key);
  }

  /**
   * Generate a unique key for a transition
   */
  private getTransitionKey(
    from: TransactionStatus,
    to: TransactionStatus,
  ): string {
    return `${from}->${to}`;
  }

  /**
   * Add a custom guard to a transition
   */
  addGuard(
    from: TransactionStatus,
    to: TransactionStatus,
    guard: TransitionGuard,
  ): void {
    const key = this.getTransitionKey(from, to);
    const existingGuards = this.guards.get(key) || [];
    existingGuards.push(guard);
    this.guards.set(key, existingGuards);
  }

  /**
   * Add a custom condition to a transition
   */
  addCondition(
    from: TransactionStatus,
    to: TransactionStatus,
    condition: TransitionCondition,
  ): void {
    const key = this.getTransitionKey(from, to);
    const existingConditions = this.conditions.get(key) || [];
    existingConditions.push(condition);
    this.conditions.set(key, existingConditions);
  }

  /**
   * Validate that a status is valid
   */
  validateStatus(status: string): TransactionStatus {
    const validStatuses = Object.values(TransactionStatus);
    if (!validStatuses.includes(status as TransactionStatus)) {
      throw new InvalidStateError(
        `Invalid status: ${status}`,
        status,
        validStatuses,
      );
    }
    return status as TransactionStatus;
  }

  /**
   * Get the state machine configuration
   */
  getConfig(): StateMachineConfig {
    return { ...this.config };
  }

  /**
   * Get all defined transitions
   */
  getAllTransitions(): StateTransition[] {
    return Array.from(this.transitions.values());
  }

  /**
   * Create a visualization-friendly representation of the state machine
   */
  toMermaidDiagram(): string {
    const lines = ['stateDiagram-v2'];

    // Add states
    for (const status of Object.values(TransactionStatus)) {
      if (isTerminalState(status)) {
        lines.push(`    ${status} : ${status} [Terminal]`);
      } else {
        lines.push(`    ${status} : ${status}`);
      }
    }

    // Add transitions
    for (const transition of this.transitions.values()) {
      const triggers = transition.triggers.join(', ');
      lines.push(`    ${transition.from} --> ${transition.to} : ${triggers}`);
    }

    return lines.join('\n');
  }
}

/**
 * Default singleton instance
 */
export const defaultStateMachine = new TransactionStateMachine();