import {
  PipelineStage,
  WebhookContext,
  StageResult,
  TransactionNotFoundError,
} from '../types';
import {
  StorageAdapter,
  TransactionStateMachine,
  ProcessingStatus,
  CreateAuditLogDto,
  CreateTransactionDto,
  AuditAction,
  TransactionStatus,
  TriggerType,
  TransitionContext,
  VerificationMethod,
  NormalizedEventType,
} from '../../../core';

/**
 * Stage 6: State Engine
 * Applies state transitions based on webhook events and business rules
 */
export class StateEngineStage implements PipelineStage {
  name = 'state-engine';

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly stateMachine: TransactionStateMachine,
    private readonly autoCreateTransactions = false,
  ) {}

  async execute(context: WebhookContext): Promise<StageResult> {
    const startTime = Date.now();

    try {
      // Skip if no normalized event (can't determine state transition)
      if (!context.normalizedEvent) {
        context.processingStatus = ProcessingStatus.NORMALIZATION_FAILED;
        return {
          success: true,
          context,
          shouldContinue: true,
          metadata: {
            skipped: true,
            reason: 'No normalized event',
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Find or create transaction
      let transaction = context.transaction;

      if (!transaction) {
        // Try to find transaction using references
        if (context.metadata?.providerRef || context.metadata?.applicationRef) {
          transaction = await this.findTransaction(context);
        }

        // If still not found and auto-create is enabled
        if (
          !transaction &&
          this.autoCreateTransactions &&
          this.shouldAutoCreate(context)
        ) {
          transaction = await this.createTransaction(context);
        }
      }

      // If no transaction found, mark as unmatched
      if (!transaction) {
        context.processingStatus = ProcessingStatus.UNMATCHED;

        // Update webhook log with unmatched status
        if (context.webhookLog) {
          await this.storageAdapter.updateWebhookLogStatus(
            context.webhookLog.id,
            ProcessingStatus.UNMATCHED,
            JSON.stringify({
              reason: 'No matching transaction found',
              providerRef: context.metadata?.providerRef,
              applicationRef: context.metadata?.applicationRef,
            }),
          );
        }

        return {
          success: true,
          context,
          shouldContinue: true,
          metadata: {
            unmatched: true,
            reason: 'Transaction not found',
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Store transaction in context
      context.transaction = transaction;

      // Determine target status based on normalized event
      const targetStatus = this.determineTargetStatus(
        context.normalizedEvent.eventType,
      );

      if (!targetStatus) {
        // Event doesn't map to a state transition
        return {
          success: true,
          context,
          shouldContinue: true,
          metadata: {
            noTransition: true,
            eventType: context.normalizedEvent.eventType,
            currentStatus: transaction.status,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Check if transition is needed
      if (transaction.status === targetStatus) {
        // Already in target state
        return {
          success: true,
          context,
          shouldContinue: true,
          metadata: {
            alreadyInTargetState: true,
            status: targetStatus,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Build transition context
      const transitionContext: TransitionContext = {
        currentStatus: transaction.status,
        targetStatus,
        triggerType: TriggerType.WEBHOOK,
        metadata: {
          webhookLogId: context.webhookLog?.id,
          provider: context.provider,
          eventType: context.normalizedEvent.eventType,
          providerRef: context.metadata?.providerRef,
        },
      };

      // Validate transition
      const validationResult = await this.stateMachine.validateTransition(
        transaction.status,
        targetStatus,
        transitionContext,
      );

      if (!validationResult.success) {
        // Transition not allowed
        context.processingStatus = ProcessingStatus.TRANSITION_REJECTED;

        // Create audit entry for rejected transition
        const auditEntry: CreateAuditLogDto = {
          transactionId: transaction.id,
          action: AuditAction.WEBHOOK_RECEIVED,
          performedBy: 'system',
          performedAt: new Date(),
          stateBefore: transaction.status,
          stateAfter: transaction.status, // No change
          metadata: {
            webhookLogId: context.webhookLog?.id,
            attemptedTransition: `${transaction.status} -> ${targetStatus}`,
            rejectionReason: validationResult.reason,
            eventType: context.normalizedEvent.eventType,
          },
        };

        await this.storageAdapter.createAuditLog(auditEntry);

        return {
          success: true,
          context,
          shouldContinue: true,
          metadata: {
            transitionRejected: true,
            reason: validationResult.reason,
            from: transaction.status,
            to: targetStatus,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Apply the transition atomically
      const auditEntry: CreateAuditLogDto = {
        transactionId: transaction.id,
        action: AuditAction.WEBHOOK_STATE_TRANSITION,
        performedBy: 'system',
        performedAt: new Date(),
        stateBefore: transaction.status,
        stateAfter: targetStatus,
        metadata: {
          webhookLogId: context.webhookLog?.id,
          provider: context.provider,
          eventType: context.normalizedEvent.eventType,
          normalizedAmount: context.normalizedEvent.amount,
          providerRef: context.metadata?.providerRef,
        },
      };

      // Link provider reference if available and not already linked
      if (context.metadata?.providerRef && !transaction.providerRef) {
        await this.storageAdapter.linkProviderRef(
          transaction.id,
          context.metadata.providerRef,
        );
      }

      // Update transaction status with audit
      const updatedTransaction =
        await this.storageAdapter.updateTransactionStatus(
          transaction.id,
          targetStatus,
          auditEntry,
        );

      // Update context
      context.transaction = updatedTransaction;

      // Link webhook to transaction if not already linked
      if (context.webhookLog && !context.webhookLog.transactionId) {
        await this.storageAdapter.linkWebhookToTransaction(
          context.webhookLog.id,
          transaction.id,
        );
      }

      return {
        success: true,
        context,
        shouldContinue: true,
        metadata: {
          transitionApplied: true,
          from: transaction.status,
          to: targetStatus,
          transactionId: transaction.id,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
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

  /**
   * Find transaction using available references
   */
  private async findTransaction(context: WebhookContext) {
    const query: any = {};

    if (context.metadata?.providerRef) {
      query.providerRef = context.metadata.providerRef;
    }
    if (context.metadata?.applicationRef) {
      query.applicationRef = context.metadata.applicationRef;
    }

    const result = await this.storageAdapter.findTransaction(query);
    return result || undefined;
  }

  /**
   * Create a new transaction from webhook context
   */
  private async createTransaction(context: WebhookContext) {
    if (!context.normalizedEvent) {
      return undefined;
    }

    const dto: CreateTransactionDto = {
      applicationRef:
        context.metadata?.applicationRef ||
        `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      provider: context.provider,
      amount: context.normalizedEvent.amount,
      currency: context.normalizedEvent.currency,
      metadata: {
        autoCreated: true,
        webhookLogId: context.webhookLog?.id,
        providerRef: context.metadata?.providerRef,
        createdFrom: 'webhook',
      },
    };

    const transaction = await this.storageAdapter.createTransaction(dto);

    // Link provider ref if available
    if (context.metadata?.providerRef) {
      await this.storageAdapter.linkProviderRef(
        transaction.id,
        context.metadata.providerRef,
      );
    }

    // Create audit entry
    const auditEntry: CreateAuditLogDto = {
      transactionId: transaction.id,
      action: AuditAction.TRANSACTION_CREATED,
      performedBy: 'system',
      performedAt: new Date(),
      stateBefore: null,
      stateAfter: transaction.status,
      metadata: {
        autoCreated: true,
        webhookLogId: context.webhookLog?.id,
        triggerType: TriggerType.WEBHOOK,
      },
    };

    await this.storageAdapter.createAuditLog(auditEntry);

    return transaction;
  }

  /**
   * Determine if transaction should be auto-created
   */
  private shouldAutoCreate(context: WebhookContext): boolean {
    if (!context.normalizedEvent) {
      return false;
    }

    // Only auto-create for initial payment events
    const initialEvents = [
      NormalizedEventType.PAYMENT_AUTHORIZED,
      NormalizedEventType.PAYMENT_CAPTURED,
      NormalizedEventType.PAYMENT_SUCCEEDED,
    ];

    return initialEvents.includes(context.normalizedEvent.eventType);
  }

  /**
   * Map normalized event type to target transaction status
   */
  private determineTargetStatus(
    eventType: NormalizedEventType,
  ): TransactionStatus | null {
    const statusMap: Partial<
      Record<NormalizedEventType, TransactionStatus | null>
    > = {
      [NormalizedEventType.PAYMENT_AUTHORIZED]: TransactionStatus.PROCESSING,
      [NormalizedEventType.PAYMENT_CAPTURED]: TransactionStatus.PROCESSING,
      [NormalizedEventType.PAYMENT_SUCCEEDED]: TransactionStatus.SUCCESSFUL,
      [NormalizedEventType.PAYMENT_SUCCESSFUL]: TransactionStatus.SUCCESSFUL,
      [NormalizedEventType.PAYMENT_FAILED]: TransactionStatus.FAILED,
      [NormalizedEventType.PAYMENT_ABANDONED]: TransactionStatus.ABANDONED,
      [NormalizedEventType.PAYMENT_CANCELLED]: TransactionStatus.ABANDONED,
      [NormalizedEventType.PAYMENT_EXPIRED]: TransactionStatus.ABANDONED,
      [NormalizedEventType.REFUND_INITIATED]: TransactionStatus.REFUNDED,
      [NormalizedEventType.REFUND_COMPLETED]: TransactionStatus.REFUNDED,
      [NormalizedEventType.REFUND_SUCCESSFUL]: TransactionStatus.REFUNDED,
      [NormalizedEventType.REFUND_PENDING]: TransactionStatus.REFUNDED,
      [NormalizedEventType.REFUND_PARTIAL]:
        TransactionStatus.PARTIALLY_REFUNDED,
      [NormalizedEventType.REFUND_FAILED]: null, // No status change
      [NormalizedEventType.CHARGE_DISPUTED]: TransactionStatus.DISPUTED,
      [NormalizedEventType.DISPUTE_CREATED]: TransactionStatus.DISPUTED,
      [NormalizedEventType.DISPUTE_RESOLVED]: TransactionStatus.SUCCESSFUL, // Depends on outcome
      [NormalizedEventType.DISPUTE_WON]: TransactionStatus.RESOLVED_WON,
      [NormalizedEventType.DISPUTE_LOST]: TransactionStatus.RESOLVED_LOST,
      [NormalizedEventType.DISPUTE_CANCELLED]: TransactionStatus.SUCCESSFUL, // Back to successful
      [NormalizedEventType.UNKNOWN]: null,
    };

    return statusMap[eventType] ?? null;
  }
}
