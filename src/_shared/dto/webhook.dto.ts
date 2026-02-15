import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Response DTO for webhook processing
 */
export class WebhookResponseDto {
  @ApiPropertyOptional({
    description: 'The fate assigned to this webhook claim',
    example: 'processed',
    enum: ['processed', 'duplicate', 'unmatched', 'signature_failed', 'normalization_failed', 'transition_rejected'],
  })
  claimFate: string;

  @ApiPropertyOptional({
    description: 'Provider that sent the webhook',
    example: 'paystack',
  })
  provider?: string;

  @ApiPropertyOptional({
    description: 'Event type extracted from webhook',
    example: 'charge.success',
  })
  eventType?: string;

  @ApiPropertyOptional({
    description: 'Transaction ID if webhook was matched',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  transactionId?: string;

  @ApiPropertyOptional({
    description: 'Webhook log ID for audit trail',
    example: 'wh_log_123',
  })
  webhookLogId?: string;

  @ApiPropertyOptional({
    description: 'Processing message',
    example: 'Webhook processed and state transition applied',
  })
  message?: string;
}

/**
 * DTO for listing unmatched webhooks
 */
export class ListUnmatchedWebhooksDto {
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
 * DTO for linking unmatched webhook
 */
export class LinkUnmatchedWebhookDto {
  @ApiPropertyOptional({
    description: 'Transaction ID to link the webhook to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  transactionId: string;

  @ApiPropertyOptional({
    description: 'Apply state transition based on webhook event',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  applyTransition?: boolean = true;
}

/**
 * DTO for replaying events
 */
export class ReplayEventsDto {
  @ApiPropertyOptional({
    description: 'Replay events from this date',
    example: '2024-02-01T00:00:00Z',
  })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'Replay events until this date',
    example: '2024-02-14T23:59:59Z',
  })
  @IsOptional()
  @IsString()
  toDate?: string;

  @ApiPropertyOptional({
    description: 'Specific event types to replay',
    example: ['PAYMENT_SUCCEEDED', 'PAYMENT_FAILED'],
  })
  @IsOptional()
  @IsString({ each: true })
  eventTypes?: string[];
}
