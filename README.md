# PayHook - Transaction Truth Engine

A database and provider agnostic NestJS library for converting payment provider webhooks into verified, deduplicated, normalized transaction facts with an append-only audit trail.

## Features

- **Query-First API**: Safe for humans and AI agents - query for truth, don't trust webhooks blindly
- **Provider Agnostic**: Adapter pattern supports any payment provider (Paystack, Stripe, Flutterwave, etc.)
- **Database Agnostic**: Works with PostgreSQL, MySQL, SQL Server, SQLite via TypeORM (MongoDB, DynamoDB adapters possible)
- **State Machine**: Enforces valid transaction lifecycle transitions with guards and conditions
- **7-Layer Pipeline**: Verification → Normalization → Persistence → Deduplication → State Engine → Dispatch
- **Audit Everything**: Complete append-only audit trail for every webhook and state change
- **Production Ready**: Rate limiting, IP allowlisting, body size validation, and more

## Quick Start

### Installation

```bash
npm install @payhook/core
```

### Basic Setup

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PayHookModule,
  TypeORMStorageAdapter,
  PaystackProviderAdapter,
} from '@payhook/core';

@Module({
  imports: [
    // Setup TypeORM
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'payhook',
      username: 'payhook',
      password: 'payhook',
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      synchronize: true, // Disable in production
    }),

    // Setup PayHook
    PayHookModule.forRoot({
      storage: {
        adapter: 'typeorm',
      },
      providers: {
        paystack: {
          adapter: PaystackProviderAdapter,
          secrets: [process.env.PAYSTACK_SECRET],
        },
      },
      webhook: {
        path: '/webhooks',
        timeout: 30000,
      },
    }),
  ],
})
export class AppModule {}
```

### Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=payhook
DB_PASSWORD=payhook
DB_NAME=payhook

# Provider Secrets
PAYSTACK_SECRET=sk_test_xxxxx
STRIPE_SECRET=whsec_xxxxx
```

### Docker Compose (Development)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: payhook
      POSTGRES_USER: payhook
      POSTGRES_PASSWORD: payhook
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Usage

### 1. Create a Transaction

```typescript
import { Injectable } from '@nestjs/common';
import { TransactionService } from '@payhook/core';

@Injectable()
export class PaymentService {
  constructor(
    private readonly transactionService: TransactionService,
  ) {}

  async initiatePayment(amount: number, currency: string) {
    // Create transaction record before provider interaction
    const transaction = await this.transactionService.createTransaction({
      applicationRef: `ORDER-${Date.now()}`,
      provider: 'paystack',
      amount: amount * 100, // Convert to smallest unit
      currency,
      metadata: {
        orderId: 'ORDER-123',
        customerId: 'CUST-456',
      },
    });

    // Now interact with payment provider...
    const providerResponse = await this.paystack.initializeTransaction({
      amount: transaction.money.amount,
      currency: transaction.money.currency,
      reference: transaction.applicationRef,
    });

    // Mark as processing after successful provider handoff
    await this.transactionService.markAsProcessing(
      transaction.id,
      {
        providerRef: providerResponse.reference,
        verificationMethod: 'webhook_only',
      },
    );

    return {
      transactionId: transaction.id,
      paymentUrl: providerResponse.authorization_url,
    };
  }
}
```

### 2. Webhook Processing (Automatic)

PayHook automatically handles incoming webhooks at `/webhooks/:provider`:

```typescript
// Webhook received at POST /webhooks/paystack
// PayHook automatically:
// 1. Verifies signature
// 2. Normalizes payload
// 3. Logs the webhook
// 4. Deduplicates
// 5. Updates transaction state
// 6. Dispatches events
```

### 3. Query Transaction Status

```typescript
// Get transaction with verification
const transaction = await this.transactionService.getTransaction(
  transactionId,
  {
    verify: true, // Verify with provider API
    includeWebhooks: true, // Include webhook history
    includeAuditTrail: true, // Include audit logs
  },
);

// Check if settled
const isSettled = await this.transactionService.isSettled(transactionId);

// Get by application reference
const txn = await this.transactionService.getTransactionByApplicationRef(
  'ORDER-123',
);
```

### 4. Handle Events

