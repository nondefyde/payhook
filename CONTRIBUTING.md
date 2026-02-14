# Contributing to PayHook

Thank you for your interest in contributing to PayHook! This guide will help you add new storage adapters, payment provider adapters, and contribute to the codebase.

## Table of Contents
- [Development Setup](#development-setup)
- [Adding a Storage Adapter](#adding-a-storage-adapter)
- [Adding a Provider Adapter](#adding-a-provider-adapter)
- [Testing Guidelines](#testing-guidelines)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)

## Development Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- Docker (for database testing)
- TypeScript knowledge

### Getting Started

```bash
# Clone the repository
git clone https://github.com/payhook/core.git
cd payhook-core

# Install dependencies
npm install

# Run tests
npm test

# Start development database
docker-compose up -d

# Run tests with coverage
npm run test:cov
```

## Adding a Storage Adapter

Storage adapters enable PayHook to work with different databases. Follow these steps to add support for a new database.

### 1. Understand the Interface

Review the `StorageAdapter` interface in `src/core/interfaces/storage.adapter.ts`:

```typescript
export interface StorageAdapter {
  // Transaction operations
  createTransaction(dto: CreateTransactionDto): Promise<Transaction>;
  updateTransactionStatus(id: string, status: TransactionStatus, auditEntry: CreateAuditLogDto): Promise<Transaction>;
  findTransaction(query: TransactionQuery): Promise<Transaction | null>;

  // Webhook operations
  createWebhookLog(dto: CreateWebhookLogDto): Promise<WebhookLog>;
  findWebhookLogs(query: WebhookQuery): Promise<WebhookLog[]>;

  // ... 30+ methods total
}
```

### 2. Create Your Adapter

Create a new directory for your adapter:

```bash
mkdir -p src/adapters/storage/mongodb
```

### 3. Implement the Adapter

```typescript
// src/adapters/storage/mongodb/mongodb-storage.adapter.ts

import { StorageAdapter, Transaction, /* ... */ } from '../../../core';
import { MongoClient, Db, Collection } from 'mongodb';

export class MongoDBStorageAdapter implements StorageAdapter {
  private db: Db;
  private transactions: Collection;
  private webhookLogs: Collection;

  constructor(config: MongoDBConfig) {
    // Initialize MongoDB connection
  }

  async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
    // Implementation
    const doc = {
      _id: generateId(),
      applicationRef: dto.applicationRef,
      provider: dto.provider,
      status: TransactionStatus.PENDING,
      amount: dto.amount,
      currency: dto.currency,
      createdAt: new Date(),
      updatedAt: new Date(),
      // ... map other fields
    };

    await this.transactions.insertOne(doc);
    return this.mapToTransaction(doc);
  }

  async updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    auditEntry: CreateAuditLogDto
  ): Promise<Transaction> {
    // Must be atomic!
    const session = this.client.startSession();

    try {
      await session.withTransaction(async () => {
        // Update transaction
        await this.transactions.updateOne(
          { _id: id },
          { $set: { status, updatedAt: new Date() } },
          { session }
        );

        // Create audit log
        await this.auditLogs.insertOne(auditEntry, { session });
      });

      const updated = await this.transactions.findOne({ _id: id });
      return this.mapToTransaction(updated);
    } finally {
      await session.endSession();
    }
  }

  async withTransaction<T>(callback: (session: any) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(callback);
    } finally {
      await session.endSession();
    }
  }

  // Implement all other required methods...
}
```

### 4. Key Implementation Requirements

#### Atomicity
- State changes MUST be atomic with audit log creation
- Use database transactions where available
- Implement proper rollback on failure

#### Unique Constraints
- `applicationRef` must be unique per transaction
- `(provider, provider_event_id)` must be unique for webhooks (idempotency)

#### Indexing
- Create indexes on frequently queried fields:
  - `transactions`: applicationRef, providerRef, status, createdAt
  - `webhook_logs`: transactionId, processingStatus, provider
  - `audit_logs`: transactionId, performedAt

#### Error Handling
```typescript
async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
  try {
    // Implementation
  } catch (error) {
    if (this.isDuplicateKeyError(error)) {
      throw new Error(`Transaction with applicationRef ${dto.applicationRef} already exists`);
    }
    throw error;
  }
}
```

### 5. Write Contract Tests

All storage adapters must pass the contract test suite:

```typescript
// test/adapters/storage/mongodb/mongodb-storage.adapter.spec.ts

import { testStorageAdapter } from '../../../testing/storage-adapter.contract';
import { MongoDBStorageAdapter } from '../../../../src/adapters/storage/mongodb';

describe('MongoDBStorageAdapter', () => {
  let adapter: MongoDBStorageAdapter;

  beforeAll(async () => {
    adapter = new MongoDBStorageAdapter({
      url: 'mongodb://localhost:27017',
      database: 'payhook_test',
    });
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.cleanup();
    await adapter.disconnect();
  });

  // Run the contract test suite
  testStorageAdapter(() => adapter);

  // Add adapter-specific tests
  describe('MongoDB specific', () => {
    it('should handle connection failures gracefully', async () => {
      // Test MongoDB-specific behavior
    });
  });
});
```

### 6. Add Configuration Support

```typescript
// src/adapters/storage/mongodb/mongodb.config.ts

export interface MongoDBConfig {
  url: string;
  database: string;
  options?: {
    maxPoolSize?: number;
    retryWrites?: boolean;
    w?: string | number;
  };
}

// In PayHookModule configuration:
PayHookModule.forRoot({
  storage: {
    adapter: 'mongodb',
    config: {
      url: process.env.MONGODB_URL,
      database: 'payhook',
      options: {
        maxPoolSize: 10,
        retryWrites: true,
      },
    },
  },
});
```

## Adding a Provider Adapter

Provider adapters enable PayHook to process webhooks from different payment providers.

### 1. Understand the Interface

Review the `PaymentProviderAdapter` interface:

```typescript
export interface PaymentProviderAdapter {
  readonly providerName: string;
  readonly supportedEvents: string[];

  verifySignature(rawBody: Buffer, headers: Record<string, string>, secrets: string[]): boolean;
  normalize(rawPayload: Record<string, any>): NormalizedWebhookEvent;
  extractIdempotencyKey(rawPayload: Record<string, any>): string;
  extractReferences(rawPayload: Record<string, any>): {
    providerRef: string;
    applicationRef?: string;
  };
  verifyWithProvider?(providerRef: string, options?: VerifyOptions): Promise<ProviderVerificationResult | null>;
}
```

### 2. Create Provider Adapter

```typescript
// src/adapters/providers/stripe/stripe-provider.adapter.ts

import * as crypto from 'crypto';
import { PaymentProviderAdapter, NormalizedWebhookEvent, /* ... */ } from '../../../core';

export class StripeProviderAdapter implements PaymentProviderAdapter {
  readonly providerName = 'stripe';
  readonly supportedEvents = [
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.refunded',
    'charge.dispute.created',
    // ... list all events you handle
  ];

  constructor(private readonly config?: StripeConfig) {}

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secrets: string[]
  ): boolean {
    const signature = headers['stripe-signature'];
    if (!signature) return false;

    // Extract timestamp and signatures
    const elements = signature.split(',');
    const timestamp = elements.find(e => e.startsWith('t='))?.substring(2);
    const signatures = elements
      .filter(e => e.startsWith('v1='))
      .map(e => e.substring(3));

    if (!timestamp || signatures.length === 0) return false;

    // Verify timestamp is within tolerance (5 minutes)
    const tolerance = 300;
    const timestampSeconds = parseInt(timestamp, 10);
    const currentTime = Math.floor(Date.now() / 1000);

    if (Math.abs(currentTime - timestampSeconds) > tolerance) {
      return false;
    }

    // Construct signed payload
    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;

    // Check signature against each secret
    for (const secret of secrets) {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload, 'utf8')
        .digest('hex');

      // Timing-safe comparison
      for (const signature of signatures) {
        if (this.timingSafeEqual(expectedSignature, signature)) {
          return true;
        }
      }
    }

    return false;
  }

  normalize(rawPayload: Record<string, any>): NormalizedWebhookEvent {
    const type = rawPayload.type;

    // Map Stripe events to normalized events
    const eventTypeMap: Record<string, NormalizedEventType> = {
      'payment_intent.succeeded': NormalizedEventType.PAYMENT_SUCCEEDED,
      'payment_intent.payment_failed': NormalizedEventType.PAYMENT_FAILED,
      'charge.refunded': NormalizedEventType.REFUND_COMPLETED,
      'charge.dispute.created': NormalizedEventType.DISPUTE_CREATED,
      // ... map all events
    };

    const normalizedType = eventTypeMap[type] || NormalizedEventType.OTHER;

    // Extract common fields based on event type
    const data = rawPayload.data.object;

    return {
      eventType: normalizedType,
      providerEventType: type,
      eventId: rawPayload.id,
      timestamp: new Date(rawPayload.created * 1000),
      amount: data.amount,
      currency: data.currency?.toUpperCase() || 'USD',
      providerRef: data.id,
      applicationRef: data.metadata?.order_id || data.client_reference_id,
      customerEmail: data.receipt_email || data.customer_email,
      status: this.mapStatus(data.status),
      metadata: {
        paymentMethod: data.payment_method_types?.[0],
        last4: data.payment_method_details?.card?.last4,
        brand: data.payment_method_details?.card?.brand,
        // ... extract provider-specific metadata
      },
    };
  }

  extractIdempotencyKey(rawPayload: Record<string, any>): string {
    // Stripe events have unique IDs
    return rawPayload.id;
  }

  extractReferences(rawPayload: Record<string, any>): {
    providerRef: string;
    applicationRef?: string;
  } {
    const data = rawPayload.data.object;

    return {
      providerRef: data.id,
      applicationRef: data.metadata?.order_id || data.client_reference_id,
    };
  }

  async verifyWithProvider?(
    providerRef: string,
    options?: VerifyOptions
  ): Promise<ProviderVerificationResult | null> {
    if (!this.config?.apiKey) {
      return null;
    }

    try {
      // Use Stripe SDK or HTTP client
      const response = await fetch(
        `https://api.stripe.com/v1/payment_intents/${providerRef}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      return {
        exists: true,
        status: this.mapStatus(data.status),
        amount: data.amount,
        currency: data.currency?.toUpperCase(),
        metadata: data,
      };
    } catch (error) {
      console.error('Stripe API verification failed:', error);
      return null;
    }
  }

  private mapStatus(stripeStatus: string): string {
    const statusMap: Record<string, string> = {
      'succeeded': 'success',
      'processing': 'processing',
      'requires_payment_method': 'failed',
      'canceled': 'abandoned',
      // ... map all statuses
    };

    return statusMap[stripeStatus] || stripeStatus;
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;

    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);

    return crypto.timingSafeEqual(bufferA, bufferB);
  }
}
```

### 3. Important Considerations

#### Signature Verification
- MUST use timing-safe comparison to prevent timing attacks
- Support multiple secrets for key rotation
- Validate timestamp if provider includes it
- Handle different signature formats (HMAC-SHA256, HMAC-SHA512, etc.)

#### Event Normalization
- Map ALL provider events to normalized event types
- Extract amount in smallest currency unit
- Normalize currency codes to ISO 4217
- Preserve original event data in metadata

#### Idempotency
- Extract a unique, stable identifier for each webhook
- This prevents duplicate processing
- Usually the event ID from the provider

#### Reference Extraction
- Provider reference: The provider's transaction/payment ID
- Application reference: Your system's reference (often in metadata)

### 4. Write Tests

```typescript
// test/adapters/providers/stripe/stripe-provider.adapter.spec.ts

