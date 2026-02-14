# PayHook Shared Resources

This directory contains shared resources that are used across the PayHook application to maintain consistency and reduce code duplication.

## Directory Structure

```
_shared/
├── dto/                    # Shared Data Transfer Objects with validation
│   ├── transaction.dto.ts  # Transaction-related DTOs
│   ├── webhook.dto.ts      # Webhook-related DTOs
│   └── index.ts            # DTO exports
├── swagger/                # Swagger/OpenAPI documentation
│   └── decorators/         # Reusable Swagger decorators
│       ├── webhook.decorators.ts    # Webhook endpoint decorators
│       ├── transaction.decorators.ts # Transaction endpoint decorators
│       ├── health.decorators.ts     # Health check decorators
│       └── index.ts                  # Decorator exports
└── README.md               # This file
```

## Usage

### DTOs (Data Transfer Objects)

DTOs provide input validation and type safety for API endpoints using `class-validator` and `class-transformer`.

```typescript
import { CreateTransactionDto } from '@shared/dto';

@Post()
async createTransaction(@Body() dto: CreateTransactionDto) {
  // dto is validated and typed
}
```

#### Available DTOs

**Transaction DTOs:**
- `CreateTransactionDto` - Creating new transactions
- `MarkAsProcessingDto` - Marking transaction as processing
- `UpdateTransactionMetadataDto` - Updating transaction metadata
- `ReconcileTransactionDto` - Reconciliation options
- `TransactionQueryDto` - Query parameters for getting transactions
- `ListTransactionsDto` - Listing transactions with filters
- `ScanStaleTransactionsDto` - Scanning for stale transactions

**Webhook DTOs:**
- `WebhookResponseDto` - Standard webhook response format
- `ListUnmatchedWebhooksDto` - Listing unmatched webhooks
- `LinkUnmatchedWebhookDto` - Linking unmatched webhook to transaction
- `ReplayEventsDto` - Replaying events for recovery

### Swagger Decorators

Swagger decorators provide consistent API documentation while keeping controllers clean.

```typescript
import { ApiWebhookEndpoint } from '@shared/swagger/decorators';

@Post(':provider')
@ApiWebhookEndpoint()  // Applies all necessary Swagger documentation
async handleWebhook(...) {
  // Clean controller method
}
```

#### Available Decorators

**Webhook Decorators:**
- `ApiWebhookEndpoint()` - Standard webhook endpoint
- `ApiCustomWebhookEndpoint()` - Custom path webhook endpoint
- `ApiWebhookResponse()` - Webhook response documentation

**Transaction Decorators:**
- `ApiCreateTransaction()` - Create transaction endpoint
- `ApiGetTransaction()` - Get transaction with options
- `ApiMarkAsProcessing()` - Mark as processing endpoint
- `ApiReconcileTransaction()` - Reconciliation endpoint
- `ApiListTransactions()` - List transactions endpoint
- `ApiScanStaleTransactions()` - Scan stale transactions
- `ApiTransactionStatistics()` - Statistics endpoint

**Health Decorators:**
- `ApiHealthCheck()` - Basic health check
- `ApiReadinessCheck()` - Readiness with dependencies
- `ApiServiceStatistics()` - Service statistics

## Benefits

1. **Clean Controllers**: Controllers focus on business logic, not documentation
2. **Consistency**: All endpoints have consistent documentation format
3. **Validation**: DTOs provide automatic input validation
4. **Type Safety**: Full TypeScript support with proper types
5. **Maintainability**: Changes to documentation/validation in one place
6. **Reusability**: Decorators and DTOs can be used across multiple controllers

## Adding New Resources

### Creating a New DTO

1. Create the DTO file in `_shared/dto/`
2. Use `class-validator` decorators for validation
3. Use `@ApiProperty` decorators for Swagger documentation
4. Export from `_shared/dto/index.ts`

### Creating a New Swagger Decorator

1. Create decorator file in `_shared/swagger/decorators/`
2. Use `applyDecorators()` to combine multiple decorators
3. Export from `_shared/swagger/decorators/index.ts`

## Example: Clean vs. Original Controller

### Before (Original):
```typescript
@Post(':provider')
@HttpCode(HttpStatus.OK)
@UseInterceptors(RawBodyInterceptor)
@ApiOperation({ summary: 'Receive webhook from payment provider' })
@ApiParam({
  name: 'provider',
  description: 'Payment provider name',
  example: 'paystack',
})
@ApiResponse({
  status: 200,
  description: 'Webhook processed successfully',
})
@ApiResponse({
  status: 400,
  description: 'Invalid webhook',
})
async handleWebhook(
  @Param('provider') provider: string,
  @Body() rawBody: Buffer,
  @Headers() headers: Record<string, string>,
): Promise<{ success: boolean; message: string; details?: any }> {
  // Method implementation
}
```

### After (Clean):
```typescript
@Post(':provider')
@HttpCode(HttpStatus.OK)
@UseInterceptors(RawBodyInterceptor)
@ApiWebhookEndpoint()  // Single decorator replaces all Swagger decorators
async handleWebhook(
  @Param('provider') provider: string,
  @Body() rawBody: Buffer,
  @Headers() headers: Record<string, string>,
): Promise<WebhookResponseDto> {  // Typed response DTO
  // Method implementation
}
```

## Dependencies

- `@nestjs/swagger` - API documentation
- `class-validator` - DTO validation
- `class-transformer` - DTO transformation

## Best Practices

1. Always use DTOs for request/response bodies
2. Apply validation decorators to all DTO properties
3. Use shared Swagger decorators instead of inline documentation
4. Keep decorators focused and composable
5. Document all DTOs and decorators clearly