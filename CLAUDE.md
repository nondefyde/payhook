# PayHook Implementation Plan

## Project Overview
PayHook is a transaction truth engine that converts payment provider webhooks into verified, deduplicated, normalized facts with an append-only audit trail. This document tracks the implementation phases, architectural decisions, and progress.

## Architecture Principles

### Core Design Decisions
1. **Database/Provider Agnostic**: Core logic has zero knowledge of specific databases or payment providers
2. **Adapter Pattern**: All external integrations via pluggable adapters
3. **Pure Domain Models**: No framework decorators in core entities
4. **TDD First**: Tests written before implementation using mock adapters
5. **Query-First API**: Primary interface is querying, not webhook handling
6. **Audit Everything**: Every webhook and state change leaves a trace

### Tech Stack
- **Language**: TypeScript (strict mode)
- **Framework**: NestJS 10+
- **Testing**: Jest + Supertest
- **Database (MVP)**: PostgreSQL via TypeORM adapter
- **Provider (MVP)**: Paystack via adapter
- **Runtime**: Node.js 18+

## Domain Model Structure

### Core Entities (Pure TypeScript)
```
src/core/domain/
├── models/
│   ├── transaction.model.ts       # Current payment state
│   ├── webhook-log.model.ts       # Every webhook received
│   ├── audit-log.model.ts         # State transition history
│   ├── dispatch-log.model.ts      # Event delivery tracking
│   └── outbox-event.model.ts      # Optional outbox pattern
├── enums/
│   ├── transaction-status.enum.ts
│   ├── processing-status.enum.ts
│   ├── verification-method.enum.ts
│   └── normalized-event-type.enum.ts
└── value-objects/
    ├── money.vo.ts
    └── provider-reference.vo.ts
```

### Adapter Interfaces
```
src/core/interfaces/
├── storage.adapter.ts         # Database operations contract
├── provider.adapter.ts         # Payment provider contract
└── event-dispatcher.ts         # Event emission contract
```

## Implementation Phases

### Phase 1: Core Foundation ✅ CURRENT
**Goal**: Establish pure domain models and interfaces with zero external dependencies

- [x] Initialize NestJS project
- [x] Create PRD.md and CLAUDE.md
- [ ] Define core domain models (Transaction, WebhookLog, AuditLog, DispatchLog)
- [ ] Create enums for statuses and types
- [ ] Design adapter interfaces (StorageAdapter, PaymentProviderAdapter)
- [ ] Implement value objects (Money, ProviderReference)
- [ ] Write unit tests for domain models

**Test Strategy**: Pure unit tests, no mocking needed yet

### Phase 2: State Machine Engine
**Goal**: Implement the transaction state machine with transition validation

- [ ] Create StateMachine class (pure TypeScript)
- [ ] Define transition rules matrix
- [ ] Implement transition validation logic
- [ ] Add transition guards and conditions
- [ ] Write comprehensive state machine tests
- [ ] Document all valid state transitions

**Test Strategy**: Table-driven tests for all transition combinations

### Phase 3: Mock Adapters for TDD
**Goal**: Create fully functional mock implementations for testing

- [ ] Implement MockStorageAdapter (in-memory)
- [ ] Implement MockProviderAdapter
- [ ] Create MockWebhookFactory for generating test webhooks
- [ ] Add deterministic behavior controls
- [ ] Write adapter contract tests
- [ ] Create testing utilities module

**Test Strategy**: Contract tests that all adapters must pass

### Phase 4: Webhook Processing Pipeline
**Goal**: Build the 7-layer processing pipeline

- [ ] Create WebhookController (adapter-injected)
- [ ] Implement signature verification layer
- [ ] Build normalization layer
- [ ] Add persistence layer (claim logging)
- [ ] Implement deduplication logic
- [ ] Connect state machine for transitions
- [ ] Add event dispatch layer
- [ ] Write pipeline integration tests

**Test Strategy**: Integration tests with mock adapters

### Phase 5: Query-First API
**Goal**: Implement the primary TransactionService interface

