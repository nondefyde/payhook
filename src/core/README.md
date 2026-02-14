# Core Domain Layer

## Overview

The `core` directory contains the heart of the PayHook system - pure business logic with zero framework dependencies. This layer defines the domain models, business rules, interfaces, and core services that make PayHook a reliable transaction truth engine.

## Philosophy

The core layer follows Domain-Driven Design (DDD) principles:
- **Framework Agnostic**: No NestJS decorators or framework-specific code
- **Pure TypeScript**: All models and logic are plain TypeScript classes
- **Dependency Inversion**: Core defines interfaces that adapters implement
- **Business Logic First**: All business rules live here, not in controllers or adapters

## Directory Structure

```
core/
├── domain/           # Domain models and value objects
│   ├── models/       # Core entities (Transaction, WebhookLog, etc.)
│   └── enums/        # Business enums (statuses, event types)
├── interfaces/       # Adapter contracts and type definitions
├── services/         # Core business services
├── state-machine/    # Transaction state management
└── events/           # Event system and dispatching
```

## Domain Models (`/domain`)

### Core Entities

#### Transaction (`models/transaction.model.ts`)
The central entity representing a payment transaction's current state.

```typescript
class Transaction {
  id: string;                    // Unique identifier
  applicationRef: string;         // Your system's reference
  provider: string;               // Payment provider name
  providerRef?: string;           // Provider's transaction ID
  amount: Money;                  // Amount with currency (value object)
  status: TransactionStatus;      // Current state
  verificationMethod?: VerificationMethod;
  metadata: Record<string, any>; // Custom data
  createdAt: Date;
  updatedAt: Date;
  settledAt?: Date;              // When reached final state
}
```

**Key Features:**
- Immutable after creation (except status transitions)
- Uses Money value object for amount handling
- Tracks verification method for audit purposes
- Supports custom metadata for flexibility

#### WebhookLog (`models/webhook-log.model.ts`)
Immutable record of every webhook received, regardless of validity.

```typescript
class WebhookLog {
  id: string;
  provider: string;              // Which provider sent this
  eventType: string;              // Provider's event type
  idempotencyKey: string;         // For deduplication
  rawPayload: Buffer;             // Exact bytes received
  headers: Record<string, string>;
  processingStatus: ProcessingStatus;
  transactionId?: string;         // Linked transaction if matched
  error?: string;                 // If processing failed
  receivedAt: Date;
  processedAt?: Date;
}
```

**Key Features:**
- Stores raw payload as Buffer for signature verification
- Includes all headers for debugging
- Tracks processing fate (completed, failed, duplicate, etc.)
- Links to transaction when matched
- Supports payload redaction for sensitive data

#### AuditLog (`models/audit-log.model.ts`)
Complete audit trail of all transaction state changes.

```typescript
class AuditLog {
  id: string;
  transactionId: string;
  fromStatus: TransactionStatus | null;  // null for creation
  toStatus: TransactionStatus;
  triggerType: TriggerType;      // What caused this change
  webhookLogId?: string;          // If triggered by webhook
  actor?: string;                 // User/system that triggered
  reason?: string;                // Human-readable explanation
  metadata?: Record<string, any>;
  createdAt: Date;
}
```

**Key Features:**
- Immutable audit trail
- Links state changes to their triggers
- Supports manual interventions with actor/reason
- Factory methods for common scenarios

#### DispatchLog (`models/dispatch-log.model.ts`)
Tracks event delivery to external systems.

```typescript
class DispatchLog {
  id: string;
  webhookLogId?: string;
  transactionId: string;
  eventType: string;              // What event was dispatched
  handlerName: string;            // Which handler received it
  status: DispatchStatus;
  payload: Record<string, any>;
  attemptedAt: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
  nextRetryAt?: Date;
}
```

**Key Features:**
- Enables event replay for recovery
- Tracks retry attempts
- Records handler errors for debugging
- Supports async event processing

### Value Objects

#### Money (`models/money.vo.ts`)
Immutable value object for monetary amounts.

