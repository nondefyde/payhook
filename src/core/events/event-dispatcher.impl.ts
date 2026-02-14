import {
  EventDispatcher,
  EventHandler,
  EventSubscription,
  NormalizedEventType,
} from '../interfaces';

/**
 * Default implementation of the EventDispatcher
 *
 * Handles registration and dispatch of normalized payment events.
 * Supports multiple handlers per event type with error isolation.
 */
export class EventDispatcherImpl implements EventDispatcher {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();
  private subscriptionIdCounter = 0;
  private subscriptions: Map<string, {
    eventType: string | '*';
    handler: EventHandler;
  }> = new Map();

  /**
   * Register an event handler for a specific event type
   */
  on(eventType: NormalizedEventType | string, handler: EventHandler): EventSubscription {
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
  onAll(handler: EventHandler): EventSubscription {
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
  off(eventType: NormalizedEventType | string, handler: EventHandler): void {
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
  async dispatch(eventType: NormalizedEventType | string, payload: any): Promise<void> {
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
      allHandlers.map(handler => handler(eventType, payload))
    );

    // Collect errors
    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Get all handlers for an event type
   */
  getHandlers(eventType: NormalizedEventType | string): EventHandler[] {
    const specificHandlers = Array.from(this.handlers.get(eventType) || []);
    const globalHandlers = Array.from(this.globalHandlers);
    return [...specificHandlers, ...globalHandlers];
  }

  /**
   * Check if there are any handlers for an event type
   */
  hasHandlers(eventType: NormalizedEventType | string): boolean {
    return (this.handlers.get(eventType)?.size || 0) > 0 || this.globalHandlers.size > 0;
  }

  /**
   * Get handler count for an event type
   */
  getHandlerCount(eventType?: NormalizedEventType | string): number {
    if (eventType) {
      return (this.handlers.get(eventType)?.size || 0) + this.globalHandlers.size;
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
   * Create a scoped event dispatcher that prefixes all events
   */
  createScoped(prefix: string): EventDispatcher {
    const parent = this;

    return {
      on(eventType: NormalizedEventType | string, handler: EventHandler): EventSubscription {
        return parent.on(`${prefix}.${eventType}`, handler);
      },

      off(eventType: NormalizedEventType | string, handler: EventHandler): void {
        parent.off(`${prefix}.${eventType}`, handler);
      },

      async dispatch(eventType: NormalizedEventType | string, payload: any): Promise<void> {
        await parent.dispatch(`${prefix}.${eventType}`, payload);
      },

      getHandlers(eventType: NormalizedEventType | string): EventHandler[] {
        return parent.getHandlers(`${prefix}.${eventType}`);
      },
    };
  }
}