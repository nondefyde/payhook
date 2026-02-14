# Adapters Layer

## Overview

The `adapters` directory contains concrete implementations of the interfaces defined in the core layer. Adapters are the bridge between PayHook's pure business logic and the external world - databases, payment providers, and other third-party services.

## Philosophy

Adapters follow the Hexagonal Architecture (Ports and Adapters) pattern:
- **Dependency Inversion**: Adapters depend on core interfaces, not vice versa
- **Pluggability**: Easy to swap implementations without changing core logic
- **Isolation**: Each adapter handles one specific external concern
- **Testability**: Mock adapters for testing, real adapters for production

## Directory Structure

```
adapters/
├── providers/              # Payment provider integrations
│   ├── paystack/          # Paystack adapter implementation
│   ├── stripe/            # Stripe adapter (future)
│   ├── flutterwave/       # Flutterwave adapter (future)
│   └── mock/              # Mock provider for testing
├── storage/               # Database implementations
│   ├── typeorm/           # TypeORM (PostgreSQL) adapter
│   ├── mongodb/           # MongoDB adapter (future)
│   └── mock/              # In-memory storage for testing
└── README.md
```

## Provider Adapters (`/providers`)

Provider adapters handle payment provider-specific logic, implementing the `PaymentProviderAdapter` interface from core.

### Paystack Adapter (`/providers/paystack`)

Complete implementation for Paystack payment processing.

#### Files Structure
```
paystack/
├── paystack-provider.adapter.ts    # Main adapter implementation
├── paystack-webhook.factory.ts     # Test webhook generator
├── paystack.types.ts               # Paystack-specific types
└── README.md                       # Paystack-specific docs
```

#### Implementation Details

```typescript
export class PaystackProviderAdapter implements PaymentProviderAdapter {
  readonly providerName = 'paystack';
  private readonly secretKey?: string;
  private readonly webhookSecrets: string[];

  constructor(config?: {
    keys?: {
      secretKey: string;
      publicKey?: string;
      webhookSecret?: string | string[];
      previousKeys?: {
        secretKey?: string;
        webhookSecret?: string | string[];
      };
    };
    options?: ProviderConfig;
  })
}
```

#### Key Features

**1. Signature Verification**
Uses HMAC-SHA512 for webhook authentication:
```typescript
verifySignature(
  rawBody: Buffer,
  headers: Record<string, string>,
  secrets?: string[]
): boolean {
  const signature = headers['x-paystack-signature'];

  for (const secret of secrets) {
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    if (timingSafeEqual(hash, signature)) {
      return true;
    }
  }
  return false;
}
```

**2. Event Normalization**
Maps Paystack events to standard PayHook events:
```typescript
normalize(rawPayload: Record<string, any>): NormalizedWebhookEvent {
  const event = rawPayload.event;
  const data = rawPayload.data;

  return {
    eventType: this.mapEventType(event), // e.g., 'charge.success' → PAYMENT_SUCCESSFUL
    providerEventId: `${event}_${data.id}`,
    providerRef: data.reference,
    amount: data.amount, // In kobo
    currency: data.currency || 'NGN',
    applicationRef: data.metadata?.order_id,
    providerTimestamp: data.created_at,
    customerEmail: data.customer?.email,
    providerMetadata: { ...data }
  };
}
```

**3. Event Mapping**
```typescript
private mapEventType(event: string): NormalizedEventType {
  const eventMap = {
    'charge.success': NormalizedEventType.PAYMENT_SUCCESSFUL,
    'charge.failed': NormalizedEventType.PAYMENT_FAILED,
    'transfer.success': NormalizedEventType.PAYMENT_SUCCESSFUL,
    'transfer.failed': NormalizedEventType.PAYMENT_FAILED,
    'refund.processed': NormalizedEventType.REFUND_SUCCESSFUL,
    'refund.failed': NormalizedEventType.REFUND_FAILED,
    'dispute.create': NormalizedEventType.CHARGE_DISPUTED,
    // ... more mappings
  };

  return eventMap[event] || NormalizedEventType.PAYMENT_FAILED;
}
```

