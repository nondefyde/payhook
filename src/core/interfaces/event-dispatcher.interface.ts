import { NormalizedEventType } from '../domain/enums';
import { Transaction, DispatchLog } from '../domain/models';

/**
 * Event payload sent to handlers
 */
export interface PaymentEvent {
  id: string;
  eventType: NormalizedEventType;
  transactionId: string;
  transaction: Transaction;
  providerRef: string;
  applicationRef: string;
  amount: number;
  currency: string;
  timestamp: Date;
  isReplay: boolean;
  metadata: Record<string, any>;
  providerMetadata?: Record<string, any>;
}

/**
 * Event handler function signature
 */
export type EventHandler = (event: PaymentEvent) => Promise<void> | void;

/**
 * Event handler registration
 */
export interface EventHandlerRegistration {
  name: string;
  eventType: NormalizedEventType | NormalizedEventType[];
  handler: EventHandler;
  options?: EventHandlerOptions;
}

/**
 * Event handler options
 */
export interface EventHandlerOptions {
  /**
   * Maximum retries on failure
   */
  maxRetries?: number;

  /**
   * Retry delay in milliseconds
   */
  retryDelay?: number;

  /**
   * Timeout for handler execution in milliseconds
   */
  timeout?: number;

  /**
   * Whether to run this handler asynchronously (non-blocking)
   */
  async?: boolean;

  /**
   * Priority for handler execution (higher runs first)
   */
  priority?: number;

  /**
   * Filter function to conditionally execute handler
   */
  filter?: (event: PaymentEvent) => boolean;
}

/**
 * Dispatch result for a single handler
 */
export interface DispatchResult {
  handlerName: string;
  success: boolean;
  duration: number;
  error?: Error;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Overall dispatch summary
 */
export interface DispatchSummary {
  event: PaymentEvent;
  results: DispatchResult[];
  totalHandlers: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  totalDuration: number;
}

/**
 * Event dispatcher interface - handles event emission to registered handlers
 */
export interface EventDispatcher {
  /**
   * Register an event handler
   */
  registerHandler(registration: EventHandlerRegistration): void;

  /**
   * Unregister an event handler by name
   */
  unregisterHandler(name: string): void;

  /**
   * Get all registered handlers
   */
  getHandlers(): EventHandlerRegistration[];

  /**
   * Get handlers for a specific event type
   */
  getHandlersForEvent(eventType: NormalizedEventType): EventHandlerRegistration[];

  /**
   * Dispatch an event to all registered handlers
   * @param event - The event to dispatch
   * @param options - Dispatch options
   * @returns Summary of dispatch results
   */
  dispatch(
    event: PaymentEvent,
    options?: DispatchOptions,
  ): Promise<DispatchSummary>;

  /**
   * Dispatch multiple events in batch
   */
  dispatchBatch(
    events: PaymentEvent[],
    options?: BatchDispatchOptions,
  ): Promise<DispatchSummary[]>;

  /**
   * Replay events from dispatch logs
   */
  replayFromLogs(
    dispatchLogs: DispatchLog[],
    options?: ReplayOptions,
  ): Promise<DispatchSummary[]>;

  /**
   * Clear all registered handlers
   */
  clearHandlers(): void;

  /**
   * Check if a handler is registered
   */
  hasHandler(name: string): boolean;

  /**
   * Get statistics about dispatched events
   */
  getStatistics(): DispatchStatistics;
}

/**
 * Options for event dispatch
 */
export interface DispatchOptions {
  /**
   * Whether to wait for all handlers to complete
   */
  waitForCompletion?: boolean;

  /**
   * Whether to stop on first handler failure
   */
  stopOnError?: boolean;

  /**
   * Whether to record dispatch in logs
   */
  recordDispatch?: boolean;

  /**
   * Custom timeout for all handlers
   */
  timeout?: number;

  /**
   * Whether this is a replay dispatch
   */
  isReplay?: boolean;
}

/**
 * Options for batch dispatch
 */
export interface BatchDispatchOptions extends DispatchOptions {
  /**
   * Number of events to process in parallel
   */
  concurrency?: number;

  /**
   * Whether to stop batch on first error
   */
  stopBatchOnError?: boolean;
}

/**
 * Options for replay
 */
export interface ReplayOptions extends DispatchOptions {
  /**
   * Filter to only replay certain handlers
   */
  handlerFilter?: (handlerName: string) => boolean;

  /**
   * Whether to only replay failed dispatches
   */
  onlyFailed?: boolean;

  /**
   * Delay between replay dispatches (ms)
   */
  replayDelay?: number;
}

/**
 * Dispatch statistics
 */
export interface DispatchStatistics {
  totalDispatched: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped: number;
  averageDuration: number;
  handlerStatistics: Map<string, HandlerStatistics>;
}

/**
 * Per-handler statistics
 */
export interface HandlerStatistics {
  name: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  averageDuration: number;
  lastError?: Error;
  lastErrorAt?: Date;
}

/**
 * Lifecycle hooks for monitoring
 */
export interface DispatchLifecycleHooks {
  /**
   * Called before dispatching to any handler
   */
  beforeDispatch?: (event: PaymentEvent) => void | Promise<void>;

  /**
   * Called after dispatching to all handlers
   */
  afterDispatch?: (summary: DispatchSummary) => void | Promise<void>;

  /**
   * Called before each handler execution
   */
  beforeHandler?: (event: PaymentEvent, handlerName: string) => void | Promise<void>;

  /**
   * Called after each handler execution
   */
  afterHandler?: (result: DispatchResult) => void | Promise<void>;

  /**
   * Called when a handler fails
   */
  onHandlerError?: (error: Error, handlerName: string, event: PaymentEvent) => void | Promise<void>;

  /**
   * Called when a handler is skipped
   */
  onHandlerSkipped?: (handlerName: string, reason: string, event: PaymentEvent) => void | Promise<void>;
}