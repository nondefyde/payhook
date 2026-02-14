import {
  Controller,
  Param,
  Body,
  Headers,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhookEndpoint } from '../decorators/webhook.decorators';
import { WebhookProcessor, ProcessingResult } from '../../../core';

/**
 * Clean Webhook Controller
 * Using custom decorators for cleaner code
 */
@ApiTags('Webhooks')
@Controller()
export class CleanWebhookController {
  private readonly logger = new Logger(CleanWebhookController.name);

  constructor(
    @Inject(WebhookProcessor)
    private readonly webhookProcessor: WebhookProcessor,
    @Inject('PAYHOOK_CONFIG')
    private readonly config: any,
  ) {}

  @WebhookEndpoint('Receive and process payment provider webhook')
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() rawBody: Buffer,
    @Headers() headers: Record<string, string>,
  ): Promise<{ success: boolean; message: string; details?: any }> {
    this.logger.log(`Received webhook from provider: ${provider}`);

    try {
      if (!provider) {
        throw new BadRequestException('Provider name is required');
      }

      if (!rawBody || rawBody.length === 0) {
        throw new BadRequestException('Webhook body is required');
      }

      const result = await this.webhookProcessor.processWebhook(
        provider.toLowerCase(),
        rawBody,
        headers,
      );

      if (result.success) {
        this.logger.log(`Webhook processed successfully: ${result.webhookLogId}`);
      } else {
        this.logger.warn(`Webhook processing failed: ${result.error?.message}`);
      }

      return this.formatResponse(result);
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error}`, error);

      return {
        success: false,
        message: 'Webhook processing failed',
        details: this.config.debug
          ? { error: error instanceof Error ? error.message : String(error) }
          : undefined,
      };
    }
  }

  private formatResponse(result: ProcessingResult): {
    success: boolean;
    message: string;
    details?: any;
  } {
    const response = {
      success: result.success,
      message: result.success
        ? 'Webhook processed successfully'
        : 'Webhook processing completed with errors',
      details: undefined as any,
    };

    if (this.config.debug) {
      response.details = {
        webhookLogId: result.webhookLogId,
        transactionId: result.transactionId,
        processingStatus: result.processingStatus,
        metrics: {
          totalDurationMs: result.metrics.totalDurationMs,
          signatureVerified: result.metrics.signatureVerified,
          normalized: result.metrics.normalized,
          persisted: result.metrics.persisted,
        },
        error: result.error
          ? { message: result.error.message, type: result.error.name }
          : undefined,
      };
    }

    return response;
  }
}