- [ ] Create TransactionService
- [ ] Implement createTransaction()
- [ ] Implement markAsProcessing()
- [ ] Build getTransaction() with verification metadata
- [ ] Add getAuditTrail()
- [ ] Implement isSettled() convenience
- [ ] Add listTransactionsByStatus()
- [ ] Write service layer tests

**Test Strategy**: Service tests with mock storage

### Phase 6: TypeORM Storage Adapter
**Goal**: First real storage implementation for PostgreSQL

- [ ] Set up TypeORM entities
- [ ] Implement StorageAdapter interface
- [ ] Add database migrations
- [ ] Implement atomic operations
- [ ] Add row-level locking
- [ ] Set up unique constraints
- [ ] Write adapter-specific tests
- [ ] Create docker-compose for local Postgres

**Test Strategy**: Integration tests against real Postgres

### Phase 7: Paystack Provider Adapter
**Goal**: First real provider implementation

- [ ] Implement PaystackAdapter
- [ ] Add signature verification (HMAC-SHA512)
- [ ] Build event normalization mappings
- [ ] Implement verification API calls
- [ ] Add request/response logging
- [ ] Write Paystack-specific tests
- [ ] Create webhook simulation tools

**Test Strategy**: Tests with recorded API responses

### Phase 8: Event System & Recovery
**Goal**: Implement event dispatch, replay, and outbox

- [ ] Create EventDispatcher service
- [ ] Implement @OnPaymentEvent decorator
- [ ] Build replay functionality
- [ ] Add outbox table and logic
- [ ] Create dispatch logging
- [ ] Implement handler registration
- [ ] Write event system tests

**Test Strategy**: Tests for idempotency and failure recovery

### Phase 9: Reconciliation System
**Goal**: Build manual reconciliation capabilities

- [ ] Implement reconcile() method
- [ ] Add provider verification calls
- [ ] Build divergence detection
- [ ] Create scanStaleTransactions()
- [ ] Add reconciliation audit logging
- [ ] Write reconciliation tests

**Test Strategy**: Tests with various divergence scenarios

### Phase 10: NestJS Module & DI
**Goal**: Package everything as a configurable NestJS module

- [ ] Create PayHookModule.forRoot()
- [ ] Implement configuration schema
- [ ] Add provider registration
- [ ] Set up dependency injection
- [ ] Create module exports
- [ ] Add middleware helpers
- [ ] Write module configuration tests

**Test Strategy**: Module initialization and configuration tests

### Phase 11: Production Readiness
**Goal**: Add security, observability, and performance features

- [ ] Implement lifecycle hooks
- [ ] Add structured logging
- [ ] Create middleware guards
- [ ] Add secret rotation support
- [ ] Implement data redaction
- [ ] Add retention/purge logic
- [ ] Performance optimization
- [ ] Security audit

**Test Strategy**: Load tests, security tests

### Phase 12: Documentation & Examples
**Goal**: Make it easy for developers to adopt and contribute

- [ ] Write getting started guide
- [ ] Create API documentation
- [ ] Add code examples
- [ ] Write adapter contribution guide
- [ ] Create troubleshooting guide
- [ ] Add migration guide
- [ ] Set up documentation site

## Testing Strategy

### Test Levels
1. **Unit Tests**: Domain models, value objects, state machine
2. **Integration Tests**: Pipeline, adapters, services
3. **Contract Tests**: Adapter interface compliance
4. **E2E Tests**: Full webhook flow with mock provider
5. **Load Tests**: Performance under concurrent webhooks

### Test Coverage Goals
- Core domain: 100%
- State machine: 100%
- Adapters: 90%+
- Services: 95%+
- Overall: 90%+

## File Structure

```
payhook-core/
├── src/
│   ├── core/                      # Pure business logic
│   │   ├── domain/                # Domain models
│   │   ├── interfaces/            # Adapter contracts
│   │   ├── state-machine/         # State engine
│   │   └── services/              # Core services
│   ├── adapters/                  # Adapter implementations
│   │   ├── storage/
│   │   │   ├── typeorm/
│   │   │   └── mock/
│   │   └── providers/
│   │       ├── paystack/
│   │       └── mock/
│   ├── modules/                   # NestJS modules
│   │   └── payhook.module.ts
│   ├── controllers/               # HTTP layer
│   ├── decorators/                # Custom decorators
│   ├── middleware/                # Optional middleware
│   └── testing/                   # Test utilities
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── PRD.md                         # Product requirements
├── CLAUDE.md                      # This file
└── README.md                      # User documentation
```

