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
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RawBodyInterceptor } from '../interceptors/raw-body.interceptor';
import { WebhookProcessor, ProcessingResult } from '../../../core';

/**
 * Webhook Controller
 *
 * Handles incoming webhooks from payment providers
 */
@ApiTags('Webhooks')
@Controller()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(WebhookProcessor)
    private readonly webhookProcessor: WebhookProcessor,
    @Inject('PAYHOOK_CONFIG')
    private readonly config: any,
  ) {}

  /**
   * Receive webhook from payment provider
   */
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(RawBodyInterceptor)
  @ApiOperation({ summary: 'Receive webhook from payment provider' })
  @ApiParam({
    name: 'provider',
    description: 'Payment provider name (e.g., paystack, stripe)',
    example: 'paystack',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid webhook or processing error',
  })
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() rawBody: Buffer,
    @Headers() headers: Record<string, string>,
  ): Promise<{ success: boolean; message: string; details?: any }> {
    this.logger.log(`Received webhook from provider: ${provider}`);

    try {
      // Validate provider
      if (!provider) {
        throw new BadRequestException('Provider name is required');
      }

      // Validate body
      if (!rawBody || rawBody.length === 0) {
        throw new BadRequestException('Webhook body is required');
      }

      // Process webhook
      const result = await this.webhookProcessor.processWebhook(
        provider.toLowerCase(),
        rawBody,
        headers,
      );

      // Log result
      if (result.success) {
        this.logger.log(
          `Webhook processed successfully: ${result.webhookLogId}`,
        );
      } else {
        this.logger.warn(`Webhook processing failed: ${result.error?.message}`);
      }

      // Return response
      return this.formatResponse(result);
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error}`, error);

      // Return error response (but still 200 OK to prevent retries)
      return {
        success: false,
        message: 'Webhook processing failed',
        details: this.config.debug
          ? {
              error: error instanceof Error ? error.message : String(error),
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
  @ApiOperation({ summary: 'Receive webhook with custom path' })
  @ApiParam({
    name: 'customPath',
    description: 'Custom path segment',
  })
  @ApiParam({
    name: 'provider',
    description: 'Payment provider name',
  })
  async handleCustomWebhook(
    @Param('customPath') customPath: string,
    @Param('provider') provider: string,
    @Body() rawBody: Buffer,
    @Headers() headers: Record<string, string>,
  ): Promise<{ success: boolean; message: string; details?: any }> {
    this.logger.log(
      `Received webhook at custom path: ${customPath}/${provider}`,
    );

    // Delegate to main handler
    return this.handleWebhook(provider, rawBody, headers);
  }

  /**
   * Format processing result for response
   */
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

    // Add details in debug mode
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
          ? {
              message: result.error.message,
              type: result.error.name,
            }
          : undefined,
      };
    }

    return response;
  }
}