**4. API Verification**
Optional verification with Paystack API:
```typescript
async verifyWithProvider(
  providerRef: string,
  options?: VerifyOptions
): Promise<ProviderVerificationResult | null> {
  const url = `${this.config.apiBaseUrl}/transaction/verify/${providerRef}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json'
    }
  });

  const result = await response.json();

  return {
    status: this.mapApiStatus(result.data.status),
    providerRef: result.data.reference,
    amount: result.data.amount,
    currency: result.data.currency,
    providerTimestamp: result.data.paid_at,
    metadata: { ...result.data }
  };
}
```

**5. Configuration**
```typescript
const adapter = new PaystackProviderAdapter({
  keys: {
    secretKey: 'sk_live_xxxxx',           // For API calls
    webhookSecret: 'sk_live_xxxxx',       // Usually same as secretKey
    previousKeys: {                       // For key rotation
      secretKey: 'sk_live_old_xxxxx'
    }
  },
  options: {
    apiBaseUrl: 'https://api.paystack.co',
    timeout: 30000,
    testMode: false
  }
});
```

### Mock Provider Adapter (`/providers/mock`)

Test adapter for development and testing.

```typescript
export class MockProviderAdapter implements PaymentProviderAdapter {
  readonly providerName = 'mock';
  private webhooks: MockWebhook[] = [];

  // Configurable behavior
  constructor(private config: MockProviderConfig = {}) {
    this.config = {
      shouldFailSignature: false,
      shouldFailNormalization: false,
      verificationDelay: 0,
      ...config
    };
  }

  // Generate test webhooks
  generateWebhook(scenario: WebhookScenario): MockWebhook {
    switch (scenario) {
      case 'payment.success':
        return this.createSuccessWebhook();
      case 'payment.failed':
        return this.createFailedWebhook();
      case 'refund.completed':
        return this.createRefundWebhook();
      // ... more scenarios
    }
  }

  // Deterministic signature for testing
  verifySignature(): boolean {
    return !this.config.shouldFailSignature;
  }
}
```

### Adding New Provider Adapters

To add a new payment provider (e.g., Stripe):

**1. Create Directory Structure**
```
providers/
└── stripe/
    ├── stripe-provider.adapter.ts
    ├── stripe-webhook.factory.ts
    ├── stripe.types.ts
    └── README.md
```

**2. Implement the Adapter**
```typescript
export class StripeProviderAdapter implements PaymentProviderAdapter {
  readonly providerName = 'stripe';

  verifySignature(rawBody: Buffer, headers: Record<string, string>, secrets: string[]): boolean {
    const signature = headers['stripe-signature'];
    // Stripe uses different signature scheme
    return stripe.webhooks.constructEvent(rawBody, signature, secrets[0]);
  }

  normalize(rawPayload: Record<string, any>): NormalizedWebhookEvent {
    // Map Stripe events to normalized format
  }

