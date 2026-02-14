import {
  PipelineStage,
  WebhookContext,
  StageResult,
} from '../types';
import {
  EventDispatcher,
  StorageAdapter,
  CreateDispatchLogDto,
  CreateOutboxEventDto,
  DispatchStatus,
  ProcessingStatus,
} from '../../../core';

/**
 * Stage 7: Dispatch
 * Emits normalized events to registered handlers after successful processing
 */
export class DispatchStage implements PipelineStage {
  name = 'dispatch';

  constructor(
    private readonly eventDispatcher: EventDispatcher | undefined,
    private readonly storageAdapter: StorageAdapter,
    private readonly useOutbox = false,
  ) {}

  async execute(context: WebhookContext): Promise<StageResult> {
    const startTime = Date.now();

    try {
      // Skip dispatch if no event dispatcher configured
      if (!this.eventDispatcher) {
        return {
          success: true,
          context,
          shouldContinue: false, // Last stage
          metadata: {
            skipped: true,
            reason: 'No event dispatcher configured',
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Skip dispatch for certain processing statuses
      const skipStatuses = [
        ProcessingStatus.DUPLICATE,
        ProcessingStatus.SIGNATURE_FAILED,
        ProcessingStatus.NORMALIZATION_FAILED,
        ProcessingStatus.PARSE_ERROR,
      ];

      if (context.processingStatus && skipStatuses.includes(context.processingStatus)) {
        return {
          success: true,
          context,
          shouldContinue: false,
          metadata: {
            skipped: true,
            reason: `Skipping dispatch due to processing status: ${context.processingStatus}`,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Skip if no normalized event
      if (!context.normalizedEvent) {
        return {
          success: true,
          context,
          shouldContinue: false,
          metadata: {
            skipped: true,
            reason: 'No normalized event to dispatch',
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Build event payload
      const eventPayload = {
        eventType: context.normalizedEvent.eventType,
        transaction: context.transaction,
        webhook: {
          id: context.webhookLog?.id,
          provider: context.provider,
          receivedAt: context.receivedAt,
          processingId: context.processingId,
        },
        normalized: context.normalizedEvent,
        metadata: context.metadata,
      };

      // If using outbox pattern, write to outbox first
      if (this.useOutbox) {
        const outboxEvent: CreateOutboxEventDto = {
          eventType: context.normalizedEvent.eventType,
          aggregateId: context.transaction?.id || context.webhookLog?.id || context.processingId,
          aggregateType: context.transaction ? 'transaction' : 'webhook',
          payload: eventPayload,
          metadata: {
            webhookLogId: context.webhookLog?.id,
            transactionId: context.transaction?.id,
            provider: context.provider,
          },
        };

        const savedOutboxEvent = await this.storageAdapter.createOutboxEvent(outboxEvent);

        // Outbox processor will handle actual dispatch
        return {
          success: true,
          context,
          shouldContinue: false,
          metadata: {
            outboxEventId: savedOutboxEvent.id,
            eventType: context.normalizedEvent.eventType,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Direct dispatch (without outbox)
      const dispatchResults = await this.dispatchEvent(eventPayload, context);

      return {
        success: dispatchResults.allSuccessful,
        context,
        shouldContinue: false, // Last stage
        metadata: {
          dispatched: true,
          eventType: context.normalizedEvent.eventType,
          handlersInvoked: dispatchResults.handlersInvoked,
          successfulHandlers: dispatchResults.successfulHandlers,
          failedHandlers: dispatchResults.failedHandlers,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      // Dispatch errors shouldn't affect truth (webhook is already processed)
      console.error('Dispatch stage error:', error);

      return {
        success: true, // Soft fail
        context,
        shouldContinue: false,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
          softFail: true,
        },
      };
    }
  }

  /**
   * Dispatch event to handlers and log results
   */
  private async dispatchEvent(eventPayload: any, context: WebhookContext) {
    const results = {
      handlersInvoked: 0,
      successfulHandlers: 0,
      failedHandlers: 0,
      allSuccessful: true,
    };

    try {
      // Get registered handlers for this event type
      const handlers = this.eventDispatcher!.getHandlers(eventPayload.eventType);
      results.handlersInvoked = handlers.length;

      // Dispatch to each handler
      const dispatchPromises = handlers.map(async (handler) => {
        const handlerStartTime = Date.now();
        let status: DispatchStatus = DispatchStatus.PENDING;
        let error: Error | undefined;

        try {
          await this.eventDispatcher!.dispatch(
            eventPayload.eventType,
            eventPayload,
          );
          status = DispatchStatus.DELIVERED;
          results.successfulHandlers++;
        } catch (err) {
          status = DispatchStatus.FAILED;
          error = err instanceof Error ? err : new Error(String(err));
          results.failedHandlers++;
          results.allSuccessful = false;
        }

        // Log dispatch attempt
        const dispatchLog: CreateDispatchLogDto = {
          webhookLogId: context.webhookLog?.id,
          transactionId: context.transaction?.id,
          eventType: eventPayload.eventType,
          handlerName: handler.name || 'unknown',
          status,
          attemptedAt: new Date(handlerStartTime),
          completedAt: new Date(),
          durationMs: Date.now() - handlerStartTime,
          error: error?.message,
          metadata: {
            processingId: context.processingId,
            provider: context.provider,
          },
        };

        await this.storageAdapter.createDispatchLog(dispatchLog);

        if (error) {
          throw error; // Re-throw for Promise.allSettled to catch
        }
      });

      // Wait for all dispatches to complete
      await Promise.allSettled(dispatchPromises);

    } catch (error) {
      console.error('Error during event dispatch:', error);
      results.allSuccessful = false;
    }

    return results;
  }
}