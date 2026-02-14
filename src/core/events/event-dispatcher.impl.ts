import {
  EventDispatcher,
  EventHandler,
  SimpleEventHandler,
  EventSubscription,
  EventHandlerRegistration,
  NormalizedEventType,
} from '../interfaces';

/**
 * Default implementation of the EventDispatcher
 *
 * Handles registration and dispatch of normalized payment events.
 * Supports multiple handlers per event type with error isolation.
 */
export class EventDispatcherImpl implements EventDispatcher {
  private handlers: Map<string, Set<SimpleEventHandler>> = new Map();
  private globalHandlers: Set<SimpleEventHandler> = new Set();
  private subscriptionIdCounter = 0;
  private subscriptions: Map<
    string,
    {
      eventType: string | '*';
      handler: SimpleEventHandler;
    }
  > = new Map();

  /**
   * Register an event handler for a specific event type
   */
  on(
    eventType: NormalizedEventType | string,
    handler: SimpleEventHandler,
  ): EventSubscription {
    const subscriptionId = `sub_${++this.subscriptionIdCounter}`;

    // Initialize handler set if needed
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    // Add handler
    this.handlers.get(eventType)!.add(handler);

    // Track subscription
    this.subscriptions.set(subscriptionId, {
      eventType,
      handler,
    });

    // Return subscription object
    return {
      id: subscriptionId,
      unsubscribe: () => this.off(eventType, handler),
    };
  }

  /**
   * Register a handler for all event types
   */
  onAll(handler: SimpleEventHandler): EventSubscription {
    const subscriptionId = `sub_${++this.subscriptionIdCounter}`;

    // Add to global handlers
    this.globalHandlers.add(handler);

    // Track subscription
    this.subscriptions.set(subscriptionId, {
      eventType: '*',
      handler,
    });

    // Return subscription object
    return {
      id: subscriptionId,
      unsubscribe: () => {
        this.globalHandlers.delete(handler);
        this.subscriptions.delete(subscriptionId);
      },
    };
  }

