import { applyDecorators, Post, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { RawBodyInterceptor } from '../interceptors/raw-body.interceptor';

/**
 * Webhook endpoint decorator
 * Combines multiple decorators for cleaner webhook endpoints
 */
export function WebhookEndpoint(description: string = 'Receive webhook') {
  return applyDecorators(
    Post(':provider'),
    HttpCode(HttpStatus.OK),
    UseInterceptors(RawBodyInterceptor),
    ApiOperation({ summary: description }),
    ApiParam({
      name: 'provider',
      description: 'Payment provider name (e.g., paystack, stripe)',
      example: 'paystack',
    }),
    ApiResponse({
      status: 200,
      description: 'Webhook processed successfully',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          details: { type: 'object' },
        },
      },
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid webhook or processing error',
    }),
  );
}

/**
 * Transaction query endpoint decorator
 */
export function TransactionQuery() {
  return applyDecorators(
    ApiQuery({
      name: 'verify',
      required: false,
      type: 'boolean',
      description: 'Verify with provider API',
    }),
    ApiQuery({
      name: 'includeWebhooks',
      required: false,
      type: 'boolean',
      description: 'Include webhook logs',
    }),
    ApiQuery({
      name: 'includeAuditTrail',
      required: false,
      type: 'boolean',
      description: 'Include audit trail',
    }),
  );
}

/**
 * List pagination decorator
 */
export function PaginatedQuery() {
  return applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      type: 'number',
      description: 'Number of results to return',
      example: 100,
    }),
    ApiQuery({
      name: 'offset',
      required: false,
      type: 'number',
      description: 'Number of results to skip',
      example: 0,
    }),
  );
}

/**
 * Transaction creation decorator
 */
export function CreateTransactionDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Create a new transaction' }),
    ApiBody({
      description: 'Transaction creation data',
      schema: {
        type: 'object',
        required: ['applicationRef', 'provider', 'amount', 'currency'],
        properties: {
          applicationRef: { type: 'string', example: 'order_123' },
          provider: { type: 'string', example: 'paystack' },
          amount: { type: 'number', example: 10000 },
          currency: { type: 'string', example: 'NGN' },
          metadata: { type: 'object' },
        },
      },
    }),
    ApiResponse({
      status: 201,
      description: 'Transaction created successfully',
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid input or duplicate application reference',
    }),
  );
}

/**
 * Mark as processing decorator
 */
export function MarkAsProcessingDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Mark transaction as processing' }),
    ApiParam({
      name: 'id',
      description: 'Transaction ID',
      type: 'string',
    }),
    ApiBody({
      schema: {
        type: 'object',
        required: ['providerRef'],
        properties: {
          providerRef: { type: 'string', example: 'ps_ref_123' },
          verificationMethod: {
            type: 'string',
            enum: ['WEBHOOK_ONLY', 'WEBHOOK_AND_API']
          },
          performedBy: { type: 'string', example: 'user@example.com' },
        },
      },
    }),
  );
}

/**
 * Reconciliation decorator
 */
export function ReconciliationDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Reconcile transaction with provider API' }),
    ApiParam({
      name: 'id',
      description: 'Transaction ID',
      type: 'string',
    }),
    ApiBody({
      schema: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: 'Force status update even if invalid transition'
          },
          updateStatus: {
            type: 'boolean',
            description: 'Update local status if diverged'
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Reconciliation completed',
    }),
    ApiResponse({
      status: 404,
      description: 'Transaction not found',
    }),
  );
}

/**
 * Health check decorator
 */
export function HealthCheckDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Basic health check' }),
    ApiResponse({
      status: 200,
      description: 'Service is healthy',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'healthy' },
          timestamp: { type: 'string', format: 'date-time' },
          uptime: { type: 'number' },
        },
      },
    }),
  );
}

/**
 * Statistics endpoint decorator
 */
export function StatisticsDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Get transaction statistics' }),
    ApiQuery({
      name: 'provider',
      required: false,
      type: 'string',
      description: 'Filter by provider',
    }),
    ApiResponse({
      status: 200,
      description: 'Statistics retrieved successfully',
    }),
  );
}