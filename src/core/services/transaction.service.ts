import {
  StorageAdapter,
  PaymentProviderAdapter,
  TransactionStateMachine,
  EventDispatcher,
  Transaction,
  TransactionStatus,
  CreateTransactionDto,
  UpdateTransactionDto,
  TransactionQuery,
  MarkAsProcessingDto,
  CreateAuditLogDto,
  AuditLog,
  AuditAction,
  WebhookLog,
  WebhookQuery,
  ProcessingStatus,
  VerificationMethod,
  TriggerType,
  ReconciliationResult,
  ReconciliationResultData,
  TransitionContext,
  Money,
  NormalizedEventType,
  DispatchStatus,
  CreateDispatchLogDto,
} from '../../core';

/**
 * Query-first Transaction Service
 *
 * Primary interface for interacting with PayHook.
 * All operations go through this service for consistency and audit trail.
 */
export class TransactionService {
  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly providerAdapters: Map<string, PaymentProviderAdapter>,
    private readonly stateMachine: TransactionStateMachine,
    private readonly eventDispatcher?: EventDispatcher,
  ) {}

  /**
   * Create a new transaction
   * Called when payment is initiated but before provider interaction
   */
  async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
    // Validate amount and currency
    const money = new Money(dto.amount, dto.currency);

    // Create transaction through storage adapter
    const transaction = await this.storageAdapter.createTransaction({
      ...dto,
      amount: money.amount,
      currency: money.currency,
    });

    // Create audit entry
    const auditEntry: CreateAuditLogDto = {
      transactionId: transaction.id,
      action: AuditAction.TRANSACTION_CREATED,
      performedBy: dto.createdBy || 'system',
      performedAt: new Date(),
      stateBefore: null,
      stateAfter: transaction.status,
      metadata: {
        applicationRef: dto.applicationRef,
        provider: dto.provider,
        amount: money.amount,
        currency: money.currency,
      },
    };

    await this.storageAdapter.createAuditLog(auditEntry);

    return transaction;
  }

  /**
   * Mark transaction as processing
   * Called after successful provider handoff
   */
  async markAsProcessing(
    transactionId: string,
    dto: MarkAsProcessingDto,
  ): Promise<Transaction> {
    // Get current transaction
    const transaction = await this.getTransaction(transactionId);
    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    // Validate state transition
    const context: TransitionContext = {
      currentStatus: transaction.status,
      targetStatus: TransactionStatus.PROCESSING,
      triggerType: TriggerType.MANUAL,
      metadata: {
        providerRef: dto.providerRef,
      },
    };

    const validationResult = await this.stateMachine.validateTransition(
      transaction.status,
      TransactionStatus.PROCESSING,
      context,
    );

    if (!validationResult.success) {
      throw new Error(
        `Cannot transition from ${transaction.status} to PROCESSING: ${validationResult.reason}`,
      );
    }

    // Create audit entry
    const auditEntry: CreateAuditLogDto = {
      transactionId,
      action: AuditAction.MANUAL_TRANSITION,
      performedBy: dto.performedBy || 'system',
      performedAt: new Date(),
      stateBefore: transaction.status,
      stateAfter: TransactionStatus.PROCESSING,
      metadata: {
        providerRef: dto.providerRef,
        verificationMethod: dto.verificationMethod,
        reason: 'Marked as processing after provider handoff',
      },
    };

    // Update transaction atomically
    return await this.storageAdapter.markAsProcessing(
      transactionId,
      dto,
      auditEntry,
    );
  }

  /**
   * Get transaction by ID with optional verification
   */
  async getTransaction(
    transactionId: string,
    options: {
      verify?: boolean;
      includeWebhooks?: boolean;
      includeAuditTrail?: boolean;
    } = {},
  ): Promise<Transaction | null> {
    const transaction = await this.storageAdapter.findTransaction({
      id: transactionId,
    });

    if (!transaction) {
      return null;
    }

    // Verify with provider if requested
    if (options.verify && transaction.providerRef) {
      const verificationResult = await this.verifyWithProvider(
        transaction.id,
        transaction.provider,
        transaction.providerRef,
      );

      // Update verification metadata
      if (verificationResult) {
        transaction.metadata = {
          ...transaction.metadata,
          lastVerified: new Date(),
          verificationResult,
        };
      }
    }

    // Attach webhooks if requested
    if (options.includeWebhooks) {
      const webhooks = await this.storageAdapter.findWebhookLogs({
        transactionId: transaction.id,
      });
      transaction.metadata = {
        ...transaction.metadata,
        webhooks: webhooks.map((w) => ({
          id: w.id,
          eventType: w.eventType,
          receivedAt: w.receivedAt,
          processingStatus: w.processingStatus,
        })),
      };
    }

    // Attach audit trail if requested
    if (options.includeAuditTrail) {
      const auditLogs = await this.getAuditTrail(transaction.id);
      transaction.metadata = {
        ...transaction.metadata,
        auditTrail: auditLogs,
      };
    }

    return transaction;
  }

  /**
   * Get transaction by application reference
   */
  async getTransactionByApplicationRef(
    applicationRef: string,
    options: {
      verify?: boolean;
      includeWebhooks?: boolean;
      includeAuditTrail?: boolean;
    } = {},
  ): Promise<Transaction | null> {
    const transaction = await this.storageAdapter.findTransaction({
      applicationRef,
    });

    if (!transaction) {
      return null;
    }

    // Use getTransaction for consistent behavior
    return this.getTransaction(transaction.id, options);
  }

  /**
   * Get transaction by provider reference
   */
  async getTransactionByProviderRef(
    provider: string,
    providerRef: string,
    options: {
      verify?: boolean;
      includeWebhooks?: boolean;
      includeAuditTrail?: boolean;
    } = {},
  ): Promise<Transaction | null> {
    const transaction = await this.storageAdapter.findTransaction({
      provider,
      providerRef,
    });

    if (!transaction) {
      return null;
    }

    // Use getTransaction for consistent behavior
    return this.getTransaction(transaction.id, options);
  }

  /**
   * Get audit trail for a transaction
   */
  async getAuditTrail(transactionId: string): Promise<AuditLog[]> {
    return await this.storageAdapter.getAuditLogs(transactionId);
  }

  /**
   * Check if transaction is in a settled state
   */
  async isSettled(transactionId: string): Promise<boolean> {
    const transaction = await this.getTransaction(transactionId);
    return transaction ? transaction.isSettled() : false;
  }

  /**
   * List transactions by status with pagination
   */
  async listTransactionsByStatus(
    status: TransactionStatus,
    options: {
      limit?: number;
      offset?: number;
      provider?: string;
      fromDate?: Date;
      toDate?: Date;
    } = {},
  ): Promise<{
    transactions: Transaction[];
    total: number;
    hasMore: boolean;
  }> {
    const query: TransactionQuery = {
      status,
      provider: options.provider,
      createdAfter: options.fromDate,
      createdBefore: options.toDate,
    };

    const limit = options.limit || 100;
    const offset = options.offset || 0;
    const page = Math.floor(offset / limit) + 1;

    const transactions = await this.storageAdapter.findTransactions(query, {
      limit,
      page,
    });

    const total = await this.storageAdapter.countTransactions(query);

    return {
      transactions,
      total,
      hasMore: (options.offset || 0) + transactions.length < total,
    };
  }

  /**
   * Get webhooks for a transaction
   */
  async getTransactionWebhooks(transactionId: string): Promise<WebhookLog[]> {
    return await this.storageAdapter.findWebhookLogs({ transactionId });
  }

  /**
   * Reconcile transaction with provider
   */
  async reconcile(
    transactionId: string,
    options: {
      force?: boolean;
      updateStatus?: boolean;
    } = {},
  ): Promise<ReconciliationResultData> {
    const transaction = await this.getTransaction(transactionId);
    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    if (!transaction.providerRef) {
      return {
        success: false,
        diverged: false,
        reason: 'No provider reference available',
      };
    }

    // Get provider adapter
    const adapter = this.providerAdapters.get(transaction.provider);
    if (!adapter) {
      return {
        success: false,
        diverged: false,
        reason: `No adapter for provider: ${transaction.provider}`,
      };
    }

    // Skip if API verification not supported
    if (!adapter.verifyWithProvider) {
      return {
        success: false,
        diverged: false,
        reason: 'Provider does not support API verification',
      };
    }

    try {
      // Verify with provider
      const providerResult = await adapter.verifyWithProvider(
        transaction.providerRef,
      );

      if (!providerResult) {
        return {
          success: false,
          diverged: false,
          reason: 'Transaction not found at provider',
        };
      }

      // Check for divergence
      const expectedStatus = this.mapProviderStatus(providerResult.status);
      const diverged = transaction.status !== expectedStatus;

      // Create reconciliation audit entry
      const auditEntry: CreateAuditLogDto = {
        transactionId: transaction.id,
        action: AuditAction.RECONCILIATION,
        performedBy: 'system',
        performedAt: new Date(),
        stateBefore: transaction.status,
        stateAfter: transaction.status,
        metadata: {
          providerStatus: providerResult.status,
          expectedStatus,
          diverged,
          providerAmount: providerResult.amount,
          providerCurrency: providerResult.currency,
          force: options.force,
        },
      };

      // Update status if diverged and updateStatus is true
      if (diverged && options.updateStatus) {
        const context: TransitionContext = {
          currentStatus: transaction.status,
          targetStatus: expectedStatus,
          triggerType: TriggerType.RECONCILIATION,
          metadata: {
            providerStatus: providerResult.status,
            force: options.force,
          },
        };

        const validationResult = await this.stateMachine.validateTransition(
          transaction.status,
          expectedStatus,
          context,
        );

        if (validationResult.success || options.force) {
          auditEntry.stateAfter = expectedStatus;
          await this.storageAdapter.updateTransactionStatus(
            transaction.id,
            expectedStatus,
            auditEntry,
          );

          return {
            success: true,
            diverged: true,
            localStatus: transaction.status,
            providerStatus: providerResult.status,
            corrected: true,
            newStatus: expectedStatus,
          };
        } else {
          await this.storageAdapter.createAuditLog(auditEntry);

          return {
            success: false,
            diverged: true,
            localStatus: transaction.status,
            providerStatus: providerResult.status,
            reason: `Cannot transition: ${validationResult.reason}`,
          };
        }
      }

      await this.storageAdapter.createAuditLog(auditEntry);

      return {
        success: true,
        diverged,
        localStatus: transaction.status,
        providerStatus: providerResult.status,
      };
    } catch (error) {
      return {
        success: false,
        diverged: false,
        reason:
          error instanceof Error ? error.message : 'Reconciliation failed',
      };
    }
  }

  /**
   * Scan for stale transactions that need reconciliation
   */
  async scanStaleTransactions(
    options: {
      staleAfterMinutes?: number;
      limit?: number;
      provider?: string;
    } = {},
  ): Promise<Transaction[]> {
    const staleAfter = new Date(
      Date.now() - (options.staleAfterMinutes || 60) * 60 * 1000,
    );

    const query: TransactionQuery = {
      status: TransactionStatus.PROCESSING,
      provider: options.provider,
      createdBefore: staleAfter,
    };

    return await this.storageAdapter.findTransactions(query, {
      limit: options.limit || 100,
      page: 1,
    });
  }

  /**
   * Update transaction metadata
   */
  async updateTransactionMetadata(
    transactionId: string,
    metadata: Record<string, any>,
    performedBy: string = 'system',
  ): Promise<Transaction> {
    const transaction = await this.getTransaction(transactionId);
    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    // Create audit entry
    const auditEntry: CreateAuditLogDto = {
      transactionId,
      action: AuditAction.METADATA_UPDATED,
      performedBy,
      performedAt: new Date(),
      stateBefore: transaction.status,
      stateAfter: transaction.status,
      metadata: {
        updatedFields: Object.keys(metadata),
      },
    };

    await this.storageAdapter.createAuditLog(auditEntry);

    // Update metadata
    return await this.storageAdapter.updateTransaction(transactionId, {
      metadata: {
        ...transaction.metadata,
        ...metadata,
        lastUpdated: new Date(),
      },
    });
  }

  /**
   * Get transaction statistics
   */
  async getStatistics(
    options: {
      provider?: string;
      fromDate?: Date;
      toDate?: Date;
    } = {},
  ): Promise<{
    total: number;
    byStatus: Record<TransactionStatus, number>;
    byProvider: Record<string, number>;
    totalAmount: Record<string, number>; // By currency
  }> {
    const stats = {
      total: 0,
      byStatus: {} as Record<TransactionStatus, number>,
      byProvider: {} as Record<string, number>,
      totalAmount: {} as Record<string, number>,
    };

    // Get counts by status
    for (const status of Object.values(TransactionStatus)) {
      const count = await this.storageAdapter.countTransactions({
        status,
        provider: options.provider,
        createdAfter: options.fromDate,
        createdBefore: options.toDate,
      });
      stats.byStatus[status] = count;
      stats.total += count;
    }

    // Get counts by provider
    if (!options.provider) {
      for (const [provider] of this.providerAdapters) {
        const count = await this.storageAdapter.countTransactions({
          provider,
          createdAfter: options.fromDate,
          createdBefore: options.toDate,
        });
        stats.byProvider[provider] = count;
      }
    } else {
      stats.byProvider[options.provider] = stats.total;
    }

    // Note: Total amounts would require aggregation support in StorageAdapter
    // This is a simplified version
    const successfulTransactions = await this.storageAdapter.findTransactions({
      status: TransactionStatus.SUCCESSFUL,
      provider: options.provider,
      createdAfter: options.fromDate,
      createdBefore: options.toDate,
    });

    for (const txn of successfulTransactions) {
      const currency = txn.money.currency;
      stats.totalAmount[currency] =
        (stats.totalAmount[currency] || 0) + txn.money.amount;
    }

    return stats;
  }

  /**
   * Private: Verify transaction with provider
   */
  private async verifyWithProvider(
    transactionId: string,
    provider: string,
    providerRef: string,
  ): Promise<any> {
    const adapter = this.providerAdapters.get(provider);
    if (!adapter || !adapter.verifyWithProvider) {
      return null;
    }

    try {
      const result = await adapter.verifyWithProvider(providerRef);

      // Update verification method if successful
      if (result) {
        await this.storageAdapter.updateTransaction(transactionId, {
          verificationMethod: VerificationMethod.WEBHOOK_AND_API,
          metadata: {
            lastApiVerification: new Date(),
            apiVerificationResult: result,
          },
        });
      }

      return result;
    } catch (error) {
      console.error(`Failed to verify with provider ${provider}:`, error);
      return null;
    }
  }

  /**
   * Private: Map provider status to transaction status
   */
  private mapProviderStatus(providerStatus: string): TransactionStatus {
    // This would be provider-specific, but here's a generic mapping
    const statusMap: Record<string, TransactionStatus> = {
      success: TransactionStatus.SUCCESSFUL,
      successful: TransactionStatus.SUCCESSFUL,
      completed: TransactionStatus.SUCCESSFUL,
      failed: TransactionStatus.FAILED,
      pending: TransactionStatus.PENDING,
      processing: TransactionStatus.PROCESSING,
      abandoned: TransactionStatus.ABANDONED,
      cancelled: TransactionStatus.ABANDONED,
      refunded: TransactionStatus.REFUNDED,
      disputed: TransactionStatus.DISPUTED,
    };

    return statusMap[providerStatus.toLowerCase()] || TransactionStatus.PENDING;
  }

  /**
   * Link an unmatched webhook to a transaction (AC-8.2)
   * Enables late matching of webhooks that couldn't be matched initially
   */
  async linkUnmatchedWebhook(
    webhookLogId: string,
    transactionId: string,
  ): Promise<{
    success: boolean;
    error?: string;
    transitionApplied?: boolean;
  }> {
    // Get webhook log
    const webhookLogs = await this.storageAdapter.findWebhookLogs({
      id: webhookLogId,
    });
    if (webhookLogs.length === 0) {
      return { success: false, error: 'Webhook log not found' };
    }

    const webhookLog = webhookLogs[0];

    // Verify it's unmatched
    if (webhookLog.processingStatus !== ProcessingStatus.UNMATCHED) {
      return { success: false, error: 'Webhook is not unmatched' };
    }

    // Get transaction
    const transaction = await this.getTransaction(transactionId);
    if (!transaction) {
      return { success: false, error: 'Transaction not found' };
    }

    // Try to apply the transition based on webhook event
    if (webhookLog.metadata?.normalizedEvent) {
      const targetStatus = this.determineTargetStatus(
        webhookLog.metadata.normalizedEvent.eventType,
      );

      if (targetStatus) {
        const context: TransitionContext = {
          currentStatus: transaction.status,
          targetStatus,
          triggerType: TriggerType.LATE_MATCH,
          metadata: {
            webhookLogId,
            originalReceivedAt: webhookLog.receivedAt,
          },
        };

        const validationResult = await this.stateMachine.validateTransition(
          transaction.status,
          targetStatus,
          context,
        );

        if (validationResult.success) {
          // Apply transition atomically
          await this.storageAdapter.withTransaction(async (manager) => {
            // Update webhook log to link it to the transaction
            await this.storageAdapter.linkWebhookToTransaction(
              webhookLogId,
              transactionId,
            );

            // Apply state transition
            await this.storageAdapter.updateTransactionStatus(
              transactionId,
              targetStatus,
              {
                transactionId,
                action: AuditAction.LATE_MATCH,
                performedBy: 'system',
                performedAt: new Date(),
                stateBefore: transaction.status,
                stateAfter: targetStatus,
                metadata: {
                  webhookLogId,
                  triggerType: 'late_match',
                },
              },
            );
          });

          // Dispatch event if dispatcher available
          if (this.eventDispatcher) {
            await this.eventDispatcher.dispatch(
              webhookLog.metadata.normalizedEvent.eventType,
              {
                transaction,
                webhook: webhookLog,
                normalized: webhookLog.metadata.normalizedEvent,
                lateMatch: true,
              },
            );
          }

          return { success: true, transitionApplied: true };
        } else {
          // Transition rejected but still link
          await this.storageAdapter.linkWebhookToTransaction(
            webhookLogId,
            transactionId,
          );
          return {
            success: true,
            transitionApplied: false,
            error: `Transition rejected: ${validationResult.reason}`,
          };
        }
      }
    }

    // Just link without transition
    await this.storageAdapter.linkWebhookToTransaction(
      webhookLogId,
      transactionId,
    );
    return { success: true, transitionApplied: false };
  }

  /**
   * List unmatched webhooks (AC-8.3)
   * Returns webhooks that couldn't be matched to transactions
   */
  async listUnmatchedWebhooks(
    options: {
      provider?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{
    webhooks: WebhookLog[];
    total: number;
    hasMore: boolean;
  }> {
    const query: WebhookQuery = {
      processingStatus: ProcessingStatus.UNMATCHED,
      provider: options.provider,
    };

    const webhooks = await this.storageAdapter.findWebhookLogs(query);
    const total = await this.storageAdapter.countWebhookLogs(query);

    // Apply pagination
    const start = options.offset || 0;
    const limit = options.limit || 100;
    const paginated = webhooks.slice(start, start + limit);

    return {
      webhooks: paginated,
      total,
      hasMore: start + paginated.length < total,
    };
  }

  /**
   * Replay events for a transaction (AC-7.1)
   * Re-dispatches events based on audit trail for testing or recovery
   */
  async replayEvents(
    transactionId: string,
    options?: {
      fromDate?: Date;
      toDate?: Date;
      eventTypes?: string[];
    },
  ): Promise<{
    total: number;
    replayed: number;
    failed: number;
  }> {
    // Get audit trail
    const auditLogs = await this.getAuditLogs({
      transactionId,
      performedAfter: options?.fromDate,
      performedBefore: options?.toDate,
    });

    let replayed = 0;
    let failed = 0;

    for (const audit of auditLogs) {
      // Only replay state transitions
      if (audit.stateBefore !== audit.stateAfter && audit.stateAfter) {
        try {
          // Determine event type from transition
          const eventType = this.getEventTypeForTransition(
            audit.stateBefore,
            audit.stateAfter,
          );

          if (
            eventType &&
            (!options?.eventTypes || options.eventTypes.includes(eventType))
          ) {
            // Get current transaction state
            const transaction = await this.getTransaction(transactionId);

            if (transaction && this.eventDispatcher) {
              await this.eventDispatcher.dispatch(eventType, {
                transaction,
                auditLog: audit,
                isReplay: true,
                originalTimestamp: audit.performedAt,
              });

              // Log replay dispatch
              const dispatchLog: CreateDispatchLogDto = {
                transactionId,
                eventType,
                handlerName: 'replay',
                status: DispatchStatus.DELIVERED,
                attemptedAt: new Date(),
                completedAt: new Date(),
                metadata: {
                  isReplay: true,
                  auditLogId: audit.id,
                },
              };
              await this.storageAdapter.createDispatchLog(dispatchLog);

              replayed++;
            }
          }
        } catch (error) {
          failed++;
          console.error(`Failed to replay event for audit ${audit.id}:`, error);
        }
      }
    }

    return {
      total: auditLogs.length,
      replayed,
      failed,
    };
  }

  /**
   * Purge expired logs (AC-17.3)
   * Removes old webhook and dispatch logs based on retention policy
   */
  async purgeExpiredLogs(config: {
    webhookLogDays: number;
    dispatchLogDays: number;
  }): Promise<{
    webhookLogsDeleted: number;
    dispatchLogsDeleted: number;
  }> {
    const now = new Date();

    // Calculate cutoff dates
    const webhookCutoff = new Date(
      now.getTime() - config.webhookLogDays * 24 * 60 * 60 * 1000,
    );
    const dispatchCutoff = new Date(
      now.getTime() - config.dispatchLogDays * 24 * 60 * 60 * 1000,
    );

    // Note: This requires StorageAdapter to implement purge methods
    // For now, we'll add a basic implementation that can be extended
    let webhookLogsDeleted = 0;
    let dispatchLogsDeleted = 0;

    // Check if storage adapter has purge capability
    if ('purgeWebhookLogs' in this.storageAdapter) {
      webhookLogsDeleted = await (this.storageAdapter as any).purgeWebhookLogs(
        webhookCutoff,
      );
    } else {
      console.warn('Storage adapter does not implement purgeWebhookLogs');
    }

    if ('purgeDispatchLogs' in this.storageAdapter) {
      dispatchLogsDeleted = await (
        this.storageAdapter as any
      ).purgeDispatchLogs(dispatchCutoff);
    } else {
      console.warn('Storage adapter does not implement purgeDispatchLogs');
    }

    return {
      webhookLogsDeleted,
      dispatchLogsDeleted,
    };
  }

  /**
   * Helper: Determine target status from normalized event type
   */
  private determineTargetStatus(
    eventType: NormalizedEventType,
  ): TransactionStatus | null {
    const statusMap: Partial<Record<NormalizedEventType, TransactionStatus>> = {
      [NormalizedEventType.PAYMENT_SUCCEEDED]: TransactionStatus.SUCCESSFUL,
      [NormalizedEventType.PAYMENT_FAILED]: TransactionStatus.FAILED,
      [NormalizedEventType.PAYMENT_ABANDONED]: TransactionStatus.ABANDONED,
      [NormalizedEventType.REFUND_COMPLETED]: TransactionStatus.REFUNDED,
      [NormalizedEventType.DISPUTE_CREATED]: TransactionStatus.DISPUTED,
      [NormalizedEventType.DISPUTE_RESOLVED]: TransactionStatus.SUCCESSFUL,
    };

    return statusMap[eventType] || null;
  }

  /**
   * Helper: Get event type for a state transition
   */
  private getEventTypeForTransition(
    fromStatus: TransactionStatus | null,
    toStatus: TransactionStatus,
  ): NormalizedEventType | null {
    // Map transitions to events
    if (toStatus === TransactionStatus.SUCCESSFUL) {
      return NormalizedEventType.PAYMENT_SUCCEEDED;
    }
    if (toStatus === TransactionStatus.FAILED) {
      return NormalizedEventType.PAYMENT_FAILED;
    }
    if (toStatus === TransactionStatus.REFUNDED) {
      return NormalizedEventType.REFUND_COMPLETED;
    }
    if (toStatus === TransactionStatus.DISPUTED) {
      return NormalizedEventType.DISPUTE_CREATED;
    }
    // Add more mappings as needed
    return null;
  }

  /**
   * Helper: Get audit logs with filtering
   */
  private async getAuditLogs(query: {
    transactionId: string;
    performedAfter?: Date;
    performedBefore?: Date;
  }): Promise<AuditLog[]> {
    const logs = await this.storageAdapter.getAuditLogs(query.transactionId);

    // Filter by date if specified
    return logs.filter((log) => {
      if (query.performedAfter && log.performedAt < query.performedAfter) {
        return false;
      }
      if (query.performedBefore && log.performedAt > query.performedBefore) {
        return false;
      }
      return true;
    });
  }
}
