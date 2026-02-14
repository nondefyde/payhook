import {
  PipelineStage,
  WebhookContext,
  StageResult,
  DuplicateWebhookError,
} from '../types';
import {
  StorageAdapter,
  WebhookQuery,
  ProcessingStatus,
  CreateAuditLogDto,
  AuditAction,
} from '../../../core';

/**
 * Stage 5: Deduplication
 * Checks for duplicate webhooks using idempotency keys and handles appropriately
 */
export class DeduplicationStage implements PipelineStage {
  name = 'deduplication';

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly skipDeduplication = false,
  ) {}

  async execute(context: WebhookContext): Promise<StageResult> {
    const startTime = Date.now();

    try {
      // Skip deduplication if configured (useful for replays)
      if (this.skipDeduplication) {
        return {
          success: true,
          context,
          shouldContinue: true,
          metadata: {
            skipped: true,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Need idempotency key for deduplication
      const idempotencyKey = context.metadata?.idempotencyKey;
      if (!idempotencyKey) {
        // No idempotency key means we can't deduplicate reliably
        // Continue processing but log this
        return {
          success: true,
          context,
          shouldContinue: true,
          metadata: {
            noIdempotencyKey: true,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Check for existing webhook with same provider and event ID
      const query: WebhookQuery = {
        provider: context.provider,
        providerEventId: idempotencyKey,
      };

      const existingWebhooks = await this.storageAdapter.findWebhookLogs(query);

      // Filter out the current webhook (which was just persisted)
      const duplicates = existingWebhooks.filter(
        w => w.id !== context.webhookLog?.id
      );

      if (duplicates.length > 0) {
        const existingWebhook = duplicates[0];

        // Mark current webhook as duplicate
        context.processingStatus = ProcessingStatus.DUPLICATE;

        // Update the webhook log we just created with duplicate status
        if (context.webhookLog) {
          await this.storageAdapter.updateWebhookLogStatus(
            context.webhookLog.id,
            ProcessingStatus.DUPLICATE,
            `Duplicate of ${existingWebhook.id} received at ${existingWebhook.receivedAt.toISOString()}`,
          );
        }

        // If linked to a transaction, audit the duplicate
        if (context.transaction) {
          const auditEntry: CreateAuditLogDto = {
            transactionId: context.transaction.id,
            action: AuditAction.WEBHOOK_RECEIVED,
            performedBy: 'system',
            performedAt: new Date(),
            stateBefore: context.transaction.status,
            stateAfter: context.transaction.status, // No state change for duplicates
            metadata: {
              webhookLogId: context.webhookLog?.id,
              duplicateOf: existingWebhook.id,
              eventType: context.metadata?.eventType,
              processingStatus: ProcessingStatus.DUPLICATE,
              reason: 'Duplicate webhook detected via idempotency key',
            },
          };

          await this.storageAdapter.createAuditLog(auditEntry);
        }

        // Return success but don't continue processing
        return {
          success: true,
          context,
          shouldContinue: false, // Stop processing duplicates
          metadata: {
            isDuplicate: true,
            originalWebhookId: existingWebhook.id,
            originalReceivedAt: existingWebhook.receivedAt,
            timeSinceOriginal:
              Date.now() - existingWebhook.receivedAt.getTime(),
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Not a duplicate, continue processing
      return {
        success: true,
        context,
        shouldContinue: true,
        metadata: {
          isDuplicate: false,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      // Deduplication failure shouldn't stop processing
      // Log the error but continue
      console.error('Deduplication stage error:', error);

      return {
        success: true, // Soft fail - continue processing
        context,
        shouldContinue: true,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
          softFail: true,
        },
      };
    }
  }
}
