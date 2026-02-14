# PayHook Source Code Architecture

## Overview

The `src` directory contains all source code for PayHook, organized into three main layers following clean architecture principles. Each layer has a specific responsibility and clear boundaries, ensuring maintainability, testability, and flexibility.

## Architecture Layers

```
src/
├── core/               # Pure business logic (framework-agnostic)
├── adapters/          # External integrations (database, providers)
├── modules/           # NestJS framework integration
└── _shared/           # Shared resources (DTOs, decorators)
```

## Layer Responsibilities

### 1. Core Layer (`/core`)
The heart of the system - pure TypeScript business logic with no external dependencies.

**Contains:**
- Domain models (Transaction, WebhookLog, AuditLog)
- Business rules and state machine
- Service interfaces
- Event system

**Characteristics:**
- No framework code (no NestJS decorators)
- No database-specific code
- No provider-specific logic
- 100% testable in isolation

**Key Components:**
- `domain/models/` - Core entities and value objects
- `interfaces/` - Adapter contracts
- `services/` - Business logic services
- `state-machine/` - Transaction state management
- `events/` - Event dispatching system

[Full Documentation →](./core/README.md)

### 2. Adapters Layer (`/adapters`)
Concrete implementations of core interfaces for external integrations.

**Contains:**
- Payment provider adapters (Paystack, Stripe, etc.)
- Storage adapters (TypeORM, MongoDB, etc.)
- Mock implementations for testing

**Characteristics:**
- Implements interfaces defined in core
- Provider-specific logic isolated here
- Easily swappable implementations
- No business logic

**Key Components:**
- `providers/paystack/` - Paystack integration
- `storage/typeorm/` - PostgreSQL via TypeORM
- `providers/mock/` - Testing implementations

[Full Documentation →](./adapters/README.md)

### 3. Modules Layer (`/modules`)
NestJS framework integration and HTTP layer.

**Contains:**
- NestJS modules and dependency injection
- HTTP controllers
- Middleware and guards
- Request/response handling

**Characteristics:**
- Framework-specific code
- Wires up core services with adapters
- Handles HTTP concerns
- Provides configuration

**Key Components:**
- `payhook/controllers/` - REST API endpoints
- `payhook/services/` - NestJS service wrappers
- `payhook/payhook.module.ts` - Main module definition

[Full Documentation →](./modules/README.md)

### 4. Shared Resources (`/_shared`)
Reusable components used across layers.

**Contains:**
- DTOs with validation
- Swagger decorators
- Common utilities

**Characteristics:**
- Promotes code reuse
- Maintains consistency
- Reduces duplication

**Key Components:**
- `dto/` - Data transfer objects with validation
- `swagger/decorators/` - API documentation decorators

[Full Documentation →](./_shared/README.md)

## Data Flow

### Webhook Processing Flow

```
1. HTTP Request → modules/controllers/webhook.controller.ts
   ↓
2. Raw Body Extraction → modules/interceptors/raw-body.interceptor.ts
   ↓
3. Business Logic → core/services/webhook-processor.ts
   ↓
4. Provider Logic → adapters/providers/paystack/paystack-provider.adapter.ts
   ↓
5. Storage → adapters/storage/typeorm/typeorm-storage.adapter.ts
   ↓
6. State Machine → core/state-machine/transaction-state-machine.ts
   ↓
7. Event Dispatch → core/events/event-dispatcher.ts
   ↓
8. HTTP Response → modules/controllers/webhook.controller.ts
```

### Transaction Query Flow

```
1. HTTP Request → modules/controllers/transaction.controller.ts
   ↓
2. Validation → _shared/dto/transaction.dto.ts
   ↓
3. Business Logic → core/services/transaction.service.ts
   ↓
4. Storage Query → adapters/storage/typeorm/typeorm-storage.adapter.ts
   ↓
5. Optional Verification → adapters/providers/paystack/paystack-provider.adapter.ts
   ↓
6. HTTP Response → modules/controllers/transaction.controller.ts
```

## Dependency Rules

The architecture follows strict dependency rules to maintain clean boundaries:

```
modules ──depends on──> core
   ↓                      ↑
   └──depends on──> adapters

❌ core CANNOT depend on modules or adapters
❌ adapters CANNOT depend on modules
✅ modules can depend on both core and adapters
✅ adapters can depend on core interfaces
```

## Project Setup

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Run database migrations
npm run migration:run
```

### Configuration

```typescript
// app.module.ts
import { PayHookModule } from './modules/payhook';
import { TypeORMStorageAdapter } from './adapters/storage/typeorm';
import { PaystackProviderAdapter } from './adapters/providers/paystack';

@Module({
  imports: [
    PayHookModule.forRoot({
      storageAdapter: new TypeORMStorageAdapter(dataSource),
      providers: new Map([
        ['paystack', new PaystackProviderAdapter({
          keys: { secretKey: process.env.PAYSTACK_SECRET_KEY }
        })]
      ])
    })
  ]
})
export class AppModule {}
```

### Development

```bash
# Start in development mode
npm run start:dev

# Run tests
npm run test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e

# Build for production
npm run build

