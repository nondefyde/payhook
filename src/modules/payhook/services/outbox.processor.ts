import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { StorageAdapter, EventDispatcher, OutboxEvent } from '../../../core';

/**
 * Outbox Processor
 *
 * Processes outbox events for guaranteed delivery
 */
@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private intervalId?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(
    @Inject(StorageAdapter)
    private readonly storageAdapter: StorageAdapter,
    @Inject(EventDispatcher)
    private readonly eventDispatcher: EventDispatcher,
    @Inject('PAYHOOK_CONFIG')
    private readonly config: any,
  ) {}

  onModuleInit() {
    if (this.config.outbox?.enabled) {
      this.startProcessing();
    }
  }

  onModuleDestroy() {
    this.stopProcessing();
  }

  /**
   * Start processing outbox events
   */
  startProcessing(): void {
    const intervalMs = this.config.outbox?.pollIntervalMs || 5000;

    this.logger.log(`Starting outbox processor (interval: ${intervalMs}ms)`);

    this.intervalId = setInterval(async () => {
      if (!this.isProcessing) {
        await this.processOutboxEvents();
      }
    }, intervalMs);

    // Process immediately on start
    this.processOutboxEvents();
  }

  /**
   * Stop processing outbox events
   */
  stopProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.logger.log('Stopped outbox processor');
    }
  }

  /**
   * Process pending outbox events
   */
  async processOutboxEvents(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Get pending events
      const events = await this.storageAdapter.getOutboxEvents({
        status: 'pending',
        scheduledBefore: new Date(),
        limit: this.config.outbox?.batchSize || 100,
      });

      if (events.length > 0) {
        this.logger.debug(`Processing ${events.length} outbox events`);

        for (const event of events) {
          await this.processOutboxEvent(event);
        }
      }
    } catch (error) {
      this.logger.error('Error processing outbox events:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single outbox event
   */
  private async processOutboxEvent(event: OutboxEvent): Promise<void> {
    try {
      // Dispatch the event
      await this.eventDispatcher.dispatch(event.eventType, event.payload);

      // Mark as processed
      await this.storageAdapter.markOutboxEventProcessed(event.id);

      this.logger.debug(`Processed outbox event ${event.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to process outbox event ${event.id}:`, error);

      // Mark as failed
      await this.storageAdapter.markOutboxEventFailed(event.id, errorMessage);

      // If max retries exceeded, it will be moved to dead letter
      if (event.retryCount >= (event.maxRetries - 1)) {
        this.logger.warn(`Outbox event ${event.id} moved to dead letter queue`);
      }
    }
  }

  /**
   * Get outbox statistics
   */
  async getStatistics(): Promise<{
    pending: number;
    processing: number;
    delivered: number;
    failed: number;
    deadLetter: number;
  }> {
    const [pending, processing, delivered, failed, deadLetter] = await Promise.all([
      this.countByStatus('pending'),
      this.countByStatus('processing'),
      this.countByStatus('delivered'),
      this.countByStatus('failed'),
      this.countByStatus('dead_letter'),
    ]);

    return {
      pending,
      processing,
      delivered,
      failed,
      deadLetter,
    };
  }

  /**
   * Count outbox events by status
   */
  private async countByStatus(status: string): Promise<number> {
    const events = await this.storageAdapter.getOutboxEvents({
      status: status as any,
      limit: 0, // Just counting
    });
    return events.length;
  }

  /**
   * Manually trigger processing
   */
  async triggerProcessing(): Promise<void> {
    this.logger.log('Manually triggering outbox processing');
    await this.processOutboxEvents();
  }

  /**
   * Retry failed events
   */
  async retryFailedEvents(limit: number = 100): Promise<{
    total: number;
    retried: number;
    failed: number;
  }> {
    const failedEvents = await this.storageAdapter.getOutboxEvents({
      status: 'failed',
      limit,
    });

    let retried = 0;
    let failed = 0;

    for (const event of failedEvents) {
      try {
        await this.processOutboxEvent(event);
        retried++;
      } catch (error) {
        failed++;
      }
    }

    return {
      total: failedEvents.length,
      retried,
      failed,
    };
  }
}