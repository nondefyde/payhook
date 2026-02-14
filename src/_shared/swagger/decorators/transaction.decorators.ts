import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { TransactionStatus } from '../../../core/domain/enums';

/**
 * Swagger decorator for creating transactions
 */
export const ApiCreateTransaction = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Create a new transaction',
      description:
        'Creates a new transaction in PENDING state before payment provider handoff',
    }),
    ApiBody({
      description: 'Transaction creation data',
      schema: {
        type: 'object',
        required: ['applicationRef', 'provider', 'amount', 'currency'],
        properties: {
          applicationRef: {
            type: 'string',
            example: 'order_123',
            description: 'Unique reference from your application',
          },
          provider: {
            type: 'string',
            example: 'paystack',
            description: 'Payment provider to use',
          },
          amount: {
            type: 'number',
            example: 10000,
            description: 'Amount in smallest currency unit (e.g., kobo, cents)',
          },
          currency: {
            type: 'string',
            example: 'NGN',
            description: 'ISO 4217 currency code',
          },
          metadata: {
            type: 'object',
            description: 'Additional metadata to store with transaction',
          },
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
};

/**
 * Swagger decorator for getting transaction with options
 */
export const ApiGetTransaction = (options?: {
  byApplicationRef?: boolean;
  byProviderRef?: boolean;
  auditTrailOnly?: boolean;
  webhooksOnly?: boolean;
  settledCheck?: boolean;
}) => {
  // Determine operation summary based on options
  let summary = 'Get transaction by ID';
  let description =
    'Retrieves transaction details with optional verification and related data';

  if (options?.byApplicationRef) {
    summary = 'Get transaction by application reference';
    description = 'Retrieves transaction using your application reference';
  } else if (options?.byProviderRef) {
    summary = 'Get transaction by provider reference';
    description = 'Retrieves transaction using payment provider reference';
  } else if (options?.auditTrailOnly) {
    summary = 'Get transaction audit trail';
    description = 'Retrieves complete audit history for a transaction';
  } else if (options?.webhooksOnly) {
    summary = 'Get transaction webhooks';
    description = 'Retrieves all webhook logs associated with a transaction';
  } else if (options?.settledCheck) {
    summary = 'Check if transaction is settled';
    description = 'Checks if a transaction has reached a terminal state';
  }

  const decorators = [
    ApiOperation({ summary, description }),
    ApiResponse({
      status: 200,
      description: 'Request successful',
    }),
    ApiResponse({
      status: 404,
      description: 'Transaction not found',
    }),
  ];

  // Add specific parameters based on options
  if (!options?.byApplicationRef && !options?.byProviderRef) {
    decorators.push(
      ApiParam({
        name: 'id',
        description: 'Transaction ID (UUID)',
        example: '550e8400-e29b-41d4-a716-446655440000',
      }),
    );
  }

  if (options?.byApplicationRef) {
    decorators.push(
      ApiParam({
        name: 'applicationRef',
        description: 'Application reference',
        example: 'order_123',
      }),
    );
  }

  if (options?.byProviderRef) {
    decorators.push(
      ApiParam({
        name: 'provider',
        description: 'Payment provider name',
        example: 'paystack',
      }),
      ApiParam({
        name: 'providerRef',
        description: 'Provider reference ID',
        example: 'ps_ref_123',
      }),
    );
  }

  // Add query parameters for standard transaction get
  if (
    !options?.auditTrailOnly &&
    !options?.webhooksOnly &&
    !options?.settledCheck
  ) {
    decorators.push(
      ApiQuery({
        name: 'verify',
        required: false,
        type: 'boolean',
        description: 'Verify transaction status with payment provider API',
      }),
      ApiQuery({
        name: 'includeWebhooks',
        required: false,
        type: 'boolean',
        description: 'Include associated webhook logs in response',
      }),
      ApiQuery({
        name: 'includeAuditTrail',
        required: false,
        type: 'boolean',
        description: 'Include complete audit trail in response',
      }),
    );
  }

  return applyDecorators(...decorators);
};

/**
 * Swagger decorator for marking transaction as processing
 */
export const ApiMarkAsProcessing = () => {
  return applyDecorators(
    ApiOperation({
      summary: 'Mark transaction as processing',
      description:
        'Updates transaction to PROCESSING state after successful provider handoff',
    }),
    ApiParam({
      name: 'id',
      description: 'Transaction ID',
    }),
    ApiBody({
      schema: {
        type: 'object',
        required: ['providerRef'],
        properties: {
          providerRef: {
            type: 'string',
            example: 'ps_ref_123',
            description: 'Reference ID from payment provider',
          },
          verificationMethod: {
            type: 'string',
            enum: ['WEBHOOK_ONLY', 'WEBHOOK_AND_API'],
            description: 'How transaction will be verified',
          },
          performedBy: {
            type: 'string',
            example: 'user@example.com',
            description: 'Who performed this action',
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Transaction marked as processing',
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid state transition',
    }),
    ApiResponse({
      status: 404,
      description: 'Transaction not found',
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
