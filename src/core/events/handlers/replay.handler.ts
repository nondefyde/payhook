import { SimpleEventHandler } from '../../interfaces';
import { StorageAdapter, ProcessingStatus } from '../../../core';

/**
 * Replay event handler
 * Stores events for potential replay/retry scenarios
 */
export class ReplayEventHandler {
  private replayQueue: Map<
    string,
    {
      eventType: string;
      payload: any;
      timestamp: Date;
      attempts: number;
      lastAttempt?: Date;
      error?: string;
    }
  > = new Map();

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly maxRetries: number = 3,
    private readonly retryDelayMs: number = 60000, // 1 minute default
  ) {}

  /**
   * Create the event handler function
   */
  getHandler(): SimpleEventHandler {
    return async (eventType: string, payload: any) => {
      try {
        // Only queue failed or unmatched events for replay
        const shouldQueue = this.shouldQueueForReplay(payload);

        if (shouldQueue) {
          const replayId = this.generateReplayId(payload);

          this.replayQueue.set(replayId, {
            eventType,
            payload,
            timestamp: new Date(),
            attempts: 0,
          });

          // Schedule replay
          this.scheduleReplay(replayId);
        }
      } catch (error) {
        console.error(
          '[ReplayEventHandler] Failed to queue event for replay:',
          error,
        );
      }
    };
  }

  /**
   * Determine if an event should be queued for replay
   */
  private shouldQueueForReplay(payload: any): boolean {
    const processingStatus = payload.webhook?.processingStatus;

    // Queue events that might benefit from replay
    const replayableStatuses = [
      ProcessingStatus.UNMATCHED,
      ProcessingStatus.TRANSITION_REJECTED,
      ProcessingStatus.PARSE_ERROR,
    ];

    return processingStatus && replayableStatuses.includes(processingStatus);
  }

  /**
   * Generate a unique replay ID
   */
  private generateReplayId(payload: any): string {
    const webhookId = payload.webhook?.id || 'unknown';
    const timestamp = Date.now();
    return `replay_${webhookId}_${timestamp}`;
  }

  /**
   * Schedule a replay attempt
   */
  private scheduleReplay(replayId: string): void {
    setTimeout(async () => {
      await this.attemptReplay(replayId);
    }, this.retryDelayMs);
  }

  /**
   * Attempt to replay an event
   */
  private async attemptReplay(replayId: string): Promise<void> {
    const replayItem = this.replayQueue.get(replayId);
    if (!replayItem) {
      return;
    }

    // Check if max retries exceeded
    if (replayItem.attempts >= this.maxRetries) {
      console.warn(`[ReplayEventHandler] Max retries exceeded for ${replayId}`);
      this.moveToDeadLetterQueue(replayId);
      return;
    }

    try {
      // Update attempt count
      replayItem.attempts++;
      replayItem.lastAttempt = new Date();

      // Try to find the transaction again (it might have been created)
      if (replayItem.payload.webhook?.id) {
        const webhookLog = await this.storageAdapter.findWebhookLogs({
          id: replayItem.payload.webhook.id,
        });

        if (webhookLog.length > 0 && webhookLog[0].transactionId) {
          // Transaction found! Remove from replay queue
          console.info(
            `[ReplayEventHandler] Transaction found for ${replayId}, removing from replay queue`,
          );
          this.replayQueue.delete(replayId);
          return;
        }
      }

      // Still no transaction, schedule another retry with exponential backoff
      const nextDelay =
        this.retryDelayMs * Math.pow(2, replayItem.attempts - 1);
      setTimeout(async () => {
        await this.attemptReplay(replayId);
      }, nextDelay);
    } catch (error) {
      replayItem.error = error instanceof Error ? error.message : String(error);
      console.error(
        `[ReplayEventHandler] Replay attempt failed for ${replayId}:`,
        error,
      );

      // Schedule another retry
      if (replayItem.attempts < this.maxRetries) {
        const nextDelay = this.retryDelayMs * Math.pow(2, replayItem.attempts);
        setTimeout(async () => {
          await this.attemptReplay(replayId);
        }, nextDelay);
      } else {
        this.moveToDeadLetterQueue(replayId);
      }
    }
  }

  /**
   * Move failed replay to dead letter queue
   */
  private moveToDeadLetterQueue(replayId: string): void {
    const replayItem = this.replayQueue.get(replayId);
    if (!replayItem) {
      return;
    }

    console.error(
      `[ReplayEventHandler] Moving ${replayId} to dead letter queue after ${replayItem.attempts} attempts`,
    );

    // In a real implementation, this would persist to a dead letter storage
    // For now, we just log and remove from memory
    this.replayQueue.delete(replayId);
  }

  /**
   * Get current replay queue status
   */
  getQueueStatus(): {
    queueSize: number;
    items: Array<{
      id: string;
      eventType: string;
      attempts: number;
      lastAttempt?: Date;
      error?: string;
    }>;
  } {
    const items = Array.from(this.replayQueue.entries()).map(([id, item]) => ({
      id,
      eventType: item.eventType,
      attempts: item.attempts,
      lastAttempt: item.lastAttempt,
      error: item.error,
    }));

    return {
      queueSize: this.replayQueue.size,
      items,
    };
  }

  /**
   * Clear the replay queue
   */
  clearQueue(): void {
    this.replayQueue.clear();
  }

  /**
   * Manually trigger replay for a specific webhook
   */
  async replayWebhook(
    webhookLogId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const webhookLogs = await this.storageAdapter.findWebhookLogs({
        id: webhookLogId,
      });
      if (webhookLogs.length === 0) {
        return { success: false, error: 'Webhook log not found' };
      }

      const webhookLog = webhookLogs[0];

      // Create a replay event
      const replayId = `manual_${webhookLogId}_${Date.now()}`;
      this.replayQueue.set(replayId, {
        eventType: 'manual_replay',
        payload: {
          webhook: {
            id: webhookLog.id,
            provider: webhookLog.provider,
            eventType: webhookLog.eventType,
            receivedAt: webhookLog.receivedAt,
          },
        },
        timestamp: new Date(),
        attempts: 0,
      });

      // Attempt replay immediately
      await this.attemptReplay(replayId);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
