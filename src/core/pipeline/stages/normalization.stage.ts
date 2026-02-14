import { PipelineStage, WebhookContext, StageResult } from '../types';
import {
  PaymentProviderAdapter,
  ProcessingStatus,
  NormalizationError,
} from '../../../core';

/**
 * Stage 3: Normalization
 * Maps provider-specific payload to PayHook unified schema
 */
export class NormalizationStage implements PipelineStage {
  name = 'normalization';

  constructor(
    private readonly providerAdapters: Map<string, PaymentProviderAdapter>,
  ) {}

  async execute(context: WebhookContext): Promise<StageResult> {
    const startTime = Date.now();

    try {
      // Get provider adapter
      const adapter = this.providerAdapters.get(context.provider);
      if (!adapter) {
        throw new Error(`No adapter found for provider: ${context.provider}`);
      }

      // Parse the raw payload
      let parsedPayload: Record<string, any>;
      try {
        parsedPayload = adapter.parsePayload(context.rawBody);
      } catch (error) {
        context.processingStatus = ProcessingStatus.PARSE_ERROR;
        throw new Error(
          `Failed to parse webhook payload: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Store parsed payload in context for later use
      context.metadata = {
        ...context.metadata,
        parsedPayload,
      };

      // Normalize the payload
      try {
        context.normalizedEvent = adapter.normalize(parsedPayload);
      } catch (error) {
        if (error instanceof NormalizationError) {
          context.normalizationError = error.message;
          context.processingStatus = ProcessingStatus.NORMALIZATION_FAILED;

          return {
            success: false,
            context,
            error,
            shouldContinue: false,
            metadata: {
              eventType: error.eventType,
              provider: error.providerName,
              durationMs: Date.now() - startTime,
            },
          };
        }
        throw error;
      }

      // Extract additional metadata
      const references = adapter.extractReferences(parsedPayload);
      const eventType = adapter.extractEventType(parsedPayload);
      const idempotencyKey = adapter.extractIdempotencyKey(parsedPayload);

      // Store in context
      context.metadata = {
        ...context.metadata,
        providerRef: references.providerRef,
        applicationRef: references.applicationRef,
        eventType,
        idempotencyKey,
        isSuccessEvent: adapter.isSuccessEvent(eventType),
        isFailureEvent: adapter.isFailureEvent(eventType),
        isRefundEvent: adapter.isRefundEvent(eventType),
        isDisputeEvent: adapter.isDisputeEvent(eventType),
      };

      return {
        success: true,
        context,
        shouldContinue: true,
        metadata: {
          normalizedEventType: context.normalizedEvent.eventType,
          providerEventType: eventType,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      if (!context.processingStatus) {
        context.processingStatus = ProcessingStatus.NORMALIZATION_FAILED;
      }
      context.normalizationError =
        error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        context,
        error: error instanceof Error ? error : new Error(String(error)),
        shouldContinue: false,
        metadata: {
          durationMs: Date.now() - startTime,
        },
      };
    }
  }
}
