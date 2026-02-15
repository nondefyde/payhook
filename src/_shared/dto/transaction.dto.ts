import {
  IsString,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsPositive,
  Length,
  IsObject,
  IsDateString,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TransactionStatus, VerificationMethod } from '../../core/domain/enums';

/**
 * DTO for creating a new transaction
 */
export class CreateTransactionDto {
  @ApiProperty({
    description: 'Unique reference from your application',
    example: 'order_123',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  applicationRef: string;

  @ApiProperty({
    description: 'Payment provider to use',
    example: 'paystack',
    enum: ['paystack', 'stripe', 'flutterwave'],
  })
  @IsNotEmpty()
  @IsString()
  provider: string;

  @ApiProperty({
    description: 'Amount in smallest currency unit (e.g., kobo, cents)',
    example: 10000,
    minimum: 1,
  })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  @Min(1)
  amount: number;

  @ApiProperty({
    description: 'ISO 4217 currency code',
    example: 'NGN',
    pattern: '^[A-Z]{3}$',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a valid 3-letter ISO 4217 code',
  })
  currency: string;

  @ApiPropertyOptional({
    description: 'Additional metadata to store with transaction',
    example: { customerId: 'cust_123', orderId: 'order_456' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'User or system creating the transaction',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsString()
  createdBy?: string;
}

/**
 * DTO for marking a transaction as processing
 */
export class MarkAsProcessingDto {
  @ApiProperty({
    description: 'Reference ID from payment provider',
    example: 'ps_ref_123',
  })
  @IsNotEmpty()
  @IsString()
  providerRef: string;

  @ApiPropertyOptional({
    description: 'Timestamp when transaction was created at provider',
    example: '2024-02-14T12:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  providerCreatedAt?: Date;

  @ApiPropertyOptional({
    description: 'User or system performing this action',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsString()
  performedBy?: string;
}

/**
 * DTO for updating transaction metadata
 */
export class UpdateTransactionMetadataDto {
  @ApiProperty({
    description: 'Metadata to merge with existing metadata',
    example: { status: 'shipped', trackingNumber: 'TRK123' },
  })
  @IsNotEmpty()
  @IsObject()
  metadata: Record<string, any>;

  @ApiPropertyOptional({
    description: 'User or system performing the update',
    example: 'admin@example.com',
  })
  @IsOptional()
  @IsString()
  performedBy?: string;
}

/**
 * DTO for reconciliation options
 */
export class ReconcileTransactionDto {
  @ApiPropertyOptional({
    description: 'Force status update even if transition is invalid',
    default: false,
  })
  @IsOptional()
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Update local status if diverged from provider',
    default: false,
  })
  @IsOptional()
  updateStatus?: boolean;
}

/**
 * DTO for transaction query parameters
 */
export class TransactionQueryDto {
  @ApiPropertyOptional({
    description: 'Verify transaction with provider API',
    example: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  verify?: boolean;

  @ApiPropertyOptional({
    description: 'Include webhook logs in response',
    example: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  includeWebhooks?: boolean;

  @ApiPropertyOptional({
    description: 'Include audit trail in response',
    example: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  includeAuditTrail?: boolean;
}

/**
 * DTO for listing transactions
 */
export class ListTransactionsDto {
  @ApiPropertyOptional({
    description: 'Filter by transaction status',
    enum: TransactionStatus,
  })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({
    description: 'Filter by payment provider',
    example: 'paystack',
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({
    description: 'Number of results per page',
    default: 100,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 100;

  @ApiPropertyOptional({
    description: 'Number of results to skip',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;
}

/**
 * DTO for scanning stale transactions
 */
export class ScanStaleTransactionsDto {
  @ApiPropertyOptional({
    description: 'Minutes after which a transaction is considered stale',
    default: 60,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  staleAfterMinutes?: number = 60;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
    default: 100,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 100;

  @ApiPropertyOptional({
    description: 'Filter by payment provider',
    example: 'paystack',
  })
  @IsOptional()
  @IsString()
  provider?: string;
}

/**
 * Transaction Response DTO
 * Standard response format for transaction endpoints
 */
export class TransactionResponseDto {
  @ApiProperty({
    description: 'Transaction ID',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Your application reference',
    example: 'order_123',
  })
  applicationRef: string;

  @ApiPropertyOptional({
    description: 'Reference ID from payment provider',
    example: 'ps_ref_123',
    type: 'string',
    nullable: true,
  })
  providerRef: string | null;

  @ApiProperty({
    description: 'Payment provider name',
    example: 'paystack',
  })
  provider: string;

  @ApiProperty({
    description: 'Current transaction status',
    enum: TransactionStatus,
    example: 'successful',
  })
  status: TransactionStatus;

  @ApiProperty({
    description: 'Amount in smallest currency unit (e.g., kobo, cents)',
    example: 10000,
    type: 'integer',
  })
  amount: number;

  @ApiProperty({
    description: 'ISO 4217 currency code',
    example: 'NGN',
  })
  currency: string;

  @ApiProperty({
    description: 'Verification confidence level',
    enum: ['webhook_only', 'api_verified', 'reconciled'],
    example: 'webhook_only',
  })
  verificationMethod: string;

  @ApiProperty({
    description: 'Whether transaction has reached a terminal state',
    example: true,
  })
  isSettled: boolean;

  @ApiPropertyOptional({
    description: 'Additional metadata stored with transaction',
    example: { customerId: 'cust_123', orderId: 'order_456' },
    type: 'object',
    additionalProperties: true,
  })
  metadata?: Record<string, any>;

  @ApiProperty({
    description: 'Transaction creation timestamp',
    format: 'date-time',
    example: '2024-02-14T12:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    format: 'date-time',
    example: '2024-02-14T12:01:00Z',
  })
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'When transaction was created at payment provider',
    type: 'string',
    format: 'date-time',
    example: '2024-02-14T12:00:30Z',
    nullable: true,
  })
  providerCreatedAt?: Date | null;
}
