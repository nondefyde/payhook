import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { TransactionStatus } from '../../../core/domain/enums';
import { TransactionResponseDto } from '../../dto';

/**
 * Swagger decorator for creating transactions
 */
export const ApiCreateTransaction = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Create new transaction',
      description:
        'Initializes a new transaction in PENDING state before redirecting to payment provider',
    }),
    ApiResponse({
      status: 201,
      description: 'Transaction created successfully',
      type: TransactionResponseDto,
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid request data or duplicate application reference',
    }),
  );
};

/**
 * Swagger decorator for getting transaction by application reference
 */
export const ApiGetTransactionByAppRef = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Get transaction by application reference',
      description:
        'The "did money come in?" query - returns transaction status and settlement info',
    }),
    ApiParam({
      name: 'applicationRef',
      description: 'Your application reference',
      example: 'order_123',
    }),
    ApiQuery({
      name: 'verify',
      required: false,
      type: 'boolean',
      description: 'Call provider API to verify current status. Upgrades verificationMethod if confirmed.',
      schema: { type: 'boolean', default: false },
    }),
    ApiResponse({
      status: 200,
      description: 'Transaction found',
      type: TransactionResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: 'Transaction not found',
    }),
  );
};

/**
 * Swagger decorator for marking transaction as processing
 */
export const ApiMarkAsProcessing = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Mark transaction as processing',
      description:
        'Updates transaction to PROCESSING state and links provider reference after redirect',
    }),
    ApiParam({
      name: 'id',
      description: 'Transaction ID',
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
    ApiResponse({
      status: 200,
      description: 'Transaction updated successfully',
      type: TransactionResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: 'Transaction not found',
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid state transition',
    }),
  );
};

/**
 * Swagger decorator for reconciliation endpoint
 */
export const ApiReconcileTransaction = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Reconcile transaction with provider API',
      description:
        'Verifies transaction status with payment provider and updates local state if diverged',
    }),
    ApiParam({
      name: 'id',
      description: 'Transaction ID',
    }),
    ApiBody({
      schema: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: 'Force status update even if transition is invalid',
            default: false,
          },
          updateStatus: {
            type: 'boolean',
            description: 'Update local status if diverged from provider',
            default: false,
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Reconciliation completed',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          diverged: { type: 'boolean' },
          localStatus: { type: 'string' },
          providerStatus: { type: 'string' },
          corrected: { type: 'boolean' },
          newStatus: { type: 'string' },
        },
      },
    }),
  );
};

/**
 * Swagger decorator for listing transactions
 */
export const ApiListTransactions = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'List transactions',
      description:
        'Retrieves paginated list of transactions with optional filters',
    }),
    ApiQuery({
      name: 'status',
      required: false,
      enum: TransactionStatus,
      description: 'Filter by transaction status',
    }),
    ApiQuery({
      name: 'provider',
      required: false,
      type: 'string',
      description: 'Filter by payment provider',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: 'number',
      description: 'Number of results per page',
      default: 100,
    }),
    ApiQuery({
      name: 'offset',
      required: false,
      type: 'number',
      description: 'Number of results to skip',
      default: 0,
    }),
    ApiResponse({
      status: 200,
      description: 'Transactions retrieved successfully',
      schema: {
        type: 'object',
        properties: {
          transactions: { type: 'array' },
          total: { type: 'number' },
          hasMore: { type: 'boolean' },
        },
      },
    }),
  );
};

/**
 * Swagger decorator for stale transaction scanning
 */
export const ApiScanStaleTransactions = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Find stale transactions that need reconciliation',
      description:
        'Identifies transactions stuck in PROCESSING state for extended periods',
    }),
    ApiQuery({
      name: 'staleAfterMinutes',
      required: false,
      type: 'number',
      description: 'Minutes after which a transaction is considered stale',
      default: 60,
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: 'number',
      description: 'Maximum number of results to return',
      default: 100,
    }),
    ApiResponse({
      status: 200,
      description: 'Stale transactions found',
    }),
  );
};

/**
 * Swagger decorator for transaction statistics
 */
export const ApiTransactionStatistics = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Get transaction statistics',
      description: 'Retrieves aggregated statistics about transactions',
    }),
    ApiQuery({
      name: 'provider',
      required: false,
      type: 'string',
      description: 'Filter statistics by provider',
    }),
    ApiResponse({
      status: 200,
      description: 'Statistics retrieved successfully',
      schema: {
        type: 'object',
        properties: {
          total: { type: 'number' },
          byStatus: { type: 'object' },
          byProvider: { type: 'object' },
          totalAmount: { type: 'object' },
        },
      },
    }),
  );
};