  /**
   * Remove an event handler
   */
  off(
    eventType: NormalizedEventType | string,
    handler: SimpleEventHandler,
  ): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(eventType);
      }
    }

    // Remove from subscriptions
    for (const [id, sub] of this.subscriptions.entries()) {
      if (sub.eventType === eventType && sub.handler === handler) {
        this.subscriptions.delete(id);
        break;
      }
    }
  }

  /**
   * Remove all handlers for an event type
   */
  removeAllHandlers(eventType?: NormalizedEventType | string): void {
    if (eventType) {
      // Remove specific event type handlers
      this.handlers.delete(eventType);

      // Remove from subscriptions
      for (const [id, sub] of this.subscriptions.entries()) {
        if (sub.eventType === eventType) {
          this.subscriptions.delete(id);
        }
      }
    } else {
      // Clear all handlers
      this.handlers.clear();
      this.globalHandlers.clear();
      this.subscriptions.clear();
    }
  }

  /**
   * Dispatch an event to all registered handlers
   */
  async dispatch(
    eventType: NormalizedEventType | string,
    payload: any,
  ): Promise<void> {
    const errors: Array<{ handler: string; error: Error }> = [];

    // Get specific handlers for this event type
    const specificHandlers = this.handlers.get(eventType) || new Set();

    // Combine with global handlers
    const allHandlers = [...specificHandlers, ...this.globalHandlers];

    // Execute all handlers
    const promises = allHandlers.map(async (handler) => {
      try {
        await handler(eventType, payload);
      } catch (error) {
        // Capture error but don't fail the dispatch
        errors.push({
          handler: handler.name || 'anonymous',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });

    // Wait for all handlers to complete
    await Promise.allSettled(promises);

    // Log errors if any (but don't throw)
    if (errors.length > 0) {
      console.error(`Event dispatch errors for ${eventType}:`, errors);
    }
  }

  /**
   * Dispatch an event and wait for all handlers to complete
   */
  async dispatchAndWait(
    eventType: NormalizedEventType | string,
    payload: any,
  ): Promise<{ success: boolean; errors: Error[] }> {
    const errors: Error[] = [];

    // Get specific handlers for this event type
    const specificHandlers = this.handlers.get(eventType) || new Set();

    // Combine with global handlers
    const allHandlers = [...specificHandlers, ...this.globalHandlers];

    // Execute all handlers and collect results
    const results = await Promise.allSettled(
      allHandlers.map((handler) => handler(eventType, payload)),
    );

    // Collect errors
    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason)),
        );
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Get all registered handlers
   */
  getHandlers(): EventHandlerRegistration[] {
    // Return empty array as we don't track registrations in this implementation
    return [];
  }

  /**
   * Get handlers for a specific event type
   */
  getHandlersForEvent(
    eventType: NormalizedEventType,
  ): EventHandlerRegistration[] {
    // Return empty array as we don't track registrations in this implementation
    return [];
  }

  /**
   * Check if there are any handlers for an event type
   */
  hasHandlers(eventType: NormalizedEventType | string): boolean {
    return (
      (this.handlers.get(eventType)?.size || 0) > 0 ||
      this.globalHandlers.size > 0
    );
  }

  /**
   * Get handler count for an event type
   */
  getHandlerCount(eventType?: NormalizedEventType | string): number {
    if (eventType) {
      return (
        (this.handlers.get(eventType)?.size || 0) + this.globalHandlers.size
      );
    } else {
      let total = this.globalHandlers.size;
      for (const handlers of this.handlers.values()) {
        total += handlers.size;
      }
      return total;
    }
  }

  /**
   * Get all registered event types
   */
  getEventTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Dispatch multiple events in batch
   */
  async dispatchBatch(events: any[], options?: any): Promise<any[]> {
    const results: any[] = [];
    for (const event of events) {
      await this.dispatch(event.eventType, event);
      results.push({
        event,
        results: [],
        totalHandlers: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        totalDuration: 0,
      });
    }
    return results;
  }

  /**
   * Replay events from logs
   */
  async replayFromLogs(logs: any[], options?: any): Promise<any[]> {
    return this.dispatchBatch(logs, options);
  }

  /**
   * Clear all handlers
   */
  clearHandlers(): void {
    this.removeAllHandlers();
  }

  /**
   * Check if handler exists
   */
  hasHandler(name: string): boolean {
    // Simple check - could be enhanced
    return this.getHandlerCount() > 0;
  }

  /**
   * Get statistics
   */
  getStatistics(): any {
    return {
      totalDispatched: 0,
      totalSuccess: 0,
      totalFailed: 0,
      totalSkipped: 0,
      averageDuration: 0,
      handlerStatistics: new Map(),
    };
  }

  /**
   * Create a scoped event dispatcher that prefixes all events
   */
  createScoped(prefix: string): EventDispatcher {
    const parent = this;

    return {
      on(
        eventType: NormalizedEventType | string,
        handler: SimpleEventHandler,
      ): EventSubscription {
        return parent.on(`${prefix}.${eventType}`, handler);
      },

      off(
        eventType: NormalizedEventType | string,
        handler: SimpleEventHandler,
      ): void {
        parent.off(`${prefix}.${eventType}`, handler);
      },

      onAll(handler: SimpleEventHandler): EventSubscription {
        return parent.onAll(handler);
      },

      async dispatch(
        eventType: NormalizedEventType | string,
        payload: any,
      ): Promise<void> {
        await parent.dispatch(`${prefix}.${eventType}`, payload);
      },

      dispatchEvent: undefined,
      dispatchBatch: async () => [],
      replayFromLogs: async () => [],
      clearHandlers: () => {},
      hasHandler: () => false,
      getStatistics: () => ({
        totalDispatched: 0,
        totalSuccess: 0,
        totalFailed: 0,
        totalSkipped: 0,
        averageDuration: 0,
        handlerStatistics: new Map(),
      }),
    };
  }
}
