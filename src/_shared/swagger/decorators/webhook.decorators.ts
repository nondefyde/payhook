import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiParam, ApiBody, ApiHeader } from '@nestjs/swagger';

/**
 * Swagger decorator for webhook endpoints
 */
export const ApiWebhookEndpoint = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Receive payment webhook',
      description:
        'Receives webhooks from payment providers. Validates signature, normalizes event, updates transaction state. Always returns 200 OK with a claimFate to prevent provider retries.',
    }),
    ApiParam({
      name: 'provider',
      description:
        'Payment provider name (e.g., paystack, stripe, flutterwave)',
      example: 'paystack',
      required: true,
      schema: {
        type: 'string',
        enum: ['paystack', 'stripe', 'flutterwave'],
      },
    }),
    ApiHeader({
      name: 'x-paystack-signature',
      description: 'HMAC-SHA512 signature for Paystack webhooks',
      required: false,
      example: 'd47c2b6f3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7',
    }),
    ApiHeader({
      name: 'stripe-signature',
      description: 'Signature for Stripe webhooks',
      required: false,
      example: 't=1614556800,v1=5257a869e7ecf1234...',
    }),
    ApiHeader({
      name: 'verif-hash',
      description: 'Signature for Flutterwave webhooks',
      required: false,
      example: 'sha256hash1234567890',
    }),
    ApiBody({
      description: 'Raw webhook payload from payment provider',
      required: true,
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'Provider-specific webhook payload. Structure varies by provider.',
        example: {
          event: 'charge.success',
          data: {
            id: 902961584,
            status: 'success',
            reference: 'ref_123',
            amount: 10000,
            currency: 'NGN',
            metadata: {
              applicationRef: 'order_123',
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Webhook processed and assigned a fate',
      schema: {
        type: 'object',
        required: ['claimFate'],
        properties: {
          claimFate: {
            type: 'string',
            enum: [
              'processed',
              'duplicate',
              'unmatched',
              'signature_failed',
              'normalization_failed',
              'transition_rejected',
              'parse_error',
            ],
            description: 'The fate assigned to this webhook claim',
            example: 'processed',
          },
          provider: {
            type: 'string',
            description: 'Provider that sent the webhook',
            example: 'paystack',
          },
          eventType: {
            type: 'string',
            description: 'Event type extracted from webhook',
            example: 'charge.success',
          },
          transactionId: {
            type: 'string',
            format: 'uuid',
            description: 'Transaction ID if webhook was matched',
            example: '550e8400-e29b-41d4-a716-446655440000',
          },
          webhookLogId: {
            type: 'string',
            description: 'Webhook log ID for audit trail',
            example: 'wh_log_123',
          },
          message: {
            type: 'string',
            description: 'Human-readable processing message',
            example: 'Webhook processed and state transition applied',
          },
        },
      },
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
      description: 'Webhook acknowledged with fate',
      schema: {
        type: 'object',
        properties: {
          claimFate: {
            type: 'string',
            enum: [
              'processed',
              'duplicate',
              'unmatched',
              'signature_failed',
              'normalization_failed',
              'transition_rejected',
            ],
          },
          provider: { type: 'string' },
          eventType: { type: 'string' },
          transactionId: { type: 'string', format: 'uuid', nullable: true },
          webhookLogId: { type: 'string' },
          message: { type: 'string' },
        },
      },
    }),
  );
};