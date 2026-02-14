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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  TransactionService,
  Transaction,
  AuditLog,
  WebhookLog,
} from '../../../core';
import {
  ApiCreateTransaction,
  ApiGetTransaction,
  ApiMarkAsProcessing,
  ApiReconcileTransaction,
  ApiListTransactions,
  ApiScanStaleTransactions,
  ApiTransactionStatistics,
} from '../../../_shared/swagger/decorators';
import {
  CreateTransactionDto,
  MarkAsProcessingDto,
  UpdateTransactionMetadataDto,
  ReconcileTransactionDto,
  TransactionQueryDto,
  ListTransactionsDto,
  ScanStaleTransactionsDto,
} from '../../../_shared/dto';

/**
 * Transaction Controller
 * Using shared Swagger decorators and DTOs for better maintainability
 */
@ApiTags('Transactions')
@Controller('transactions')
export class TransactionController {
  private readonly logger = new Logger(TransactionController.name);

  constructor(
    @Inject(TransactionService)
    private readonly transactionService: TransactionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreateTransaction()
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

  @Get(':id')
  @ApiGetTransaction()
  async getTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TransactionQueryDto,
  ): Promise<Transaction> {
    const transaction = await this.transactionService.getTransaction(id, {
      verify: query.verify === true,
      includeWebhooks: query.includeWebhooks === true,
      includeAuditTrail: query.includeAuditTrail === true,
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction not found: ${id}`);
    }

    return transaction;
  }

  @Get('application/:applicationRef')
  @ApiGetTransaction({ byApplicationRef: true })
  async getByApplicationRef(
    @Param('applicationRef') applicationRef: string,
    @Query() query: TransactionQueryDto,
  ): Promise<Transaction> {
    const transaction =
      await this.transactionService.getTransactionByApplicationRef(
        applicationRef,
        { verify: query.verify === true },
      );

    if (!transaction) {
      throw new NotFoundException(
        `Transaction not found with application ref: ${applicationRef}`,
      );
    }

    return transaction;
  }

  @Get('provider/:provider/:providerRef')
  @ApiGetTransaction({ byProviderRef: true })
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

  @Put(':id/processing')
  @HttpCode(HttpStatus.OK)
  @ApiMarkAsProcessing()
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

  @Get(':id/audit-trail')
  @ApiGetTransaction({ auditTrailOnly: true })
  async getAuditTrail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuditLog[]> {
    const auditLogs = await this.transactionService.getAuditTrail(id);

    if (auditLogs.length === 0) {
      const transaction = await this.transactionService.getTransaction(id);
      if (!transaction) {
        throw new NotFoundException(`Transaction not found: ${id}`);
      }
    }

    return auditLogs;
  }

  @Get(':id/webhooks')
  @ApiGetTransaction({ webhooksOnly: true })
  async getWebhooks(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookLog[]> {
    const webhooks = await this.transactionService.getTransactionWebhooks(id);

    if (webhooks.length === 0) {
      const transaction = await this.transactionService.getTransaction(id);
      if (!transaction) {
        throw new NotFoundException(`Transaction not found: ${id}`);
      }
    }

    return webhooks;
  }

  @Post(':id/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiReconcileTransaction()
  async reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileTransactionDto,
  ): Promise<any> {
    this.logger.log(`Reconciling transaction ${id}`);

    try {
      return await this.transactionService.reconcile(id, dto);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Get()
  @ApiListTransactions()
  async listTransactions(@Query() query: ListTransactionsDto): Promise<{
    transactions: Transaction[];
    total: number;
    hasMore: boolean;
  }> {
    if (query.status) {
      return await this.transactionService.listTransactionsByStatus(
        query.status,
        {
          provider: query.provider,
          limit: query.limit,
          offset: query.offset,
        },
      );
    }

    // Default to pending if no status provided
    return await this.transactionService.listTransactionsByStatus(
      'PENDING' as any,
      {
        provider: query.provider,
        limit: query.limit,
        offset: query.offset,
      },
    );
  }

  @Get(':id/settled')
  @ApiGetTransaction({ settledCheck: true })
  async isSettled(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ settled: boolean; status?: string }> {
    const settled = await this.transactionService.isSettled(id);

    if (!settled) {
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

  @Get('stats/summary')
  @ApiTransactionStatistics()
  async getStatistics(@Query('provider') provider?: string): Promise<any> {
    return await this.transactionService.getStatistics({ provider });
  }

  @Get('stale/scan')
  @ApiScanStaleTransactions()
  async scanStaleTransactions(
    @Query() query: ScanStaleTransactionsDto,
  ): Promise<Transaction[]> {
    return await this.transactionService.scanStaleTransactions({
      staleAfterMinutes: query.staleAfterMinutes,
      limit: query.limit,
    });
  }
}
