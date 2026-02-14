import { PipelineStage, WebhookContext, StageResult } from '../types';
import {
  StorageAdapter,
  CreateWebhookLogDto,
  CreateAuditLogDto,
  ProcessingStatus,
  AuditAction,
  AuditLog,
  TransactionQuery,
} from '../../../core';

/**
 * Stage 4: Persist Claim
 * Stores the webhook log atomically with all metadata
 */
export class PersistClaimStage implements PipelineStage {
  name = 'persist-claim';

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly storeRawPayload = true,
    private readonly redactKeys: string[] = [],
  ) {}

  async execute(context: WebhookContext): Promise<StageResult> {
    const startTime = Date.now();

    try {
      // Build webhook log data
      const webhookLogDto: CreateWebhookLogDto = {
        provider: context.provider,
        eventType: context.metadata?.eventType || 'unknown',
        providerEventId:
          context.metadata?.idempotencyKey || this.generateFallbackId(context),
        rawPayload: this.storeRawPayload
          ? this.redactSensitiveData(context.rawBody, this.redactKeys)
          : {},
        headers: this.redactHeaders(context.headers),
        signatureValid: context.signatureValid ?? false,
        processingStatus:
          context.processingStatus || ProcessingStatus.PROCESSED,
        processingDurationMs: Date.now() - context.startTime.getTime(),
        receivedAt: context.receivedAt,
        metadata: {
          ...context.metadata,
          processingId: context.processingId,
          normalizedEvent: context.normalizedEvent,
        },
      };

      // Find transaction if references are available
      let transactionId: string | undefined;
      if (context.metadata?.providerRef || context.metadata?.applicationRef) {
        const query: TransactionQuery = {};

        if (context.metadata.providerRef) {
          query.providerRef = context.metadata.providerRef;
        }
        if (context.metadata.applicationRef) {
          query.applicationRef = context.metadata.applicationRef;
        }

        const transaction = await this.storageAdapter.findTransaction(query);
        if (transaction) {
          transactionId = transaction.id;
          context.transaction = transaction;
        }
      }

      // Store webhook log atomically
      const webhookLog = await this.storageAdapter.createWebhookLog({
        ...webhookLogDto,
        transactionId,
      });

      // Store in context
      context.webhookLog = webhookLog;

      // Create audit entry if linked to transaction
      if (transactionId && context.transaction) {
        const auditEntry: CreateAuditLogDto = {
          transactionId,
          action: AuditAction.WEBHOOK_RECEIVED,
          performedBy: 'system',
          performedAt: new Date(),
          stateBefore: context.transaction.status,
          stateAfter: context.transaction.status, // No state change yet
          metadata: {
            webhookLogId: webhookLog.id,
            provider: context.provider,
            eventType: context.metadata?.eventType,
            processingStatus: webhookLog.processingStatus,
          },
        };

        await this.storageAdapter.createAuditLog(auditEntry);
      }

      return {
        success: true,
        context,
        shouldContinue: true,
        metadata: {
          webhookLogId: webhookLog.id,
          transactionLinked: !!transactionId,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      // Even if persistence fails, we want to track this
      context.processingStatus = ProcessingStatus.PARSE_ERROR;

      return {
        success: false,
        context,
        error: error instanceof Error ? error : new Error(String(error)),
        shouldContinue: false,
        metadata: {
          durationMs: Date.now() - startTime,
          failureReason: 'persist_failed',
        },
      };
    }
  }

  /**
   * Generate a fallback ID when no idempotency key is available
   */
  private generateFallbackId(context: WebhookContext): string {
    const hash = require('crypto')
      .createHash('sha256')
      .update(context.rawBody)
      .update(context.provider)
      .update(context.receivedAt.toISOString())
      .digest('hex');

    return `fallback_${hash.substring(0, 16)}`;
  }

  /**
   * Redact sensitive data from raw payload
   */
  private redactSensitiveData(
    rawBody: Buffer,
    redactKeys: string[],
  ): Record<string, any> {
    try {
      const payload = JSON.parse(rawBody.toString());

      if (redactKeys.length === 0) {
        return payload;
      }

      return this.deepRedact(payload, redactKeys);
    } catch {
      // If not JSON, return as base64 string
      return { raw: rawBody.toString('base64') };
    }
  }

  /**
   * Recursively redact sensitive keys from object
   */
  private deepRedact(obj: any, redactKeys: string[]): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepRedact(item, redactKeys));
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (
        redactKeys.some((redactKey) =>
          key.toLowerCase().includes(redactKey.toLowerCase()),
        )
      ) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = this.deepRedact(value, redactKeys);
      }
    }
    return result;
  }

  /**
   * Redact sensitive headers
   */
  private redactHeaders(
    headers: Record<string, string>,
  ): Record<string, string> {
    const sensitiveHeaders = [
      'authorization',
      'x-api-key',
      'x-secret-key',
      'x-auth-token',
    ];

    const redacted: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (
        sensitiveHeaders.some((sensitive) =>
          key.toLowerCase().includes(sensitive),
        )
      ) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }
}
