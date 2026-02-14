import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import {
  TransactionService,
  Transaction,
  TransactionStatus,
  AuditLog,
  WebhookLog,
  CreateTransactionDto,
  MarkAsProcessingDto,
} from '../../../core';

/**
 * Transaction Controller
 *
 * Query-first API for transaction management
 */
@ApiTags('Transactions')
@Controller('transactions')
export class TransactionController {
  private readonly logger = new Logger(TransactionController.name);

  constructor(
    @Inject(TransactionService)
    private readonly transactionService: TransactionService,
  ) {}

  /**
   * Create a new transaction
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new transaction' })
  @ApiBody({
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
  })
  async createTransaction(
    @Body() dto: CreateTransactionDto,
  ): Promise<Transaction> {
    this.logger.log(`Creating transaction: ${dto.applicationRef}`);

    try {
      const transaction = await this.transactionService.createTransaction(dto);

      this.logger.log(`Transaction created: ${transaction.id}`);
      return transaction;
    } catch (error) {
      this.logger.error(`Failed to create transaction: ${error}`);

      if (error instanceof Error && error.message.includes('unique')) {
        throw new BadRequestException(
          'Transaction with this application reference already exists',
        );
      }

      throw error;
    }
  }

  /**
   * Get transaction by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  @ApiQuery({
    name: 'verify',
    required: false,
    type: 'boolean',
    description: 'Verify with provider API',
  })
  @ApiQuery({
    name: 'includeWebhooks',
    required: false,
    type: 'boolean',
    description: 'Include webhook logs',
  })
  @ApiQuery({
    name: 'includeAuditTrail',
    required: false,
    type: 'boolean',
    description: 'Include audit trail',
  })
  async getTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('verify') verify?: boolean,
    @Query('includeWebhooks') includeWebhooks?: boolean,
    @Query('includeAuditTrail') includeAuditTrail?: boolean,
  ): Promise<Transaction> {
    const transaction = await this.transactionService.getTransaction(id, {
      verify: verify === true,
      includeWebhooks: includeWebhooks === true,
      includeAuditTrail: includeAuditTrail === true,
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction not found: ${id}`);
    }

    return transaction;
  }

  /**
   * Get transaction by application reference
   */
  @Get('application/:applicationRef')
  @ApiOperation({ summary: 'Get transaction by application reference' })
  async getByApplicationRef(
    @Param('applicationRef') applicationRef: string,
    @Query('verify') verify?: boolean,
  ): Promise<Transaction> {
    const transaction =
      await this.transactionService.getTransactionByApplicationRef(
        applicationRef,
        { verify: verify === true },
      );

    if (!transaction) {
      throw new NotFoundException(
        `Transaction not found with application ref: ${applicationRef}`,
      );
    }

    return transaction;
  }

  /**
   * Get transaction by provider reference
   */
  @Get('provider/:provider/:providerRef')
  @ApiOperation({ summary: 'Get transaction by provider reference' })
  async getByProviderRef(
    @Param('provider') provider: string,
    @Param('providerRef') providerRef: string,
  ): Promise<Transaction> {
    const transaction =
      await this.transactionService.getTransactionByProviderRef(
        provider,
        providerRef,
      );

    if (!transaction) {
      throw new NotFoundException(
        `Transaction not found with provider ref: ${provider}/${providerRef}`,
      );
    }

    return transaction;
  }