describe('StripeProviderAdapter', () => {
  let adapter: StripeProviderAdapter;

  beforeEach(() => {
    adapter = new StripeProviderAdapter({
      apiKey: 'sk_test_xxx',
    });
  });

  describe('verifySignature', () => {
    it('should verify valid Stripe signature', () => {
      const secret = 'whsec_test123';
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = { type: 'payment_intent.succeeded' };
      const rawBody = Buffer.from(JSON.stringify(payload));

      // Create valid signature
      const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
      const signature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');

      const headers = {
        'stripe-signature': `t=${timestamp},v1=${signature}`,
      };

      const result = adapter.verifySignature(rawBody, headers, [secret]);
      expect(result).toBe(true);
    });

    it('should reject expired timestamps', () => {
      const secret = 'whsec_test123';
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      // ... test with old timestamp

      const result = adapter.verifySignature(rawBody, headers, [secret]);
      expect(result).toBe(false);
    });
  });

  describe('normalize', () => {
    it('should normalize payment succeeded event', () => {
      const stripeEvent = {
        id: 'evt_123',
        type: 'payment_intent.succeeded',
        created: 1234567890,
        data: {
          object: {
            id: 'pi_123',
            amount: 2000,
            currency: 'usd',
            metadata: {
              order_id: 'ORDER-123',
            },
            receipt_email: 'customer@example.com',
            status: 'succeeded',
          },
        },
      };

      const result = adapter.normalize(stripeEvent);

      expect(result).toMatchObject({
        eventType: NormalizedEventType.PAYMENT_SUCCEEDED,
        providerEventType: 'payment_intent.succeeded',
        eventId: 'evt_123',
        amount: 2000,
        currency: 'USD',
        providerRef: 'pi_123',
        applicationRef: 'ORDER-123',
        customerEmail: 'customer@example.com',
      });
    });
  });
});
```

### 5. Create Factory for Testing

```typescript
// src/adapters/providers/stripe/stripe-webhook.factory.ts