# Start production server
npm run start:prod
```

## Testing Strategy

### Unit Tests
Test individual components in isolation:

```bash
# Core domain models
npm run test src/core/domain

# State machine
npm run test src/core/state-machine

# Individual adapters
npm run test src/adapters/providers/paystack
```

### Integration Tests
Test component interactions:

```bash
# Storage adapter with database
npm run test:integration src/adapters/storage

# Webhook processing pipeline
npm run test:integration src/core/services
```

### End-to-End Tests
Test complete webhook flows:

```bash
# Full webhook processing
npm run test:e2e

# Specific provider flows
npm run test:e2e -- --grep "Paystack"
```

## Key Design Patterns

### 1. Adapter Pattern
Isolates external dependencies:
```typescript
interface StorageAdapter {
  createTransaction(dto: CreateTransactionDto): Promise<Transaction>;
}

class TypeORMStorageAdapter implements StorageAdapter {
  // PostgreSQL implementation
}

class MongoStorageAdapter implements StorageAdapter {
  // MongoDB implementation
}
```

### 2. State Machine Pattern
Manages transaction lifecycle:
```typescript
class TransactionStateMachine {
  canTransition(from: Status, to: Status): boolean;
  transition(transaction: Transaction, to: Status): Transaction;
}
```

### 3. Repository Pattern
Abstracts data access:
```typescript
class TransactionRepository {
  async findByApplicationRef(ref: string): Promise<Transaction>;
  async save(transaction: Transaction): Promise<void>;
}
```

### 4. Observer Pattern
Event-driven architecture:
```typescript
eventDispatcher.on('payment.successful', async (event) => {
  await emailService.sendConfirmation(event);
  await inventoryService.updateStock(event);
});
```

### 5. Factory Pattern
Creates complex objects:
```typescript
class WebhookFactory {
  static createSuccessWebhook(): MockWebhook;
  static createFailedWebhook(): MockWebhook;
}
```

## Performance Considerations

### Database Optimization
- Indexes on frequently queried fields
- Connection pooling
- Read replicas for queries
- Batch operations where possible

### Caching Strategy
- Cache provider verification results (30s TTL)
- Cache transaction queries (configurable TTL)
- Use Redis for distributed caching

### Async Processing
- Event handlers run asynchronously
- Outbox pattern for reliable delivery
- Background jobs for reconciliation

## Security Best Practices

### Secret Management
- Never log sensitive data
- Use environment variables
- Rotate keys regularly
- Support multiple keys for rotation

### Input Validation
- Validate all DTOs with class-validator
- Sanitize webhook payloads
- Type-check at boundaries

### Access Control
- IP allowlisting for webhooks
- Rate limiting per IP
- Request size limits

## Monitoring & Observability

### Logging
```typescript
logger.info('Webhook received', {
  provider: 'paystack',
  eventType: 'charge.success',
  // Never log: secrets, customer data, raw payloads
});
```

### Metrics
- Webhook processing rate
- Transaction state changes
- Error rates by provider
- Processing duration p50/p95/p99

### Health Checks
- `GET /health` - Basic health
- `GET /health/ready` - Readiness with dependencies
- `GET /health/stats` - Detailed statistics

## Common Tasks

### Adding a New Payment Provider

1. Create adapter in `adapters/providers/[provider]/`
2. Implement `PaymentProviderAdapter` interface
3. Add provider-specific types
4. Write tests
5. Register in module configuration

### Adding a New Storage Backend

1. Create adapter in `adapters/storage/[backend]/`
2. Implement `StorageAdapter` interface
3. Add migrations/schemas
4. Write tests
5. Configure in module

### Adding Event Handlers

```typescript
// In your service
@Injectable()
export class OrderService implements OnModuleInit {
  constructor(private eventDispatcher: EventDispatcher) {}

  onModuleInit() {
    this.eventDispatcher.register(
      NormalizedEventType.PAYMENT_SUCCESSFUL,
      this.handlePaymentSuccess.bind(this)
    );
  }

  private async handlePaymentSuccess(event: PaymentEvent) {
    // Handle the event
  }
}
```

## Troubleshooting

### Debug Mode
Enable detailed logging:
```typescript
PayHookModule.forRoot({
  debug: true,
  monitoring: {
    logLevel: 'debug'
  }
})
```

### Common Issues

**Webhook Signature Failures**
- Check secret configuration
- Ensure using raw body (Buffer)
- Verify header names

**State Transition Errors**
- Check state machine rules
- Review audit logs
- Verify business logic

**Database Connection Issues**
- Check connection string
- Verify network access
- Review pool settings

## Contributing

### Code Style
- Use TypeScript strict mode
- Follow ESLint rules
- Write comprehensive tests
- Document public APIs

### Pull Request Process
1. Fork the repository
2. Create feature branch
3. Write tests first (TDD)
4. Implement feature
5. Update documentation
6. Submit PR with description

### Review Criteria
- Tests pass
- Code coverage maintained
- Documentation updated
- No security issues
- Performance impact assessed

## License

[Your License Here]

## Support

For issues and questions:
- GitHub Issues: [repository-url]/issues
- Documentation: [documentation-url]
- Email: support@payhook.com

---

Built with ❤️ for reliable payment processing