import { TransactionStatus, TriggerType, NormalizedEventType } from '../domain/enums';

/**
 * State transition definition
 */
export interface StateTransition {
  from: TransactionStatus;
  to: TransactionStatus;
  triggers: TriggerType[];
  conditions?: TransitionCondition[];
  guards?: TransitionGuard[];
  metadata?: Record<string, any>;
}

/**
 * Transition condition - must be met for transition to be valid
 */
export interface TransitionCondition {
  name: string;
  evaluate: (context: TransitionContext) => boolean | Promise<boolean>;
  errorMessage?: string;
}

/**
 * Transition guard - can block transition with reason
 */
export interface TransitionGuard {
  name: string;
  check: (context: TransitionContext) => GuardResult | Promise<GuardResult>;
}

/**
 * Guard result
 */
export interface GuardResult {
  allowed: boolean;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Context for evaluating transitions
 */
export interface TransitionContext {
  currentStatus: TransactionStatus;
  targetStatus: TransactionStatus;
  triggerType: TriggerType;
  eventType?: NormalizedEventType;
  amount?: number;
  metadata?: Record<string, any>;
}

/**
 * Transition result
 */
export interface TransitionResult {
  success: boolean;
  fromStatus: TransactionStatus;
  toStatus: TransactionStatus;
  reason?: string;
  guardFailures?: string[];
  conditionFailures?: string[];
  metadata?: Record<string, any>;
}

/**
 * State machine configuration
 */
export interface StateMachineConfig {
  initialState: TransactionStatus;
  transitions: StateTransition[];
  strictMode?: boolean; // If true, only explicitly defined transitions are allowed
  enableLogging?: boolean;
}

/**
 * Transition validation error
 */
export class TransitionValidationError extends Error {
  constructor(
    message: string,
    public fromStatus: TransactionStatus,
    public toStatus: TransactionStatus,
    public reason: string,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'TransitionValidationError';
  }
}

/**
 * Invalid state error
 */
export class InvalidStateError extends Error {
  constructor(
    message: string,
    public status: string,
    public validStates: TransactionStatus[],
  ) {
    super(message);
    this.name = 'InvalidStateError';
  }
}