export class StripeWebhookFactory {
  generateWebhook(
    type: string,
    data: any,
    options?: { secret?: string }
  ): { body: Buffer; headers: Record<string, string> } {
    const secret = options?.secret || 'whsec_test_secret';
    const timestamp = Math.floor(Date.now() / 1000);

    const event = {
      id: `evt_${Date.now()}`,
      type,
      created: timestamp,
      data: {
        object: data,
      },
    };

    const rawBody = Buffer.from(JSON.stringify(event));
    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    return {
      body: rawBody,
      headers: {
        'stripe-signature': `t=${timestamp},v1=${signature}`,
        'content-type': 'application/json',
      },
    };
  }
}
```

## Testing Guidelines

### Test Coverage Requirements
- Core domain: 100%
- Adapters: 90%+
- Integration tests for all critical paths

### Test Structure

```
test/
├── unit/           # Pure unit tests
├── integration/    # Tests with real databases/services
├── e2e/           # End-to-end webhook flows
└── contracts/     # Adapter contract tests
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- mongodb-storage.adapter

# Run with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e
```

## Code Style

### TypeScript Guidelines
- Use strict mode
- Explicit return types for public methods
- Proper error types, not generic Error
- Document complex logic with comments

### Naming Conventions
- Classes: PascalCase (`TransactionService`)
- Interfaces: PascalCase with 'I' prefix optional (`IStorageAdapter` or `StorageAdapter`)
- Methods: camelCase (`createTransaction`)
- Constants: UPPER_SNAKE_CASE (`TRANSACTION_STATUS`)
- Files: kebab-case (`mongodb-storage.adapter.ts`)

### Code Organization
```typescript
// 1. Imports
import { external } from 'package';
import { internal } from '../core';

