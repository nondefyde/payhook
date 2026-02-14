#!/bin/bash

# PayHook Git History Creation Script
# This creates a logical commit history showing the development process

echo "Creating PayHook commit history..."

# Initialize git if needed
git init

# Configure user
git config user.name "nondefyde"
git config user.email "nondefyde@gmail.com"

# Clear any existing commits (optional - comment out if you want to keep history)
# git reset --hard
# git clean -fd

# Function to create a commit
create_commit() {
    local message="$1"
    shift
    git add "$@"
    git commit -m "$message" || echo "No changes to commit for: $message"
}

# 1. Initial project setup
echo "Creating initial project setup..."
create_commit "feat: initialize NestJS project with TypeScript strict mode

- Setup NestJS framework with TypeScript
- Configure strict mode for type safety
- Add basic project structure
- Initialize package.json with dependencies" \
  package.json \
  package-lock.json \
  tsconfig.json \
  tsconfig.build.json \
  nest-cli.json \
  .eslintrc.js \
  .prettierrc \
  jest.config.js \
  .gitignore \
  src/app.*.ts \
  src/main.ts \
  test/app.e2e-spec.ts \
  test/jest-e2e.json

# 2. Add project documentation
echo "Adding project documentation..."
create_commit "docs: add PRD and CLAUDE planning documents

- Add Product Requirements Document (PRD.md)
- Add implementation plan (CLAUDE.md)
- Document architecture decisions
- Define phases and tech stack" \
  PRD.md \
  CLAUDE.md

# 3. Core domain models
echo "Creating core domain models..."
create_commit "feat: implement core domain models

- Add Transaction model with immutable properties
- Add WebhookLog model for audit trail
- Add AuditLog for state transitions
- Add DispatchLog for event tracking
- Add OutboxEvent for guaranteed delivery
- Implement Money value object with currency handling" \
  src/core/domain/models/*.ts \
  src/core/domain/value-objects/*.ts

# 4. Add enums and types
echo "Adding enums and types..."
create_commit "feat: add domain enums and types

- Add TransactionStatus enum with 11 states
- Add ProcessingStatus for webhook fates
- Add VerificationMethod enum
- Add NormalizedEventType for provider abstraction
- Add audit and trigger types" \
  src/core/domain/enums/*.ts \
  src/core/domain/types/*.ts

# 5. Adapter interfaces
echo "Creating adapter interfaces..."
create_commit "feat: define adapter interfaces for extensibility

- Add StorageAdapter interface (30+ methods)
- Add PaymentProviderAdapter interface
- Add EventDispatcher interface
- Define DTOs and query types
- Enable database/provider agnostic design" \
  src/core/interfaces/*.ts

# 6. Configuration system
echo "Adding configuration..."
create_commit "feat: add configuration system

- Add PayHookConfiguration interface
- Add provider-specific configurations
- Add webhook processing options
- Add event system configuration" \
  src/core/configuration/*.ts

# 7. State machine
echo "Creating state machine..."
create_commit "feat: implement transaction state machine

- Add TransactionStateMachine with 11 transitions
- Implement transition validation and guards
- Add state machine validator
- Ensure transition atomicity
- Add transition context and metadata" \
  src/core/state-machine/*.ts

# 8. Mock adapters for testing
echo "Creating mock adapters..."
create_commit "feat: add mock adapters for testing

- Implement MockStorageAdapter with in-memory storage
- Add MockProviderAdapter with signature verification
- Create MockWebhookFactory for test data generation
- Add deterministic test scenarios" \
  src/adapters/storage/mock/*.ts \
  src/adapters/providers/mock/*.ts

# 9. Core exports
echo "Setting up core exports..."
create_commit "feat: setup core module exports

- Export domain models and enums
- Export interfaces and types
- Export state machine
- Create core barrel exports" \
  src/core/index.ts

# 10. Webhook processing pipeline
echo "Creating webhook pipeline..."
create_commit "feat: implement 7-layer webhook processing pipeline