```typescript
import { Injectable } from '@nestjs/common';
import { OnPaymentEvent, PaymentEventContext } from '@payhook/core';

@Injectable()
export class PaymentEventHandler {
  @OnPaymentEvent('payment.succeeded')
  async handlePaymentSuccess(context: PaymentEventContext) {
    console.log('Payment successful:', context.transaction.id);
    // Update order status, send email, etc.
  }

  @OnPaymentEvent('payment.failed')
  async handlePaymentFailed(context: PaymentEventContext) {
    console.log('Payment failed:', context.transaction.id);
    // Handle failure logic
  }

  @OnPaymentEvent('refund.completed')
  async handleRefund(context: PaymentEventContext) {
    console.log('Refund completed:', context.transaction.id);
    // Process refund logic
  }
}
```

### 5. Reconciliation

```typescript
// Reconcile single transaction
const result = await this.transactionService.reconcile(
  transactionId,
  {
    force: false,
    updateStatus: true, // Auto-fix divergence
  },
);

if (result.diverged) {
  console.log('Local:', result.localStatus);
  console.log('Provider:', result.providerStatus);
}

// Scan for stale transactions
const staleTransactions = await this.transactionService.scanStaleTransactions({
  staleAfterMinutes: 60,
  limit: 100,
});

// Reconcile all stale transactions
for (const txn of staleTransactions) {
  await this.transactionService.reconcile(txn.id);
}
```

## Security Middleware

### Rate Limiting

```typescript
import { PayHookRateLimitGuard } from '@payhook/core';

@Controller('webhooks')
@UseGuards(PayHookRateLimitGuard)
export class WebhookController {
  // Automatically rate limited
}

// Or with configuration
@Module({
  imports: [
    PayHookMiddlewareModule.forRoot({
      rateLimit: {
        enabled: true,
        windowMs: 60000, // 1 minute
        maxRequests: 100, // 100 requests per minute
      },
    }),
  ],
})
```

### IP Allowlisting

```typescript
PayHookMiddlewareModule.forRoot({
  ipAllowlist: {
    enabled: true,
    allowedIps: ['192.168.1.0/24'],
    providerIpMappings: {
      paystack: [
        '52.31.139.75',
        '52.49.173.169',
        '52.214.14.220',
      ],
      stripe: [/* Stripe webhook IPs */],
    },
  },
})
```

### Body Size Validation

```typescript
PayHookMiddlewareModule.forRoot({
  bodySize: {
    enabled: true,
    maxBodySize: 1048576, // 1MB
    checkContentLength: true,
  },
})
```

### Combined Security

```typescript
import { PayHookSecurityGuard } from '@payhook/core';

@Controller('webhooks')
@UseGuards(PayHookSecurityGuard) // All security features
export class WebhookController {}
```

## Advanced Features

### Unmatched Webhook Handling

```typescript
// List unmatched webhooks
const unmatched = await this.transactionService.listUnmatchedWebhooks({
  provider: 'paystack',
  limit: 100,
});

// Late match webhook to transaction
const result = await this.transactionService.linkUnmatchedWebhook(
  webhookLogId,
  transactionId,
);

if (result.transitionApplied) {
  console.log('State transition applied from late match');
}
```

### Event Replay

```typescript
// Replay events for testing or recovery
const replayResult = await this.transactionService.replayEvents(
  transactionId,
  {
    fromDate: new Date('2024-01-01'),
    eventTypes: ['payment.succeeded', 'payment.failed'],
  },
);

console.log(`Replayed ${replayResult.replayed} of ${replayResult.total} events`);
```

### Statistics

```typescript
const stats = await this.transactionService.getStatistics({
  provider: 'paystack',
  fromDate: new Date('2024-01-01'),
  toDate: new Date('2024-12-31'),
});

console.log('Total transactions:', stats.total);
console.log('By status:', stats.byStatus);
console.log('By provider:', stats.byProvider);
console.log('Total amount:', stats.totalAmount);
```

### Data Retention

```typescript
// Purge old logs based on retention policy
const purgeResult = await this.transactionService.purgeExpiredLogs({
  webhookLogDays: 90,
  dispatchLogDays: 30,
});

console.log('Webhook logs deleted:', purgeResult.webhookLogsDeleted);
console.log('Dispatch logs deleted:', purgeResult.dispatchLogsDeleted);
```

## Architecture

### Processing Pipeline

```
1. Webhook Received → 2. Verify Signature → 3. Normalize Payload
        ↓                                            ↓
4. Persist Claim ← 5. Deduplicate ← 6. State Machine
        ↓
7. Dispatch Events → Event Handlers
```

### Transaction States

```
PENDING → PROCESSING → SUCCESSFUL
                    ↘ → FAILED
                    ↘ → ABANDONED

SUCCESSFUL → REFUNDING → REFUNDED
         ↘ → DISPUTED → DISPUTE_RESOLVED/DISPUTE_LOST
```

### Claim Fates

