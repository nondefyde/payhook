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
import {
  ApiWebhookEndpoint,
  ApiCustomWebhookEndpoint
} from '../../../_shared/swagger/decorators';
import { WebhookResponseDto } from '../../../_shared/dto';

/**
 * Clean Webhook Controller
 * Using shared Swagger decorators for cleaner code and better maintainability
 */
@ApiTags('Webhooks')
@Controller('webhooks')
export class CleanWebhookController {
  private readonly logger = new Logger(CleanWebhookController.name);

  constructor(
    @Inject(WebhookProcessor)
    private readonly webhookProcessor: WebhookProcessor,
    @Inject('PAYHOOK_CONFIG')
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
          ? {
              error: {
                message: error instanceof Error ? error.message : String(error),
                type: error instanceof Error ? error.name : 'Unknown'
              }
            }
          : undefined,
      };
    }
  }

  /**
   * Receive webhook with custom endpoint path
   */
  @Post('custom/:customPath/:provider')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(RawBodyInterceptor)
  @ApiCustomWebhookEndpoint()
  async handleCustomWebhook(
    @Param('customPath') customPath: string,
    @Param('provider') provider: string,
    @Body() rawBody: Buffer,
    @Headers() headers: Record<string, string>,
  ): Promise<WebhookResponseDto> {
    this.logger.log(
      `Received webhook at custom path: ${customPath}/${provider}`,
    );

    // Delegate to main handler
    return this.handleWebhook(provider, rawBody, headers);
  }

  private formatResponse(result: ProcessingResult): WebhookResponseDto {
    const response: WebhookResponseDto = {
      success: result.success,
      message: result.success
        ? 'Webhook processed successfully'
        : 'Webhook processing completed with errors',
    };

    if (this.config.debug) {
      response.details = {
        webhookLogId: result.webhookLogId,
        transactionId: result.transactionId,
        processingStatus: result.processingStatus,
        metrics: result.metrics ? {
          totalDurationMs: result.metrics.totalDurationMs,
          signatureVerified: result.metrics.signatureVerified,
          normalized: result.metrics.normalized,
          persisted: result.metrics.persisted,
        } : undefined,
        error: result.error
          ? { message: result.error.message, type: result.error.name }
          : undefined,
      };
    }

    return response;
  }
}