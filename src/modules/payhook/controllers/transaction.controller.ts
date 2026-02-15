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
import { TransactionService, Transaction } from '../../../core';
import { TRANSACTION_SERVICE } from '../constants';
import {
  CreateTransactionDto,
  MarkAsProcessingDto,
  TransactionResponseDto,
} from '../../../_shared/dto';
import {
  ApiCreateTransaction,
  ApiMarkAsProcessing,
  ApiGetTransactionByAppRef,
} from '../../../_shared/swagger/decorators';

/**
 * Transaction Controller
 *
 * Minimal HTTP endpoints for essential transaction operations.
 * These are the operations that MUST be HTTP because:
 * 1. POST /transactions - Frontend/agents need to create transactions
 * 2. PUT /transactions/:id/processing - Need to link provider ref after redirect
 * 3. GET /transactions/by-app-ref/:ref - The "did money come in?" query
 *
 * Everything else (reconciliation, statistics, audit trails, etc.) should be
 * accessed programmatically through TransactionService.
 */
@ApiTags('Query')
@Controller('transactions')
export class TransactionController {
  private readonly logger = new Logger(TransactionController.name);

  constructor(
    @Inject(TRANSACTION_SERVICE)
    private readonly transactionService: TransactionService,
  ) {}

  /**
   * Create a new transaction
   * Called when payment is initiated but before provider interaction
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreateTransaction()
  async createTransaction(
    @Body() dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    this.logger.log(`Creating transaction: ${dto.applicationRef}`);

    try {
      const transaction = await this.transactionService.createTransaction(dto);
      this.logger.log(`Transaction created: ${transaction.id}`);

      // Map to response DTO
      return {
        id: transaction.id,
        applicationRef: transaction.applicationRef,
        providerRef: transaction.providerRef,
        provider: transaction.provider,
        status: transaction.status,
        amount: transaction.money.amount,
        currency: transaction.money.currency,
        verificationMethod: transaction.verificationMethod,
        isSettled: transaction.isSettled(),
        metadata: transaction.metadata,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        providerCreatedAt: transaction.providerCreatedAt,
      };
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
   * Mark transaction as processing
   * Called after successful provider handoff to link provider reference
   */
  @Put(':id/processing')
  @HttpCode(HttpStatus.OK)
  @ApiMarkAsProcessing()
  async markAsProcessing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkAsProcessingDto,
  ): Promise<TransactionResponseDto> {
    this.logger.log(`Marking transaction ${id} as processing`);

    try {
      const transaction = await this.transactionService.markAsProcessing(id, dto);

      // Map to response DTO
      return {
        id: transaction.id,
        applicationRef: transaction.applicationRef,
        providerRef: transaction.providerRef,
        provider: transaction.provider,
        status: transaction.status,
        amount: transaction.money.amount,
        currency: transaction.money.currency,
        verificationMethod: transaction.verificationMethod,
        isSettled: transaction.isSettled(),
        metadata: transaction.metadata,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        providerCreatedAt: transaction.providerCreatedAt,
      };
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
   * Get transaction by application reference
   * The "did money come in?" query - most important read endpoint
   */
  @Get('by-app-ref/:applicationRef')
  @ApiGetTransactionByAppRef()
  async getByApplicationRef(
    @Param('applicationRef') applicationRef: string,
    @Query('verify') verify?: boolean,
  ): Promise<TransactionResponseDto> {
    const transaction =
      await this.transactionService.getTransactionByApplicationRef(
        applicationRef,
        { verify: verify || false },
      );

    if (!transaction) {
      throw new NotFoundException(
        `Transaction not found with application ref: ${applicationRef}`,
      );
    }

    // Return simplified response optimized for the "did money come in?" use case
    return {
      id: transaction.id,
      applicationRef: transaction.applicationRef,
      providerRef: transaction.providerRef,
      provider: transaction.provider,
      status: transaction.status,
      amount: transaction.money.amount,
      currency: transaction.money.currency,
      isSettled: transaction.isSettled(),
      verificationMethod: transaction.verificationMethod,
      metadata: transaction.metadata,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      providerCreatedAt: transaction.providerCreatedAt,
    };
  }
}
