import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';

/**
 * Swagger decorator for webhook endpoints
 */
export const ApiWebhookEndpoint = (provider?: string) => {
  return applyDecorators(
    ApiOperation({
      summary: provider
        ? `Receive webhook from ${provider} provider`
        : 'Receive webhook from payment provider',
      description:
        'Processes incoming payment provider webhooks, validates signatures, and updates transaction states',
    }),
    ApiParam({
      name: 'provider',
      description:
        'Payment provider name (e.g., paystack, stripe, flutterwave)',
      example: provider || 'paystack',
      required: true,
    }),
    ApiResponse({
      status: 200,
      description: 'Webhook processed successfully',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: {
            type: 'string',
            example: 'Webhook processed successfully',
          },
          details: {
            type: 'object',
            properties: {
              webhookLogId: { type: 'string' },
              transactionId: { type: 'string' },
              processingStatus: { type: 'string' },
              metrics: { type: 'object' },
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid webhook or processing error',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Webhook processing failed' },
          details: { type: 'object' },
        },
      },
    }),
  );
};

/**
 * Swagger decorator for custom webhook path
 */
export const ApiCustomWebhookEndpoint = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Receive webhook with custom path',
      description:
        'Handles webhooks at custom paths for specific provider configurations',
    }),
    ApiParam({
      name: 'customPath',
      description: 'Custom path segment for routing',
      example: 'secure',
    }),
    ApiParam({
      name: 'provider',
      description: 'Payment provider name',
      example: 'paystack',
    }),
    ApiResponse({
      status: 200,
      description: 'Webhook processed successfully',
    }),
  );
};

/**
 * Common webhook response documentation
 */
export const ApiWebhookResponse = () => {
  return applyDecorators(
    ApiResponse({
      status: 200,
      description: 'Webhook acknowledged',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          details: {
            type: 'object',
            nullable: true,
            description: 'Additional details (only in debug mode)',
          },
        },
      },
    }),
  );
};
