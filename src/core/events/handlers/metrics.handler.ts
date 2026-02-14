import { EventHandler, NormalizedEventType } from '../../interfaces';

/**
 * Metrics collection event handler
 * Collects metrics about payment events for monitoring
 */
export class MetricsEventHandler {
  private metrics: {
    eventCounts: Map<string, number>;
    lastEventTime: Map<string, Date>;
    processingTimes: number[];
    errors: number;
    successes: number;
    refunds: number;
    disputes: number;
  };

  constructor(
    private readonly metricsCollector?: {
      increment: (metric: string, tags?: Record<string, string>) => void;
      gauge: (metric: string, value: number, tags?: Record<string, string>) => void;
      histogram: (metric: string, value: number, tags?: Record<string, string>) => void;
    },
  ) {
    this.metrics = {
      eventCounts: new Map(),
      lastEventTime: new Map(),
      processingTimes: [],
      errors: 0,
      successes: 0,
      refunds: 0,
      disputes: 0,
    };
  }

  /**
   * Create the event handler function
   */
  getHandler(): EventHandler {
    return async (eventType: string, payload: any) => {
      try {
        // Update event counts
        const currentCount = this.metrics.eventCounts.get(eventType) || 0;
        this.metrics.eventCounts.set(eventType, currentCount + 1);
        this.metrics.lastEventTime.set(eventType, new Date());

        // Track specific event types
        this.trackEventType(payload.normalized?.eventType);

        // Track processing time if available
        if (payload.webhook?.receivedAt) {
          const processingTime = Date.now() - new Date(payload.webhook.receivedAt).getTime();
          this.metrics.processingTimes.push(processingTime);

          // Keep only last 1000 processing times
          if (this.metrics.processingTimes.length > 1000) {
            this.metrics.processingTimes.shift();
          }
        }

        // Send to external metrics collector if configured
        if (this.metricsCollector) {
          const tags = {
            eventType,
            provider: payload.webhook?.provider || 'unknown',
            status: payload.transaction?.status || 'unknown',
          };

          this.metricsCollector.increment('payhook.event', tags);

          if (payload.webhook?.receivedAt) {
            const processingTime = Date.now() - new Date(payload.webhook.receivedAt).getTime();
            this.metricsCollector.histogram('payhook.processing_time', processingTime, tags);
          }
        }
      } catch (error) {
        console.error('[MetricsEventHandler] Failed to collect metrics:', error);
      }
    };
  }

  /**
   * Track specific event types for business metrics
   */
  private trackEventType(eventType?: NormalizedEventType): void {
    if (!eventType) return;

    switch (eventType) {
      case NormalizedEventType.PAYMENT_SUCCEEDED:
        this.metrics.successes++;
        break;
      case NormalizedEventType.PAYMENT_FAILED:
        this.metrics.errors++;
        break;
      case NormalizedEventType.REFUND_COMPLETED:
      case NormalizedEventType.REFUND_PARTIAL:
        this.metrics.refunds++;
        break;
      case NormalizedEventType.DISPUTE_CREATED:
      case NormalizedEventType.DISPUTE_WON:
      case NormalizedEventType.DISPUTE_LOST:
        this.metrics.disputes++;
        break;
    }

    // Send to external metrics if configured
    if (this.metricsCollector) {
      this.metricsCollector.gauge('payhook.successes', this.metrics.successes);
      this.metricsCollector.gauge('payhook.errors', this.metrics.errors);
      this.metricsCollector.gauge('payhook.refunds', this.metrics.refunds);
      this.metricsCollector.gauge('payhook.disputes', this.metrics.disputes);
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): {
    totalEvents: number;
    eventTypes: number;
    averageProcessingTime: number;
    successRate: number;
    eventCounts: Record<string, number>;
    businessMetrics: {
      successes: number;
      errors: number;
      refunds: number;
      disputes: number;
    };
  } {
    const totalEvents = Array.from(this.metrics.eventCounts.values()).reduce((a, b) => a + b, 0);
    const averageProcessingTime = this.metrics.processingTimes.length > 0
      ? this.metrics.processingTimes.reduce((a, b) => a + b, 0) / this.metrics.processingTimes.length
      : 0;

    const total = this.metrics.successes + this.metrics.errors;
    const successRate = total > 0 ? this.metrics.successes / total : 0;

    return {
      totalEvents,
      eventTypes: this.metrics.eventCounts.size,
      averageProcessingTime,
      successRate,
      eventCounts: Object.fromEntries(this.metrics.eventCounts),
      businessMetrics: {
        successes: this.metrics.successes,
        errors: this.metrics.errors,
        refunds: this.metrics.refunds,
        disputes: this.metrics.disputes,
      },
    };
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics.eventCounts.clear();
    this.metrics.lastEventTime.clear();
    this.metrics.processingTimes = [];
    this.metrics.errors = 0;
    this.metrics.successes = 0;
    this.metrics.refunds = 0;
    this.metrics.disputes = 0;
  }
}