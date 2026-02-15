import {
  PipelineStage,
  WebhookContext,
  StageResult,
  SignatureVerificationError,
} from '../types';
import { PaymentProviderAdapter, ProcessingStatus } from '../../../core';

/**
 * Stage 2: Signature Verification
 * Validates webhook authenticity using provider-specific signatures
 */
export class VerificationStage implements PipelineStage {
  name = 'verification';

  constructor(
    private readonly providerAdapters: Map<string, PaymentProviderAdapter>,
    private readonly secrets: Map<string, string[]>,
    private readonly skipVerification = false,
  ) {}

  async execute(context: WebhookContext): Promise<StageResult> {
    const startTime = Date.now();

    try {
      // Skip verification if configured (DANGEROUS - only for testing)
      if (this.skipVerification) {
        context.signatureValid = true;
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

      // Get provider adapter
      const adapter = this.providerAdapters.get(context.provider);
      if (!adapter) {
        throw new SignatureVerificationError(
          `No adapter found for provider: ${context.provider}`,
          context.provider,
          context.headers,
        );
      }

      // Get secrets for this provider
      const secrets = this.secrets.get(context.provider) || [];
      if (secrets.length === 0) {
        throw new SignatureVerificationError(
          `No secrets configured for provider: ${context.provider}`,
          context.provider,
          context.headers,
        );
      }

      // Verify signature
      const isValid = adapter.verifySignature(
        context.rawBody,
        context.headers,
        secrets,
      );

      context.signatureValid = isValid;

      if (!isValid) {
        context.signatureError = 'Signature verification failed';
        context.processingStatus = ProcessingStatus.SIGNATURE_FAILED;

        // Continue pipeline to log the failure (per PRD: "Every claim has a fate")
        return {
          success: true, // Verification stage succeeded in classifying the webhook
          context,
          shouldContinue: true, // Continue to persist-claim stage to log the failure
          metadata: {
            signatureFailed: true,
            durationMs: Date.now() - startTime,
          },
        };
      }

      return {
        success: true,
        context,
        shouldContinue: true,
        metadata: {
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      context.signatureValid = false;
      context.signatureError =
        error instanceof Error ? error.message : 'Unknown error';
      context.processingStatus = ProcessingStatus.SIGNATURE_FAILED;

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