Every webhook is classified into one of 7 fates:

1. **PROCESSED**: Valid webhook, transaction updated
2. **DUPLICATE**: Already processed (idempotent)
3. **UNMATCHED**: No matching transaction found
4. **INVALID_TRANSITION**: State machine rejected
5. **SIGNATURE_FAILED**: Invalid signature
6. **NORMALIZATION_FAILED**: Couldn't normalize
7. **STORAGE_FAILED**: Database error

## Testing

### Using Mock Adapters

```typescript
import {
  MockStorageAdapter,
  MockProviderAdapter,
  MockWebhookFactory,
} from '@payhook/core/testing';

describe('Payment Flow', () => {
  let storage: MockStorageAdapter;
  let provider: MockProviderAdapter;
  let factory: MockWebhookFactory;

  beforeEach(() => {
    storage = new MockStorageAdapter();
    provider = new MockProviderAdapter();
    factory = new MockWebhookFactory();
  });

  it('should process payment webhook', async () => {
    // Create transaction
    const txn = await storage.createTransaction({
      applicationRef: 'TEST-001',
      provider: 'mock',
      amount: 1000,
      currency: 'USD',
    });

    // Generate webhook
    const webhook = factory.generateWebhook('payment.succeeded', {
      reference: 'TEST-001',
      amount: 1000,
    });

    // Process webhook
    const result = await processor.processWebhook(
      'mock',
      webhook.body,
      webhook.headers,
    );

    expect(result.success).toBe(true);
    expect(result.fate).toBe('PROCESSED');
  });
});
```

## Configuration

### Full Configuration Example

```typescript
PayHookModule.forRoot({
  // Storage Configuration
  storage: {
    adapter: 'typeorm',
    options: {
      synchronize: false,
      logging: true,
    },
  },

  // Provider Configuration
  providers: {
    paystack: {
      adapter: PaystackProviderAdapter,
      secrets: [process.env.PAYSTACK_SECRET],
      options: {
        apiKey: process.env.PAYSTACK_API_KEY,
        verifyTimeout: 10000,
      },
    },
    stripe: {
      adapter: StripeProviderAdapter,
      secrets: [process.env.STRIPE_WEBHOOK_SECRET],
    },
  },

  // Webhook Configuration
  webhook: {
    path: '/webhooks',
    timeout: 30000,
    raw: true,
    redactKeys: ['card_number', 'cvv'],
  },

  // Event Configuration
  events: {
    async: true,
    outbox: {
      enabled: true,
      pollIntervalMs: 5000,
      maxRetries: 3,
    },
  },

  // Lifecycle Hooks
  hooks: {
    beforeProcess: async (context) => {
      console.log('Processing webhook:', context.provider);
    },
    afterProcess: async (result) => {
      console.log('Webhook processed:', result.fate);
    },
  },
});
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for information on:
- Adding new storage adapters
- Adding new provider adapters
- Testing guidelines
- Code style

## API Reference

### TransactionService

| Method | Description |
|--------|-------------|
| `createTransaction(dto)` | Create new transaction |
| `markAsProcessing(id, dto)` | Mark as processing after provider handoff |
| `getTransaction(id, options?)` | Get transaction with optional verification |
| `getTransactionByApplicationRef(ref)` | Get by application reference |
| `getTransactionByProviderRef(provider, ref)` | Get by provider reference |
| `isSettled(id)` | Check if transaction is settled |
| `reconcile(id, options?)` | Reconcile with provider |
| `scanStaleTransactions(options?)` | Find stale transactions |
| `listTransactionsByStatus(status, options?)` | List by status |
| `linkUnmatchedWebhook(webhookId, txnId)` | Late match webhook |
| `listUnmatchedWebhooks(options?)` | List unmatched webhooks |
| `replayEvents(id, options?)` | Replay events |
| `purgeExpiredLogs(config)` | Purge old logs |

### WebhookProcessor

| Method | Description |
|--------|-------------|
| `processWebhook(provider, body, headers)` | Process incoming webhook |
| `getMetrics()` | Get processing metrics |

### PayHookService

| Method | Description |
|--------|-------------|
| `processWebhook(provider, body, headers)` | Process webhook |
| `reconcileTransactions(provider?, limit?)` | Bulk reconciliation |
| `getDashboardStats()` | Get dashboard statistics |

## License

MIT

## Support

- GitHub Issues: [github.com/payhook/core/issues](https://github.com/payhook/core/issues)
- Documentation: [docs.payhook.dev](https://docs.payhook.dev)
- Discord: [discord.gg/payhook](https://discord.gg/payhook)