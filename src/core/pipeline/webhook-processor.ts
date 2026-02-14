import { v4 as uuidv4 } from 'uuid';
import {
  PipelineConfig,
  PipelineStage,
  WebhookContext,
  ProcessingResult,
  ProcessingMetrics,
  PipelineError,
} from './types';
import { VerificationStage } from './stages/verification.stage';
import { NormalizationStage } from './stages/normalization.stage';
import { PersistClaimStage } from './stages/persist-claim.stage';
import { DeduplicationStage } from './stages/deduplication.stage';
import { StateEngineStage } from './stages/state-engine.stage';
import { DispatchStage } from './stages/dispatch.stage';
import {
  ProcessingStatus,
  TransactionStateMachine,
  LifecycleHooks,
} from '../../core';

/**
 * WebhookProcessor orchestrates the 7-layer processing pipeline
 *
 * Pipeline stages:
 * 1. Inbound (implicit - capture raw body)
 * 2. Verification - Validate signature
 * 3. Normalization - Map to unified schema
 * 4. Persist Claim - Store webhook log
 * 5. Deduplication - Check idempotency
 * 6. State Engine - Apply transitions
 * 7. Dispatch - Emit events
 */
export class WebhookProcessor {
  private readonly stages: PipelineStage[];
  private readonly hooks?: LifecycleHooks;
  private readonly throwOnError: boolean;
  private readonly logErrors: boolean;
  private readonly timeoutMs: number;
  private readonly secrets: Map<string, string[]>;

  constructor(private readonly config: PipelineConfig) {
    this.hooks = config.hooks;
    this.throwOnError = config.throwOnError ?? false;
    this.logErrors = config.logErrors ?? true;
    this.timeoutMs = config.timeoutMs ?? 30000; // 30 seconds default

    // Extract secrets from config
    this.secrets = this.extractSecrets();

    // Initialize pipeline stages
    this.stages = this.initializeStages();
  }

  /**
   * Process a webhook through the pipeline
   */
  async processWebhook(
    provider: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const processingId = uuidv4();

    // Initialize context
    const context: WebhookContext = {
      provider,
      rawBody,
      headers: this.normalizeHeaders(headers),
      receivedAt: new Date(),
      processingId,
      startTime: new Date(),
      metadata: {},
    };

    const metrics: ProcessingMetrics = {
      totalDurationMs: 0,
      stageDurations: new Map(),
      signatureVerified: false,
      normalized: false,
      persisted: false,
      dispatched: false,
      transitionApplied: false,
    };

    try {
      // Execute pipeline with timeout
      const processingPromise = this.executePipeline(context, metrics);
      const timeoutPromise = this.createTimeout();

      const result = await Promise.race([processingPromise, timeoutPromise]);

      if (result === 'timeout') {
        throw new Error(`Pipeline timeout after ${this.timeoutMs}ms`);
      }

      // Set final processing duration
      context.processingDurationMs = Date.now() - startTime;
      metrics.totalDurationMs = context.processingDurationMs;

      // Build result
      const processingResult: ProcessingResult = {
        success: !context.error,
        webhookLogId: context.webhookLog?.id,
        transactionId: context.transaction?.id,
        processingStatus:
          context.processingStatus || ProcessingStatus.PROCESSED,
        error: context.error,
        context,
        metrics,
      };

      // Call webhook fate hook after processing
      if (this.hooks?.onWebhookFate) {
        await this.hooks.onWebhookFate({
          provider: context.provider,
          processingStatus:
            context.processingStatus || ProcessingStatus.PROCESSED,
          eventType: context.metadata?.eventType || 'unknown',
          latencyMs: context.processingDurationMs,
          transactionId: context.transaction?.id,
          error: context.error,
        });
      }

      return processingResult;
    } catch (error) {
      // Handle pipeline error
      context.error = error instanceof Error ? error : new Error(String(error));
      context.processingDurationMs = Date.now() - startTime;
      metrics.totalDurationMs = context.processingDurationMs;

      if (this.logErrors) {
        console.error(`Pipeline error for provider ${provider}:`, error);
      }

      // Error hook
      if (this.hooks?.onError) {
        await this.hooks.onError(context.error, {
          operation: 'webhook-processing',
          provider: context.provider,
          transactionId: context.transaction?.id,
          webhookLogId: context.webhookLog?.id,
          metadata: context.metadata,
        });
      }

      const errorResult: ProcessingResult = {
        success: false,
        webhookLogId: context.webhookLog?.id,
        transactionId: context.transaction?.id,
        processingStatus:
          context.processingStatus || ProcessingStatus.PARSE_ERROR,
        error: context.error,
        context,
        metrics,
      };

      if (this.throwOnError) {
        throw new PipelineError(
          `Pipeline failed: ${context.error.message}`,
          'pipeline',
          context,
          context.error,
        );
      }

      return errorResult;
    }
  }