  /**
   * Mark transaction as processing
   */
  @Put(':id/processing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark transaction as processing' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['providerRef'],
      properties: {
        providerRef: { type: 'string', example: 'ps_ref_123' },
        verificationMethod: {
          type: 'string',
          enum: ['WEBHOOK_ONLY', 'WEBHOOK_AND_API'],
        },
        performedBy: { type: 'string', example: 'user@example.com' },
      },
    },
  })
  async markAsProcessing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkAsProcessingDto,
  ): Promise<Transaction> {
    this.logger.log(`Marking transaction ${id} as processing`);

    try {
      return await this.transactionService.markAsProcessing(id, dto);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          throw new NotFoundException(error.message);
        }
        if (error.message.includes('Cannot transition')) {
          throw new BadRequestException(error.message);
        }
      }
      throw error;
    }
  }

  /**
   * Get transaction audit trail
   */
  @Get(':id/audit-trail')
  @ApiOperation({ summary: 'Get transaction audit trail' })
  async getAuditTrail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuditLog[]> {
    const auditLogs = await this.transactionService.getAuditTrail(id);

    if (auditLogs.length === 0) {
      // Check if transaction exists
      const transaction = await this.transactionService.getTransaction(id);
      if (!transaction) {
        throw new NotFoundException(`Transaction not found: ${id}`);
      }
    }

    return auditLogs;
  }

  /**
   * Get webhooks for transaction
   */
  @Get(':id/webhooks')
  @ApiOperation({ summary: 'Get webhooks for transaction' })
  async getWebhooks(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookLog[]> {
    const webhooks = await this.transactionService.getTransactionWebhooks(id);

    if (webhooks.length === 0) {
      // Check if transaction exists
      const transaction = await this.transactionService.getTransaction(id);
      if (!transaction) {
        throw new NotFoundException(`Transaction not found: ${id}`);
      }
    }

    return webhooks;
  }

  /**
   * Reconcile transaction with provider
   */
  @Post(':id/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconcile transaction with provider API' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Force status update even if invalid transition',
        },
        updateStatus: {
          type: 'boolean',
          description: 'Update local status if diverged',
        },
      },
    },
  })
  async reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() options: { force?: boolean; updateStatus?: boolean },
  ): Promise<any> {
    this.logger.log(`Reconciling transaction ${id}`);

    try {
      const result = await this.transactionService.reconcile(id, options);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /**
   * List transactions by status
   */
  @Get()
  @ApiOperation({ summary: 'List transactions' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: TransactionStatus,
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'provider',
    required: false,
    type: 'string',
    description: 'Filter by provider',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'number',
    description: 'Number of results to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: 'number',
    description: 'Number of results to skip',
  })
  async listTransactions(
    @Query('status') status?: TransactionStatus,
    @Query('provider') provider?: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ): Promise<{
    transactions: Transaction[];
    total: number;
    hasMore: boolean;
  }> {
    if (status) {
      return await this.transactionService.listTransactionsByStatus(status, {
        provider,
        limit,
        offset,
      });
    }

    // For now, if no status provided, get all pending
    return await this.transactionService.listTransactionsByStatus(
      TransactionStatus.PENDING,
      {
        provider,
        limit,
        offset,
      },
    );
  }

  /**
   * Check if transaction is settled
   */
  @Get(':id/settled')
  @ApiOperation({ summary: 'Check if transaction is in a settled state' })
  async isSettled(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ settled: boolean; status?: string }> {
    const settled = await this.transactionService.isSettled(id);

    if (settled === false) {
      // Check if transaction exists
      const transaction = await this.transactionService.getTransaction(id);
      if (!transaction) {
        throw new NotFoundException(`Transaction not found: ${id}`);
      }

      return {
        settled: false,
        status: transaction.status,
      };
    }

    return { settled: true };
  }

  /**
   * Get transaction statistics
   */
  @Get('stats/summary')
  @ApiOperation({ summary: 'Get transaction statistics' })
  @ApiQuery({
    name: 'provider',
    required: false,
    type: 'string',
    description: 'Filter by provider',
  })
  async getStatistics(@Query('provider') provider?: string): Promise<any> {
    return await this.transactionService.getStatistics({ provider });
  }

  /**
   * Find stale transactions
   */
  @Get('stale/scan')
  @ApiOperation({ summary: 'Find stale transactions that need reconciliation' })
  @ApiQuery({
    name: 'staleAfterMinutes',
    required: false,
    type: 'number',
    description: 'Minutes after which transaction is considered stale',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'number',
    description: 'Maximum number of results',
  })
  async scanStaleTransactions(
    @Query('staleAfterMinutes', new DefaultValuePipe(60), ParseIntPipe)
    staleAfterMinutes?: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ): Promise<Transaction[]> {
    return await this.transactionService.scanStaleTransactions({
      staleAfterMinutes,
      limit,
    });
  }
}