```typescript
class Money {
  readonly amount: number;        // In smallest unit (cents, kobo)
  readonly currency: string;      // ISO 4217 code

  // Factory methods
  static fromMajorUnits(amount: number, currency: string): Money
  static zero(currency: string): Money

  // Operations
  add(other: Money): Money
  subtract(other: Money): Money
  multiply(factor: number): Money
  equals(other: Money): boolean
  isGreaterThan(other: Money): boolean

  // Formatting
  toMajorUnits(): number
  format(): string
}
```

**Key Features:**
- Immutable to prevent accidental mutations
- Currency safety (can't add USD to NGN)
- Arithmetic operations return new instances
- Handles decimal precision correctly

### Enums

#### TransactionStatus
```typescript
enum TransactionStatus {
  PENDING = 'PENDING',           // Initial state
  PROCESSING = 'PROCESSING',     // Payment in progress
  SUCCESSFUL = 'SUCCESSFUL',     // Payment completed
  FAILED = 'FAILED',             // Payment failed
  CANCELLED = 'CANCELLED',       // Cancelled by user/system
  REFUNDED = 'REFUNDED',         // Money returned
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED'
}
```

#### ProcessingStatus
```typescript
enum ProcessingStatus {
  PENDING = 'PENDING',           // Not yet processed
  COMPLETED = 'COMPLETED',       // Successfully processed
  FAILED = 'FAILED',            // Processing error
  DUPLICATE = 'DUPLICATE',       // Duplicate webhook
  INVALID = 'INVALID',          // Failed validation
  UNMATCHED = 'UNMATCHED'       // No matching transaction
}
```

#### NormalizedEventType
Maps provider-specific events to standard types:
```typescript
enum NormalizedEventType {
  PAYMENT_SUCCESSFUL = 'payment.successful',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_ABANDONED = 'payment.abandoned',
  REFUND_PENDING = 'refund.pending',
  REFUND_SUCCESSFUL = 'refund.successful',
  REFUND_FAILED = 'refund.failed',
  CHARGE_DISPUTED = 'charge.disputed',
  DISPUTE_RESOLVED = 'dispute.resolved'
}
```

## Interfaces (`/interfaces`)

### StorageAdapter
Contract for database operations. Any storage implementation must implement this interface.

```typescript
interface StorageAdapter {
  // Transaction operations
  createTransaction(dto: CreateTransactionDto): Promise<Transaction>;
  findTransaction(query: TransactionQuery): Promise<Transaction | null>;
  updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    context: TransitionContext
  ): Promise<Transaction>;

  // Webhook operations
  createWebhookLog(dto: CreateWebhookLogDto): Promise<WebhookLog>;
  findWebhookLog(id: string): Promise<WebhookLog | null>;
  isDuplicateWebhook(
    provider: string,
    idempotencyKey: string
  ): Promise<boolean>;

  // Audit operations
  createAuditLog(dto: CreateAuditLogDto): Promise<AuditLog>;
  getAuditTrail(transactionId: string): Promise<AuditLog[]>;

  // Dispatch operations
  createDispatchLog(dto: CreateDispatchLogDto): Promise<DispatchLog>;
  updateDispatchStatus(
    id: string,
    status: DispatchStatus,
    error?: string
  ): Promise<void>;

  // Transaction support
  beginTransaction(): Promise<any>;
  commitTransaction(txn: any): Promise<void>;
  rollbackTransaction(txn: any): Promise<void>;

  // Health checks
  isHealthy(): Promise<boolean>;
  getStatistics(): Promise<StorageStatistics>;
}
```

### PaymentProviderAdapter
Contract for payment provider integrations.

```typescript
interface PaymentProviderAdapter {
  providerName: string;
  supportedEvents: string[];
  config: ProviderConfig;

  // Webhook processing
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secrets: string[]
  ): boolean;

  parsePayload(rawBody: Buffer): Record<string, any>;

  normalize(rawPayload: Record<string, any>): NormalizedWebhookEvent;

  extractIdempotencyKey(rawPayload: Record<string, any>): string;

  extractReferences(rawPayload: Record<string, any>): {
    providerRef: string;
    applicationRef?: string;
  };

  // Event classification
  isSuccessEvent(eventType: string): boolean;
  isFailureEvent(eventType: string): boolean;
  isRefundEvent(eventType: string): boolean;
  isDisputeEvent(eventType: string): boolean;

  // API verification (optional)
  verifyWithProvider?(
    providerRef: string,
    options?: VerifyOptions
  ): Promise<ProviderVerificationResult | null>;

  // Configuration
  validateConfig(config: Record<string, any>): boolean;
  getWebhookPath(): string;
  isTestMode(rawPayload?: Record<string, any>): boolean;
}
```

### EventDispatcher
Contract for event emission and handling.

```typescript
interface EventDispatcher {
  // Registration
  register(
    eventType: NormalizedEventType,
    handler: EventHandler,
    options?: HandlerOptions
  ): void;

  // Dispatching
  dispatch(
    event: PaymentEvent,
    options?: DispatchOptions
  ): Promise<DispatchSummary>;

  // Replay
  replayEvent(dispatchLogId: string): Promise<void>;
  replayFailedEvents(since?: Date): Promise<number>;

  // Management
  getHandlers(eventType?: NormalizedEventType): EventHandler[];
  removeHandler(handlerName: string): void;
}
```

## Services (`/services`)

### TransactionService
Main service for transaction management.

```typescript
class TransactionService {
  // Create new transaction
  async createTransaction(dto: CreateTransactionDto): Promise<Transaction>

  // Update status with state machine validation
  async markAsProcessing(
    id: string,
    dto: MarkAsProcessingDto
  ): Promise<Transaction>

  // Query operations
  async getTransaction(
    id: string,
    options?: GetTransactionOptions
  ): Promise<Transaction | null>

  // Reconciliation
  async reconcile(
    id: string,
    options?: ReconcileOptions
  ): Promise<ReconciliationResult>

  // Statistics
  async getStatistics(
    filter?: StatisticsFilter
  ): Promise<TransactionStatistics>
}
```

**Key Responsibilities:**
- Enforces business rules
- Coordinates with state machine
- Handles reconciliation logic
- Provides query capabilities

### WebhookProcessor
Implements the 7-stage webhook processing pipeline.

```typescript
class WebhookProcessor {
  async processWebhook(
    provider: string,
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<ProcessingResult>
}
```

**Processing Stages:**
1. **Inbound**: Log raw webhook
2. **Verification**: Verify signature
3. **Normalization**: Convert to standard format
4. **Persistence**: Save webhook log
5. **Deduplication**: Check for duplicates
6. **State Engine**: Update transaction state
7. **Dispatch**: Emit events

## State Machine (`/state-machine`)

### TransactionStateMachine
Manages valid state transitions with business rules.

```typescript
class TransactionStateMachine {
  // Validate transition
  canTransition(
    from: TransactionStatus,
    to: TransactionStatus,
    context: TransitionContext
  ): TransitionResult

  // Execute transition with guards
  transition(
    transaction: Transaction,
    to: TransactionStatus,
    context: TransitionContext
  ): TransitionResult

  // Get valid next states
  getValidTransitions(
    from: TransactionStatus
  ): TransactionStatus[]
}
```

**Transition Rules Matrix:**
```
From ↓ / To →    | PROCESSING | SUCCESSFUL | FAILED | CANCELLED | REFUNDED
-----------------|------------|------------|---------|-----------|----------
PENDING          |     ✓      |     ✓      |   ✓    |     ✓     |    ✗
PROCESSING       |     ✗      |     ✓      |   ✓    |     ✓     |    ✗
SUCCESSFUL       |     ✗      |     ✗      |   ✗    |     ✗     |    ✓
FAILED           |     ✗      |     ✓*     |   ✗    |     ✗     |    ✗
CANCELLED        |     ✗      |     ✗      |   ✗    |     ✗     |    ✗

* = Only with reconciliation
```

## Events (`/events`)

### Event System
Enables decoupled communication between components.

```typescript
interface PaymentEvent {
  id: string;
  type: NormalizedEventType;
  transactionId: string;
  webhookLogId?: string;
  timestamp: Date;
  payload: {
    previousStatus?: TransactionStatus;
    currentStatus: TransactionStatus;
    amount: Money;
    provider: string;
    metadata?: Record<string, any>;
  };
}
```

**Usage Example:**
```typescript
// Register handler
eventDispatcher.register(
  NormalizedEventType.PAYMENT_SUCCESSFUL,
  async (event) => {
    // Send confirmation email
    // Update inventory
    // Generate invoice
  }
);

// Events are automatically dispatched after state changes
```

## Usage Patterns

### Creating a Transaction
```typescript
const transaction = await transactionService.createTransaction({
  applicationRef: 'order_123',
  provider: 'paystack',
  amount: Money.fromMajorUnits(100, 'USD'),
  metadata: { customerId: 'cust_456' }
});
```

### Processing a Webhook
```typescript
const result = await webhookProcessor.processWebhook(
  'stripe',
  request.body, // Raw Buffer
  request.headers
);

if (!result.success) {
  logger.error('Webhook processing failed', result.error);
}
```

### Querying with Verification
```typescript
const transaction = await transactionService.getTransaction(id, {
  verify: true,              // Call provider API
  includeWebhooks: true,     // Include webhook logs
  includeAuditTrail: true    // Include full history
});
```

### Manual Reconciliation
```typescript
const result = await transactionService.reconcile(transactionId, {
  force: true,               // Override state machine rules
  updateStatus: true         // Update local state to match provider
});

if (result.diverged) {
  logger.warn('Transaction diverged from provider', result.differences);
}
```

## Design Principles

### 1. Immutability
- Domain models are immutable after creation
- State changes create new audit entries
- Webhooks are never modified after logging

### 2. Audit Everything
- Every webhook is logged (even invalid ones)
- Every state change is audited
- Every event dispatch is recorded

### 3. Fail Safe
- Invalid webhooks don't crash the system
- Failed handlers don't affect transaction state
- Duplicate webhooks are safely ignored

### 4. Provider Agnostic
- Core has no knowledge of specific providers
- All provider logic is in adapters
- Normalized events abstract provider differences

### 5. Testability
- Pure functions where possible
- Dependency injection throughout
- No static dependencies

## Testing the Core

The core layer is extensively tested with:

```typescript
// Unit tests for models
describe('Transaction', () => {
  it('should enforce immutability');
  it('should validate state transitions');
  it('should track verification method');
});

// Integration tests for services
describe('TransactionService', () => {
  it('should process webhooks atomically');
  it('should handle concurrent updates');
  it('should reconcile with provider');
});

// State machine tests
describe('TransactionStateMachine', () => {
  it('should enforce business rules');
  it('should provide transition guards');
  it('should handle edge cases');
});
```

## Common Patterns

### Repository Pattern
Storage operations go through adapters:
```typescript
const transaction = await storageAdapter.findTransaction({
  applicationRef: 'order_123'
});
```

### Factory Pattern
Creating complex objects:
```typescript
const auditLog = AuditLog.fromTransition(
  transaction,
  newStatus,
  trigger
);
```

### Strategy Pattern
Provider-specific logic:
```typescript
const adapter = providerRegistry.getAdapter('stripe');
const normalized = adapter.normalize(rawPayload);
```

### Observer Pattern
Event-driven updates:
```typescript
eventDispatcher.on('payment.successful', async (event) => {
  await emailService.sendConfirmation(event);
});
```

## Error Handling

The core layer uses specific error types:

```typescript
// Domain errors
class InvalidStateTransitionError extends Error
class DuplicateTransactionError extends Error
class ProviderVerificationError extends Error

// Usage
try {
  await transactionService.markAsProcessing(id, dto);
} catch (error) {
  if (error instanceof InvalidStateTransitionError) {
    // Handle invalid transition
  }
}
```

## Performance Considerations

- **Indexes**: Critical queries have database indexes
- **Caching**: Verification results cached briefly
- **Batch Operations**: Bulk updates for efficiency
- **Async Processing**: Events dispatched asynchronously
- **Connection Pooling**: Reuse database connections

## Security

- **No Secrets**: Core never handles API keys directly
- **Validation**: All inputs validated at boundaries
- **Immutability**: Prevents accidental data corruption
- **Audit Trail**: Complete forensic capabilities
- **Idempotency**: Safe retry of operations

## Next Steps

To use the core layer:

1. **Implement Adapters**: Create storage and provider adapters
2. **Configure Services**: Wire up with dependency injection
3. **Register Handlers**: Set up event handlers
4. **Start Processing**: Begin handling webhooks

The core provides the foundation - adapters and modules make it real.