  // ... implement all required methods
}
```

**3. Write Tests**
```typescript
describe('StripeProviderAdapter', () => {
  it('should verify webhook signatures');
  it('should normalize payment events');
  it('should handle refunds');
  it('should verify with API');
});
```

## Storage Adapters (`/storage`)

Storage adapters implement the `StorageAdapter` interface for database operations.

### TypeORM Adapter (`/storage/typeorm`)

Production-ready PostgreSQL implementation using TypeORM.

#### Files Structure
```
typeorm/
├── entities/                    # Database entities
│   ├── transaction.entity.ts   # Transaction table
│   ├── webhook-log.entity.ts   # Webhook log table
│   ├── audit-log.entity.ts     # Audit trail table
│   ├── dispatch-log.entity.ts  # Event dispatch table
│   └── outbox.entity.ts        # Outbox pattern table
├── repositories/                # Repository implementations
├── migrations/                  # Database migrations
├── typeorm-storage.adapter.ts  # Main adapter
├── typeorm.config.ts           # Database configuration
└── README.md
```

#### Implementation Details

**1. Transaction Entity**
```typescript
@Entity('transactions')
export class TransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  applicationRef: string;

  @Column()
  provider: string;

  @Column({ nullable: true })
  providerRef?: string;

  @Column('bigint')
  amount: number;

  @Column()
  currency: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING
  })
  status: TransactionStatus;

  @Column('jsonb', { nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  settledAt?: Date;

  // Relations
  @OneToMany(() => WebhookLogEntity, webhook => webhook.transaction)
  webhooks: WebhookLogEntity[];

  @OneToMany(() => AuditLogEntity, audit => audit.transaction)
  auditLogs: AuditLogEntity[];
}
```

**2. Atomic Operations**
```typescript
async updateTransactionStatus(
  id: string,
  status: TransactionStatus,
  context: TransitionContext
): Promise<Transaction> {
  return await this.dataSource.transaction(async manager => {
    // Lock transaction row
    const transaction = await manager.findOne(TransactionEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' }
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Update status
    transaction.status = status;
    if (this.isSettledStatus(status)) {
      transaction.settledAt = new Date();
    }

    // Create audit log
    const auditLog = manager.create(AuditLogEntity, {
      transactionId: id,
      fromStatus: transaction.status,
      toStatus: status,
      triggerType: context.trigger,
      webhookLogId: context.webhookLogId,
      actor: context.actor,
      reason: context.reason
    });

    // Save atomically
    await manager.save(transaction);
    await manager.save(auditLog);

    return this.toDomainModel(transaction);
  });
}
```

**3. Deduplication**
```typescript
async isDuplicateWebhook(
  provider: string,
  idempotencyKey: string
): Promise<boolean> {
  const existing = await this.webhookLogRepo.findOne({
    where: {
      provider,
      idempotencyKey
    }
  });

  return !!existing;
}
```

**4. Query Operations**
```typescript
async findTransaction(query: TransactionQuery): Promise<Transaction | null> {
  const qb = this.transactionRepo.createQueryBuilder('t');

  if (query.applicationRef) {
    qb.andWhere('t.applicationRef = :ref', { ref: query.applicationRef });
  }

  if (query.provider) {
    qb.andWhere('t.provider = :provider', { provider: query.provider });
  }

  if (query.status) {
    qb.andWhere('t.status = :status', { status: query.status });
  }

  if (query.includeWebhooks) {
    qb.leftJoinAndSelect('t.webhooks', 'webhooks');
  }

  if (query.includeAuditTrail) {
    qb.leftJoinAndSelect('t.auditLogs', 'audits');
    qb.orderBy('audits.createdAt', 'ASC');
  }

  const entity = await qb.getOne();
  return entity ? this.toDomainModel(entity) : null;
}
```

**5. Migrations**
```typescript
export class CreateTransactionTable1234567890 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'transactions',
      columns: [
        {
          name: 'id',
          type: 'uuid',
          isPrimary: true,
          default: 'uuid_generate_v4()'
        },
        {
          name: 'application_ref',
          type: 'varchar',
          isUnique: true
        },
        // ... more columns
      ],
      indices: [
        {
          name: 'IDX_TRANSACTION_APP_REF',
          columnNames: ['application_ref']
        },
        {
          name: 'IDX_TRANSACTION_PROVIDER_REF',
          columnNames: ['provider', 'provider_ref']
        }
      ]
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('transactions');
  }
}
```

### Mock Storage Adapter (`/storage/mock`)

In-memory implementation for testing.

```typescript
export class MockStorageAdapter implements StorageAdapter {
  private transactions = new Map<string, Transaction>();
  private webhookLogs = new Map<string, WebhookLog>();
  private auditLogs = new Map<string, AuditLog>();

  // Configurable behavior
  constructor(private config: MockStorageConfig = {}) {
    this.config = {
      shouldFailOnCreate: false,
      latency: 0,
      ...config
    };
  }

  async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
    if (this.config.shouldFailOnCreate) {
      throw new Error('Mock storage failure');
    }

    // Simulate latency
    if (this.config.latency) {
      await new Promise(resolve => setTimeout(resolve, this.config.latency));
    }

    const transaction = new Transaction({
      id: uuid(),
      ...dto,
      status: TransactionStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    this.transactions.set(transaction.id, transaction);
    return transaction;
  }

  // In-memory queries
  async findTransaction(query: TransactionQuery): Promise<Transaction | null> {
    for (const transaction of this.transactions.values()) {
      if (query.applicationRef && transaction.applicationRef === query.applicationRef) {
        return transaction;
      }
      // ... more query conditions
    }
    return null;
  }

  // Transaction support (no-op for in-memory)
  async beginTransaction(): Promise<void> {}
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
}
```

## Configuration

### Provider Configuration
```typescript
// In your DI container or module
const paystackAdapter = new PaystackProviderAdapter({
  keys: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET
  },
  options: {
    timeout: 30000,
    testMode: process.env.NODE_ENV === 'test'
  }
});