  /**
   * Execute the pipeline stages sequentially
   */
  private async executePipeline(
    context: WebhookContext,
    metrics: ProcessingMetrics,
  ): Promise<void> {
    for (const stage of this.stages) {
      const stageStartTime = Date.now();

      try {
        // Execute stage
        const result = await stage.execute(context);

        // Record stage duration
        const stageDuration = Date.now() - stageStartTime;
        metrics.stageDurations.set(stage.name, stageDuration);

        // Update metrics based on stage
        this.updateMetrics(stage.name, result.success, metrics);

        // Update context from result
        context = result.context;

        // Check if we should continue
        if (!result.shouldContinue) {
          break;
        }

        // Check for errors
        if (!result.success && result.error) {
          throw result.error;
        }
      } catch (error) {
        // Record stage failure
        metrics.stageDurations.set(stage.name, Date.now() - stageStartTime);

        throw new PipelineError(
          `Stage '${stage.name}' failed: ${error instanceof Error ? error.message : String(error)}`,
          stage.name,
          context,
          error instanceof Error ? error : undefined,
        );
      }
    }
  }

  /**
   * Initialize pipeline stages based on configuration
   */
  private initializeStages(): PipelineStage[] {
    const stages: PipelineStage[] = [];

    // Stage 2: Verification (can be skipped for testing)
    stages.push(
      new VerificationStage(
        this.config.providerAdapters,
        this.secrets,
        this.config.skipSignatureVerification ?? false,
      ),
    );

    // Stage 3: Normalization
    stages.push(new NormalizationStage(this.config.providerAdapters));

    // Stage 4: Persist Claim
    stages.push(
      new PersistClaimStage(
        this.config.storageAdapter,
        this.config.storeRawPayload ?? true,
        this.config.redactKeys ?? [],
      ),
    );

    // Stage 5: Deduplication
    stages.push(
      new DeduplicationStage(
        this.config.storageAdapter,
        false, // Never skip deduplication in production
      ),
    );

    // Stage 6: State Engine
    if (this.config.stateMachine) {
      stages.push(
        new StateEngineStage(
          this.config.storageAdapter,
          this.config.stateMachine,
          false, // Don't auto-create transactions by default
        ),
      );
    }

    // Stage 7: Dispatch
    stages.push(
      new DispatchStage(
        this.config.eventDispatcher,
        this.config.storageAdapter,
        false, // Outbox pattern disabled by default
      ),
    );

    return stages;
  }

  /**
   * Extract secrets from configuration
   */
  private extractSecrets(): Map<string, string[]> {
    // Use secrets from config if provided
    if (this.config.secrets) {
      return this.config.secrets;
    }

    // Otherwise, return empty map (will fail signature verification)
    const secrets = new Map<string, string[]>();

    // Initialize empty arrays for each provider
    for (const [provider] of this.config.providerAdapters) {
      secrets.set(provider, []);
    }

    return secrets;
  }

  /**
   * Normalize headers to lowercase keys
   */
  private normalizeHeaders(
    headers: Record<string, string>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  /**
   * Update metrics based on stage completion
   */
  private updateMetrics(
    stageName: string,
    success: boolean,
    metrics: ProcessingMetrics,
  ): void {
    if (!success) return;

    switch (stageName) {
      case 'verification':
        metrics.signatureVerified = true;
        break;
      case 'normalization':
        metrics.normalized = true;
        break;
      case 'persist-claim':
        metrics.persisted = true;
        break;
      case 'state-engine':
        metrics.transitionApplied = true;
        break;
      case 'dispatch':
        metrics.dispatched = true;
        break;
    }
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(): Promise<string> {
    return new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), this.timeoutMs);
    });
  }

  /**
   * Get pipeline statistics
   */
  getStatistics(): {
    stages: string[];
    configuration: {
      skipVerification: boolean;
      storeRawPayload: boolean;
      useOutbox: boolean;
      timeoutMs: number;
    };
  } {
    return {
      stages: this.stages.map((s) => s.name),
      configuration: {
        skipVerification: this.config.skipSignatureVerification ?? false,
        storeRawPayload: this.config.storeRawPayload ?? true,
        useOutbox: false, // Not implemented yet
        timeoutMs: this.timeoutMs,
      },
    };
  }
}