## Design Patterns

### Patterns Used
1. **Adapter Pattern**: For database/provider abstraction
2. **State Machine**: For transaction lifecycle
3. **Repository Pattern**: For data access
4. **Factory Pattern**: For creating test webhooks
5. **Strategy Pattern**: For verification methods
6. **Observer Pattern**: For event dispatch
7. **Outbox Pattern**: For reliable event delivery

### SOLID Principles
- **S**: Each class has single responsibility
- **O**: Core is open for extension via adapters
- **L**: Adapters are substitutable
- **I**: Interfaces are segregated by concern
- **D**: Core depends on abstractions, not concretions

## Contribution Guidelines

### Adding a New Storage Adapter
1. Implement `StorageAdapter` interface
2. Ensure atomic operations
3. Add adapter-specific tests
4. Pass contract test suite
5. Document configuration
6. Submit PR with tests

### Adding a New Provider Adapter
1. Implement `PaymentProviderAdapter` interface
2. Map provider events to normalized schema
3. Add signature verification
4. Implement verification API (if available)
5. Write provider-specific tests
6. Document webhook setup
7. Submit PR with examples

## Progress Tracking

### Completed
- ✅ Project initialization
- ✅ PRD documentation
- ✅ Implementation plan

### In Progress
- 🔄 Phase 1: Core Foundation

### Upcoming
- ⏳ Phase 2: State Machine Engine
- ⏳ Phase 3: Mock Adapters
- ⏳ Phase 4: Webhook Pipeline
- ⏳ Phase 5: Query API
- ⏳ Phase 6: TypeORM Adapter
- ⏳ Phase 7: Paystack Adapter
- ⏳ Phase 8: Event System
- ⏳ Phase 9: Reconciliation
- ⏳ Phase 10: NestJS Module
- ⏳ Phase 11: Production Ready
- ⏳ Phase 12: Documentation

## Key Decisions Log

### 2024-02-14
- **Decision**: Use adapter pattern for database/provider agnosticism
- **Rationale**: Enables community contributions without touching core
- **Alternative**: Hard-code providers (rejected - limits extensibility)

### 2024-02-14
- **Decision**: Separate core logic from NestJS framework
- **Rationale**: Core can be tested without framework overhead
- **Alternative**: Tight NestJS coupling (rejected - harder to test)

### 2024-02-14
- **Decision**: TDD with mock adapters first
- **Rationale**: Ensures correct behavior independent of external systems
- **Alternative**: Build with real adapters (rejected - slower feedback)

## Success Criteria

### MVP Release (v0.1.0)
- [ ] Paystack webhooks processed correctly
- [ ] PostgreSQL storage via TypeORM
- [ ] All webhooks logged with fate
- [ ] State transitions audited
- [ ] Mock adapter for testing
- [ ] <10min setup time
- [ ] 90%+ test coverage

### Production Ready (v1.0.0)
- [ ] Multiple provider adapters
- [ ] Multiple storage adapters
- [ ] Performance <100ms p50
- [ ] Comprehensive documentation
- [ ] Security audited
- [ ] Community contributions

## Notes for Implementation

### Critical Invariants
1. Every webhook gets logged (even invalid ones)
2. No state change without audit entry
3. Dispatch occurs after commit
4. Duplicates never cause double transitions
5. Failed handlers don't affect truth

### Performance Considerations
- Use database indexes on lookup fields
- Implement connection pooling
- Consider read replicas for queries
- Cache verification results briefly
- Batch dispatch log writes

### Security Checklist
- [ ] Timing-safe signature comparison
- [ ] No secret logging
- [ ] Input validation on all endpoints
- [ ] Rate limiting available
- [ ] Request size limits
- [ ] SQL injection prevention
- [ ] NoSQL injection prevention (if applicable)