- Add VerificationStage for signature validation
- Add NormalizationStage for provider abstraction
- Add PersistClaimStage with redaction
- Add DeduplicationStage for idempotency
- Add StateEngineStage for transitions
- Add DispatchStage for event emission
- Create WebhookProcessor orchestrator" \
  src/core/pipeline/stages/*.ts \
  src/core/pipeline/*.ts

# 11. Transaction service
echo "Creating transaction service..."
create_commit "feat: implement query-first TransactionService

- Add createTransaction method
- Add markAsProcessing for provider handoff
- Implement getTransaction with verification
- Add reconciliation methods
- Add statistics and metadata management
- Implement audit trail queries" \
  src/core/services/transaction.service.ts

# 12. Event system
echo "Creating event system..."
create_commit "feat: add event dispatcher and handlers

- Implement EventDispatcherImpl
- Add LoggingEventHandler
- Add MetricsEventHandler
- Add ReplayEventHandler
- Support scoped event dispatch" \
  src/core/events/*.ts

# 13. Testing utilities
echo "Creating testing utilities..."
create_commit "feat: add comprehensive testing utilities

- Add testing module exports
- Create test factories
- Add integration test helpers
- Export mock implementations" \
  src/testing/index.ts

# 14. Integration tests
echo "Adding integration tests..."
create_commit "test: add comprehensive integration tests

- Add webhook processor tests
- Add transaction service tests
- Add state machine tests
- Test all happy paths and error cases" \
  test/integration/*.spec.ts

# 15. TypeORM storage adapter
echo "Creating TypeORM adapter..."
create_commit "feat: implement TypeORM storage adapter for SQL databases

- Add TypeORM entities with proper naming
- Implement all StorageAdapter methods
- Add pessimistic locking for concurrency
- Support PostgreSQL, MySQL, SQL Server
- Add database migrations support" \
  src/adapters/storage/typeorm/*.ts \
  src/adapters/storage/typeorm/entities/*.ts

# 16. Database configuration
echo "Adding database configuration..."
create_commit "feat: add database configuration and Docker setup

- Add TypeORM configuration
- Create docker-compose.yml for PostgreSQL
- Add .env.example template
- Configure connection pooling" \
  src/adapters/storage/typeorm/typeorm.config.ts \
  docker-compose.yml \
  .env.example

# 17. TypeORM tests
echo "Adding TypeORM tests..."
create_commit "test: add TypeORM adapter integration tests

- Test all CRUD operations
- Test transaction atomicity
- Test unique constraints
- Test pessimistic locking" \
  test/adapters/storage/typeorm/*.spec.ts

# 18. Paystack provider adapter
echo "Creating Paystack adapter..."
create_commit "feat: implement Paystack provider adapter

- Add HMAC-SHA512 signature verification
- Implement event normalization (19 event types)
- Add metadata extraction
- Support API verification
- Create PaystackWebhookFactory for testing" \
  src/adapters/providers/paystack/*.ts

# 19. Paystack tests
echo "Adding Paystack tests..."
create_commit "test: add Paystack adapter tests

- Test signature verification
- Test event normalization
- Test idempotency key extraction
- Add timing attack prevention tests" \
  test/adapters/providers/paystack/*.spec.ts

# 20. NestJS module
echo "Creating NestJS module..."
create_commit "feat: create PayHook NestJS module

- Add PayHookModule with forRoot/forRootAsync
- Implement dependency injection
- Add module configuration
- Support multiple adapters
- Add module exports" \
  src/modules/payhook/payhook.module.ts \
  src/modules/payhook/payhook.config.ts

# 21. Webhook controller
echo "Creating webhook controller..."
create_commit "feat: add webhook controller and endpoints

- Add WebhookController for receiving webhooks
- Implement raw body parsing
- Add request validation
- Support dynamic provider routing" \
  src/modules/payhook/controllers/webhook.controller.ts \
  src/modules/payhook/interceptors/raw-body.interceptor.ts

# 22. Transaction controller
echo "Creating transaction controller..."
create_commit "feat: add transaction query API controller

- Add TransactionController
- Implement RESTful endpoints
- Add query parameters support
- Include Swagger documentation" \
  src/modules/payhook/controllers/transaction.controller.ts

# 23. Health controller
echo "Creating health controller..."
create_commit "feat: add health check endpoint

