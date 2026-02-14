import { Injectable, Inject, Logger } from '@nestjs/common';
import type {
  TransactionService,
  WebhookProcessor,
  StorageAdapter,
  EventDispatcher,
  Transaction,
  CreateTransactionDto,
  ProcessingResult,
} from '../../../core';
import { TransactionStatus } from '../../../core';
import {
  TRANSACTION_SERVICE,
  WEBHOOK_PROCESSOR,
  STORAGE_ADAPTER,
  EVENT_DISPATCHER,
} from '../constants';

/**
 * PayHookService
 *
 * Main service providing high-level PayHook operations
 */
@Injectable()
export class PayHookService {
  private readonly logger = new Logger(PayHookService.name);

  constructor(
    @Inject(TRANSACTION_SERVICE)
    private readonly transactionService: TransactionService,
    @Inject(WEBHOOK_PROCESSOR)
    private readonly webhookProcessor: WebhookProcessor,
    @Inject(STORAGE_ADAPTER)
    private readonly storageAdapter: StorageAdapter,
    @Inject(EVENT_DISPATCHER)
    private readonly eventDispatcher: EventDispatcher,
  ) {}

  /**
   * Create a new transaction
   */
  async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
    return this.transactionService.createTransaction(dto);
  }

  /**
   * Process an incoming webhook
   */
  async processWebhook(
    provider: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ProcessingResult> {
    return this.webhookProcessor.processWebhook(provider, rawBody, headers);
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(
    id: string,
    options?: {
      verify?: boolean;
      includeWebhooks?: boolean;
      includeAuditTrail?: boolean;
    },
  ): Promise<Transaction | null> {
    return this.transactionService.getTransaction(id, options);
  }

  /**
   * Reconcile transactions with provider
   */
  async reconcileTransactions(
    provider?: string,
    limit: number = 100,
  ): Promise<{
    total: number;
    reconciled: number;
    diverged: number;
    failed: number;
    results: Array<{
      transactionId: string;
      status: 'success' | 'diverged' | 'failed';
      details?: any;
    }>;
  }> {
    const results: Array<{
      transactionId: string;
      status: 'success' | 'diverged' | 'failed';
      details?: any;
    }> = [];

    let reconciled = 0;
    let diverged = 0;
    let failed = 0;

    // Find stale transactions
    const staleTransactions =
      await this.transactionService.scanStaleTransactions({
        staleAfterMinutes: 60,
        limit,
        provider,
      });

    this.logger.log(
      `Found ${staleTransactions.length} stale transactions to reconcile`,
    );

    // Reconcile each transaction
    for (const transaction of staleTransactions) {
      try {
        const result = await this.transactionService.reconcile(transaction.id, {
          updateStatus: true,
        });

        if (result.success) {
          if (result.diverged) {
            diverged++;
            results.push({
              transactionId: transaction.id,
              status: 'diverged',
              details: result,
            });
          } else {
            reconciled++;
            results.push({
              transactionId: transaction.id,
              status: 'success',
              details: result,
            });
          }
        } else {
          failed++;
          results.push({
            transactionId: transaction.id,
            status: 'failed',
            details: result,
          });
        }
      } catch (error) {
        failed++;
        results.push({
          transactionId: transaction.id,
          status: 'failed',
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return {
      total: staleTransactions.length,
      reconciled,
      diverged,
      failed,
      results,
    };
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<{
    transactions: {
      total: number;
      byStatus: Record<TransactionStatus, number>;
      recentSuccessRate: number;
    };
    webhooks: {
      total: number;
      processed: number;
      failed: number;
      duplicates: number;
      unmatched: number;
    };
    providers: Record<
      string,
      {
        total: number;
        successful: number;
        failed: number;
      }
    >;
    health: {
      database: boolean;
      lastWebhook?: Date;
      processingRate?: number;
    };
  }> {
    // Get transaction stats
    const transactionStats = await this.transactionService.getStatistics();

    // Get webhook stats from storage
    const webhookStats = await this.storageAdapter.getStatistics();

    // Calculate success rate
    const totalProcessed =
      (transactionStats.byStatus[TransactionStatus.SUCCESSFUL] || 0) +
      (transactionStats.byStatus[TransactionStatus.FAILED] || 0);
    const successRate =
      totalProcessed > 0
        ? (transactionStats.byStatus[TransactionStatus.SUCCESSFUL] || 0) /
          totalProcessed
        : 0;

    // Get provider breakdown
    const providers: Record<string, any> = {};
    for (const [provider, count] of Object.entries(
      transactionStats.byProvider,
    )) {
      providers[provider] = {
        total: count,
        successful: 0, // Would need more detailed stats
        failed: 0,
      };
    }

    // Check health
    const isHealthy = await this.storageAdapter.isHealthy();

    return {
      transactions: {
        total: transactionStats.total,
        byStatus: transactionStats.byStatus,
        recentSuccessRate: successRate,
      },
      webhooks: {
        total: webhookStats.webhookLogCount,
        processed: webhookStats.webhookLogCount, // Would need more detail
        failed: 0, // Would need to query by status
        duplicates: 0,
        unmatched: 0,
      },
      providers,
      health: {
        database: isHealthy,
        lastWebhook: undefined, // Would need to track this
        processingRate: undefined,
      },
    };
  }

  /**
   * Register event handler
   */
  registerEventHandler(
    eventType: string,
    handler: (eventType: string, payload: any) => Promise<void>,
  ): void {
    this.eventDispatcher.on(eventType, handler);
  }

  /**
   * Replay webhooks for a transaction
   */
  async replayWebhooks(
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
    const webhooks =
      await this.transactionService.getTransactionWebhooks(transactionId);

    let filtered = webhooks;

    // Apply filters
    if (options?.fromDate) {
      filtered = filtered.filter((w) => w.receivedAt >= options.fromDate!);
    }
    if (options?.toDate) {
      filtered = filtered.filter((w) => w.receivedAt <= options.toDate!);
    }
    if (options?.eventTypes && options.eventTypes.length > 0) {
      filtered = filtered.filter((w) =>
        options.eventTypes!.includes(w.eventType),
      );
    }

    let replayed = 0;
    let failed = 0;

    for (const webhook of filtered) {
      try {
        if (webhook.rawPayload) {
          // Convert rawPayload to Buffer for re-processing
          const rawBody = Buffer.from(JSON.stringify(webhook.rawPayload));

          // Re-process the webhook
          await this.webhookProcessor.processWebhook(
            webhook.provider,
            rawBody,
            webhook.headers,
          );
          replayed++;
        } else {
          failed++;
          this.logger.warn(
            `Cannot replay webhook ${webhook.id}: no raw payload stored`,
          );
        }
      } catch (error) {
        failed++;
        this.logger.error(`Failed to replay webhook ${webhook.id}:`, error);
      }
    }

    return {
      total: filtered.length,
      replayed,
      failed,
    };
  }

  /**
   * Clean up old data
   */
  async cleanupOldData(options: {
    olderThanDays: number;
    keepAuditLogs?: boolean;
    dryRun?: boolean;
  }): Promise<{
    webhooksDeleted: number;
    dispatchLogsDeleted: number;
    auditLogsDeleted: number;
  }> {
    // This would need to be implemented in StorageAdapter
    this.logger.warn('Cleanup not yet implemented');

    return {
      webhooksDeleted: 0,
      dispatchLogsDeleted: 0,
      auditLogsDeleted: 0,
    };
  }
}