const providerRegistry = new ProviderRegistry();
providerRegistry.register('paystack', paystackAdapter);
```

### Storage Configuration
```typescript
// TypeORM configuration
const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [TransactionEntity, WebhookLogEntity, AuditLogEntity],
  migrations: ['src/adapters/storage/typeorm/migrations/*.ts'],
  synchronize: false, // Use migrations in production
  logging: process.env.NODE_ENV === 'development'
});

const storageAdapter = new TypeORMStorageAdapter(dataSource);
```

## Testing Adapters

### Provider Adapter Tests
```typescript
describe('PaystackProviderAdapter', () => {
  let adapter: PaystackProviderAdapter;

  beforeEach(() => {
    adapter = new PaystackProviderAdapter({
      keys: { secretKey: 'test_key' }
    });
  });

  describe('signature verification', () => {
    it('should verify valid signatures', () => {
      const body = Buffer.from('{"event":"charge.success"}');
      const signature = generateSignature(body, 'test_key');
      const headers = { 'x-paystack-signature': signature };

      expect(adapter.verifySignature(body, headers, ['test_key'])).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const body = Buffer.from('{"event":"charge.success"}');
      const headers = { 'x-paystack-signature': 'invalid' };

      expect(adapter.verifySignature(body, headers, ['test_key'])).toBe(false);
    });
  });

  describe('normalization', () => {
    it('should normalize payment success events', () => {
      const payload = {
        event: 'charge.success',
        data: {
          id: '123',
          reference: 'ref_123',
          amount: 10000,
          currency: 'NGN',
          customer: { email: 'user@example.com' }
        }
      };

      const normalized = adapter.normalize(payload);

      expect(normalized.eventType).toBe(NormalizedEventType.PAYMENT_SUCCESSFUL);
      expect(normalized.providerRef).toBe('ref_123');
      expect(normalized.amount).toBe(10000);
    });
  });
});
```

### Storage Adapter Tests
```typescript
describe('TypeORMStorageAdapter', () => {
  let adapter: TypeORMStorageAdapter;
  let dataSource: DataSource;

  beforeAll(async () => {
    // Use test database
    dataSource = new DataSource({
      type: 'postgres',
      database: 'payhook_test',
      synchronize: true,
      dropSchema: true,
      entities: [TransactionEntity, WebhookLogEntity]
    });

    await dataSource.initialize();
    adapter = new TypeORMStorageAdapter(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('transaction operations', () => {
    it('should create transactions atomically', async () => {
      const dto = {
        applicationRef: 'order_123',
        provider: 'paystack',
        amount: Money.fromMajorUnits(100, 'USD')
      };

      const transaction = await adapter.createTransaction(dto);

      expect(transaction.id).toBeDefined();
      expect(transaction.status).toBe(TransactionStatus.PENDING);
    });

    it('should prevent duplicate application refs', async () => {
      const dto = {
        applicationRef: 'order_456',
        provider: 'paystack',
        amount: Money.fromMajorUnits(100, 'USD')
      };

      await adapter.createTransaction(dto);

      await expect(adapter.createTransaction(dto))
        .rejects.toThrow('Duplicate key violation');
    });
  });
});
```

## Performance Optimization

### Database Indexes
```sql
-- Critical for webhook processing
CREATE INDEX idx_webhook_idempotency ON webhook_logs(provider, idempotency_key);
CREATE INDEX idx_webhook_transaction ON webhook_logs(transaction_id);

-- Transaction queries
CREATE INDEX idx_transaction_app_ref ON transactions(application_ref);
CREATE INDEX idx_transaction_provider ON transactions(provider, provider_ref);
CREATE INDEX idx_transaction_status ON transactions(status) WHERE status IN ('PENDING', 'PROCESSING');

-- Audit trail
CREATE INDEX idx_audit_transaction ON audit_logs(transaction_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
```

### Connection Pooling
```typescript
const dataSource = new DataSource({
  type: 'postgres',
  // ... other config
  extra: {
    max: 20,                    // Maximum pool size
    min: 5,                     // Minimum pool size
    idleTimeoutMillis: 30000,  // Close idle connections
    connectionTimeoutMillis: 2000
  }
});
```

### Caching
```typescript
class CachedProviderAdapter implements PaymentProviderAdapter {
  private cache = new Map<string, CacheEntry>();

  async verifyWithProvider(
    providerRef: string,
    options?: VerifyOptions
  ): Promise<ProviderVerificationResult | null> {
    // Check cache first
    const cached = this.cache.get(providerRef);
    if (cached && !this.isExpired(cached)) {
      return cached.result;
    }

    // Call provider API
    const result = await this.provider.verifyWithProvider(providerRef, options);

    // Cache result for 30 seconds
    this.cache.set(providerRef, {
      result,
      timestamp: Date.now(),
      ttl: 30000
    });

    return result;
  }
}
```

## Security Considerations

### Secret Management
```typescript
// Never log secrets
class SecureProviderAdapter {
  constructor(config: ProviderConfig) {
    // Validate but don't log
    if (!config.keys?.secretKey) {
      throw new Error('Secret key required');
    }

    // Store securely
    this.secretKey = config.keys.secretKey;

    // Log safe information only
    logger.info('Provider adapter initialized', {
      provider: this.providerName,
      testMode: this.isTestMode(),
      // Never log: secretKey, apiKey, webhookSecret
    });
  }
}
```

### SQL Injection Prevention
```typescript
// Always use parameterized queries
const transaction = await this.repository
  .createQueryBuilder('t')
  .where('t.applicationRef = :ref', { ref: userInput }) // Safe
  .getOne();

// Never do string concatenation
// .where(`t.applicationRef = '${userInput}'`) // UNSAFE!
```

### Rate Limiting
```typescript
class RateLimitedAdapter {
  private rateLimiter = new RateLimiter({
    points: 100,    // Number of requests
    duration: 60,   // Per minute
  });

  async verifyWithProvider(ref: string): Promise<Result> {
    await this.rateLimiter.consume(this.providerName);
    return this.provider.verifyWithProvider(ref);
  }
}
```

## Troubleshooting

### Common Issues

**1. Signature Verification Failures**
- Check webhook secret configuration
- Ensure raw body is used (not parsed JSON)
- Verify header names match provider docs
- Check for key rotation needs

**2. Database Connection Issues**
- Verify connection string
- Check firewall/security groups
- Ensure database is running
- Check connection pool settings

**3. Normalization Errors**
- Log raw webhook payload
- Check provider API version changes
- Verify event type mappings
- Handle optional fields gracefully

## Best Practices

### 1. Error Handling
```typescript
async verifyWithProvider(ref: string): Promise<Result | null> {
  try {
    return await this.callProviderAPI(ref);
  } catch (error) {
    // Log error but don't throw
    logger.error('Provider API error', { error, ref });

    // Return null to indicate verification unavailable
    return null;
  }
}
```

### 2. Logging
```typescript
class LoggingAdapter {
  async processWebhook(body: Buffer): Promise<void> {
    logger.info('Processing webhook', {
      provider: this.providerName,
      size: body.length,
      // Log safe metadata, not sensitive data
    });

    try {
      await this.process(body);
      logger.info('Webhook processed successfully');
    } catch (error) {
      logger.error('Webhook processing failed', { error });
      throw error;
    }
  }
}
```

### 3. Testing
```typescript
// Use mock adapters for unit tests
const mockAdapter = new MockProviderAdapter({
  shouldFailSignature: false,
  verificationDelay: 100
});

// Use real adapters with test credentials for integration tests
const testAdapter = new PaystackProviderAdapter({
  keys: { secretKey: 'sk_test_xxxxx' },
  options: { testMode: true }
});
```

## Contributing

To add a new adapter:

1. **Implement the Interface**: All required methods from core
2. **Write Tests**: Unit and integration tests
3. **Document**: README with examples
4. **Security Review**: No secrets in logs
5. **Performance Test**: Handle high load
6. **Submit PR**: With test coverage

The adapter layer makes PayHook extensible - add your provider today!