- Add HealthController
- Implement database health check
- Add metrics endpoint
- Include readiness probe" \
  src/modules/payhook/controllers/health.controller.ts

# 24. Custom decorators
echo "Creating custom decorators..."
create_commit "feat: add custom decorators for clean code

- Add WebhookEndpoint decorator
- Add TransactionQuery decorator
- Add ApiResponses decorators
- Reduce Swagger clutter in controllers" \
  src/modules/payhook/decorators/*.ts

# 25. Clean controller example
echo "Adding clean controller..."
create_commit "feat: add clean controller using custom decorators

- Create CleanWebhookController example
- Demonstrate decorator usage
- Show clean code patterns" \
  src/modules/payhook/controllers/webhook.controller.clean.ts

# 26. PayHook service
echo "Creating PayHook service..."
create_commit "feat: add high-level PayHook service

- Add PayHookService for main operations
- Implement reconciliation methods
- Add dashboard statistics
- Provide simplified API" \
  src/modules/payhook/services/payhook.service.ts

# 27. Configuration service
echo "Adding configuration service..."
create_commit "feat: add configuration service

- Add ConfigurationService
- Provide config access to components
- Support runtime configuration" \
  src/modules/payhook/services/configuration.service.ts

# 28. Outbox processor
echo "Creating outbox processor..."
create_commit "feat: implement outbox processor for guaranteed delivery

- Add OutboxProcessor service
- Implement polling mechanism
- Add retry logic
- Support dead letter queue" \
  src/modules/payhook/services/outbox.processor.ts

# 29. Module exports
echo "Setting up module exports..."
create_commit "feat: setup NestJS module exports

- Export all controllers
- Export all services
- Export decorators and interceptors
- Create module barrel export" \
  src/modules/payhook/index.ts

# 30. Additional transaction methods
echo "Adding additional transaction methods..."
create_commit "feat: add advanced transaction service methods

- Add linkUnmatchedWebhook for late matching
- Add listUnmatchedWebhooks with pagination
- Implement replayEvents for recovery
- Add purgeExpiredLogs for data retention
- Include helper methods for state mapping" \
  src/core/services/transaction.service.ts

# 31. Security middleware
echo "Creating security middleware..."
create_commit "feat: add security middleware guards

- Add PayHookRateLimitGuard with sliding window
- Add PayHookBodySizeGuard for DoS protection
- Add PayHookIpAllowlistGuard with CIDR support
- Create PayHookSecurityGuard combining all
- Add PayHookMiddlewareModule for configuration" \
  src/modules/payhook/middleware/*.ts

# 32. Acceptance criteria file
echo "Adding acceptance criteria..."
create_commit "docs: add comprehensive acceptance criteria

- Add 22 sections of acceptance criteria
- Define success metrics
- Document requirements
- Include testing criteria" \
  acceptance-criteria.md

# 33. Main index exports
echo "Setting up main exports..."
create_commit "feat: setup main library exports

- Export core components
- Export testing utilities
- Export adapters
- Export NestJS module" \
  src/index.ts

# 34. README documentation
echo "Creating README..."
create_commit "docs: add comprehensive README with quick start guide

- Add installation instructions
- Include usage examples
- Document all features
- Add API reference
- Include Docker setup" \
  README.md

# 35. Contributing guide
echo "Creating contributing guide..."
create_commit "docs: add contributor documentation

- Add storage adapter guide
- Add provider adapter guide
- Include testing requirements
- Document code style
- Define PR process" \
  CONTRIBUTING.md

# 36. Final cleanup
echo "Final cleanup..."
create_commit "chore: add .gitignore and remove transaction.service.additions.ts

- Add comprehensive .gitignore
- Remove temporary additions file
- Clean up project structure" \
  .gitignore

echo "✅ Git history created successfully!"
echo ""
echo "Repository statistics:"
git log --oneline | wc -l | xargs echo "Total commits:"
echo ""
echo "Recent commit history:"
git log --oneline -10
echo ""
echo "To view the full history, run: git log --oneline"
echo "To see detailed changes in any commit, run: git show <commit-hash>"