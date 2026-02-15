import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseInterceptors,
  Inject,
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RawBodyInterceptor } from '../interceptors/raw-body.interceptor';
import { WebhookProcessor, ProcessingResult } from '../../../core';
import { ApiWebhookEndpoint } from '../../../_shared';
import { WebhookResponseDto } from '../../../_shared';
import { WEBHOOK_PROCESSOR, PAYHOOK_CONFIG } from '../constants';

/**
 * Webhook Controller
 *
 * Essential HTTP endpoint for receiving webhooks from payment providers.
 * This MUST be HTTP because external providers need to POST to it.
 */
@ApiTags('Ingest')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(WEBHOOK_PROCESSOR)
    private readonly webhookProcessor: WebhookProcessor,
    @Inject(PAYHOOK_CONFIG)
    private readonly config: any,
  ) {}

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(RawBodyInterceptor)
  @ApiWebhookEndpoint()
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() rawBody: Buffer,
    @Headers() headers: Record<string, string>,
  ): Promise<WebhookResponseDto> {
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
        this.logger.log(
          `Webhook processed successfully: ${result.webhookLogId}`,
        );
      } else {
        this.logger.warn(`Webhook processing failed: ${result.error?.message}`);
      }

      return this.formatResponse(result);
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error}`, error);

      // Even errors get logged and return 200 with a fate
      // Only return 400 for truly unparseable requests
      if (error instanceof BadRequestException && error.message.includes('body is required')) {
        throw error; // Let NestJS handle this as 400
      }

      // All other errors get a fate and 200 response
      return {
        claimFate: 'parse_error',
        provider: provider.toLowerCase(),
        message: 'Webhook could not be processed but was logged',
        webhookLogId: undefined, // May not have been created
      };
    }
  }

  private formatResponse(result: ProcessingResult): WebhookResponseDto {
    // Map processing status to claim fate
    const fateMap: Record<string, string> = {
      PROCESSED: 'processed',
      DUPLICATE: 'duplicate',
      UNMATCHED: 'unmatched',
      SIGNATURE_FAILED: 'signature_failed',
      NORMALIZATION_FAILED: 'normalization_failed',
      TRANSITION_REJECTED: 'transition_rejected',
      PARSE_ERROR: 'parse_error',
    };

    const claimFate = fateMap[result.processingStatus] || 'unknown';

    return {
      claimFate,
      provider: result.context?.provider,
      eventType: result.context?.metadata?.eventType,
      transactionId: result.transactionId,
      webhookLogId: result.webhookLogId,
      message: this.getMessageForFate(claimFate),
    };
  }

  private getMessageForFate(fate: string): string {
    const messages: Record<string, string> = {
      processed: 'Webhook processed and state transition applied',
      duplicate: 'Duplicate webhook detected and skipped',
      unmatched: 'Webhook logged but no matching transaction found',
      signature_failed: 'Webhook signature verification failed',
      normalization_failed: 'Webhook could not be normalized to expected format',
      transition_rejected: 'State transition rejected by state machine',
      parse_error: 'Webhook payload could not be parsed',
      unknown: 'Webhook processing completed',
    };
    return messages[fate] || messages.unknown;
  }
}