// 2. Interfaces/Types
interface LocalInterface {}

// 3. Class definition
export class MyClass {
  // 4. Properties
  private readonly prop: string;

  // 5. Constructor
  constructor() {}

  // 6. Public methods
  public doSomething(): void {}

  // 7. Private methods
  private helper(): void {}
}
```

## Pull Request Process

### 1. Fork and Clone
```bash
git clone https://github.com/yourusername/payhook-core.git
cd payhook-core
git remote add upstream https://github.com/payhook/core.git
```

### 2. Create Feature Branch
```bash
git checkout -b feature/mongodb-adapter
```

### 3. Make Changes
- Write code following guidelines
- Add tests with good coverage
- Update documentation

### 4. Commit Messages
Follow conventional commits:
```
feat: add MongoDB storage adapter
fix: correct signature verification timing attack
docs: update provider adapter guide
test: add contract tests for MongoDB adapter
```

### 5. Push and Create PR
```bash
git push origin feature/mongodb-adapter
```

Create pull request with:
- Clear description of changes
- Link to related issues
- Screenshots/examples if applicable
- Test results

### 6. PR Review Checklist
- [ ] Tests pass
- [ ] Coverage maintained or improved
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
- [ ] Follows code style
- [ ] Contract tests pass (for adapters)

## Getting Help

- Check existing issues and PRs
- Join our Discord: [discord.gg/payhook](https://discord.gg/payhook)
- Review test examples in codebase
- Ask questions in discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.